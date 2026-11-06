import { RecordingHeaderSchema, RecordingLineSchema, type PhaseName, type RecordingHeader, type SignalFrame } from '@together/shared';

export interface ParsedRecording {
  header: RecordingHeader;
  frames: SignalFrame[];
  marks: { name: PhaseName; t: number }[];
}

/** Parse and validate a JSONL recording. Invalid lines are skipped; a bad header rejects the file. */
export function parseRecording(text: string): ParsedRecording {
  const lines = text.split('\n').filter((l) => l.trim());
  const header = RecordingHeaderSchema.parse(JSON.parse(lines[0] ?? 'null'));
  const frames: SignalFrame[] = [];
  const marks: { name: PhaseName; t: number }[] = [];
  for (let i = 1; i < lines.length; i++) {
    let json: unknown;
    try {
      json = JSON.parse(lines[i]!);
    } catch {
      continue;
    }
    const r = RecordingLineSchema.safeParse(json);
    if (!r.success) continue;
    if (r.data.k === 'sig') frames.push(...r.data.frames);
    else marks.push({ name: r.data.name, t: r.data.t });
  }
  frames.sort((a, b) => a.t - b.t);
  return { header, frames, marks };
}

/**
 * Plays a recording's frames in real time, re-stamped onto the local clock.
 * `seek(phase, atLocal)` jumps so the recording's mark for that phase lines up with `atLocal`,
 * which keeps a replayed partner's Apart/Together aligned with the live session's phases.
 */
export class RecordingPlayer {
  private base = 0; // local time that corresponds to recording time `origin`
  private origin = 0;
  private idx = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  ended = false;
  /** Start over when the frames run out (a short practice recording keeps a full session company). */
  loop = false;
  /** Times playback wrapped around. */
  loops = 0;

  constructor(
    readonly rec: ParsedRecording,
    private readonly now: () => number,
    private readonly emit: (frames: SignalFrame[]) => void,
    private readonly onEnd: () => void = () => {},
    private readonly stepMs = 100,
  ) {}

  start() {
    if (!this.rec.frames.length) {
      this.ended = true;
      this.onEnd();
      return;
    }
    this.origin = this.rec.frames[0]!.t;
    this.base = this.now();
    this.idx = 0;
    this.timer = setInterval(() => this.flush(), this.stepMs);
  }

  seek(phase: PhaseName, atLocal: number) {
    const mark = this.rec.marks.find((m) => m.name === phase);
    if (!mark) return false;
    this.origin = mark.t;
    this.base = atLocal;
    this.idx = lowerBound(this.rec.frames, mark.t - Math.max(0, atLocal - this.now()));
    // Frames between the seek target and "now" are emitted on the next flush.
    this.ended = false;
    return true;
  }

  private flush() {
    const cutoff = this.origin + (this.now() - this.base); // recording time that is "now"
    const out: SignalFrame[] = [];
    const frames = this.rec.frames;
    while (this.idx < frames.length && frames[this.idx]!.t <= cutoff) {
      const f = frames[this.idx++]!;
      out.push({ ...f, t: Math.round(f.t - this.origin + this.base) });
    }
    if (out.length) this.emit(out);
    if (this.idx >= frames.length && this.loop && frames.length > 1) {
      // Continue from the first frame, one median sample gap after the last one, so time keeps rising.
      const last = frames[frames.length - 1]!.t;
      const gap = Math.max(1, (last - frames[0]!.t) / (frames.length - 1));
      this.base = this.base + (last - this.origin) + gap;
      this.origin = frames[0]!.t;
      this.idx = 0;
      this.loops++;
      return;
    }
    if (this.idx >= frames.length && !this.ended) {
      this.ended = true;
      this.onEnd();
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

function lowerBound(frames: SignalFrame[], t: number) {
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]!.t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
