import type { Mode, PullPart } from '@counterfeed/shared';

/*
 * The Pull score (feed) / Hold score (review): how strongly something held your attention, 0-100, built only
 * from things the camera measured against your own normal. It is NOT a brain chemical, not a health measure,
 * and it never compares you with anyone else. Every part is shown, with the number behind it.
 */

/** Feed and review weights. 'unbroken' and 'steady' belong to focus sessions (see FOCUS_WEIGHTS in focus.ts). */
export const WEIGHTS: Record<PullPart['key'], number> = { blinking: 0.3, pauses: 0.25, stare: 0.2, eyes: 0.15, time: 0.1, unbroken: 0.2, steady: 0.15 };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const pct = (v: number) => Math.round(v * 100);
const secs = (us: number) => Math.round(us / 1e6);

export interface ScoreInputs {
  mode: Mode;
  /** Comparisons with your normal are only made when the settle minute gave a clear reading. */
  baselineGood: boolean;
  baseBlinkPerMin: number | null;
  blinkPerMin: number | null;
  /** Breathing pauses, or null when breathing couldn't be read (the part is then left out, not scored as zero). */
  holds: number | null;
  activeMin: number;
  longestNoBlinkUs: number | null;
  /** Share of watching time with your face toward the screen (0-1). */
  facingShare: number | null;
  watchMs: number;
  guessMs: number | null;
}

export function minutesLabel(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}

export function scoreParts(i: ScoreInputs): PullPart[] {
  const parts: PullPart[] = [];
  const add = (key: PullPart['key'], value: number, detail: string) => parts.push({ key, value: clamp01(value), weight: WEIGHTS[key], detail });

  if (i.baselineGood && i.baseBlinkPerMin !== null && i.baseBlinkPerMin >= 4 && i.blinkPerMin !== null) {
    const drop = (i.baseBlinkPerMin - i.blinkPerMin) / i.baseBlinkPerMin;
    const r = (v: number) => Math.round(v);
    add(
      'blinking',
      drop / 0.6,
      drop >= 0.1
        ? `You blinked ${pct(drop)}% less than your normal (${r(i.blinkPerMin)} a minute, against ${r(i.baseBlinkPerMin)}).`
        : drop <= -0.1
          ? `You blinked more than your normal (${r(i.blinkPerMin)} a minute, against ${r(i.baseBlinkPerMin)}).`
          : `You blinked about as often as your normal (${r(i.blinkPerMin)} a minute).`,
    );
  }
  if (i.activeMin >= 0.5 && i.holds !== null) {
    const perMin = i.holds / i.activeMin;
    add('pauses', perMin / 1.5, i.holds === 0 ? 'No breathing pauses.' : `${i.holds} breathing ${i.holds === 1 ? 'pause' : 'pauses'} in ${minutesLabel(i.activeMin * 60_000)}.`);
  }
  if (i.longestNoBlinkUs !== null) {
    add('stare', (i.longestNoBlinkUs - 6e6) / 24e6, `Longest stretch without blinking: ${secs(i.longestNoBlinkUs)} s.`);
  }
  if (i.facingShare !== null) {
    add('eyes', (i.facingShare - 0.6) / 0.4, `Your face was toward the screen ${pct(i.facingShare)}% of the time.`);
  }
  if (i.mode === 'feed' && i.guessMs !== null && i.watchMs > 0) {
    const gap = (i.watchMs - i.guessMs) / i.watchMs;
    add('time', gap / 0.5, `You guessed ${minutesLabel(i.guessMs)}. It was ${minutesLabel(i.watchMs)}.`);
  }
  return parts;
}

/** Weighted mean of the parts, 0-100. Needs at least two parts, else null ("not enough to score"). */
export function score(parts: PullPart[]): number | null {
  if (parts.length < 2) return null;
  const w = parts.reduce((s, p) => s + p.weight, 0);
  if (w <= 0) return null;
  return Math.round((100 * parts.reduce((s, p) => s + p.weight * p.value, 0)) / w);
}

export function band(score: number | null): string {
  if (score === null) return 'Not enough to score';
  if (score < 25) return 'Light';
  if (score < 50) return 'Moderate';
  if (score < 75) return 'Strong';
  return 'Very strong';
}

export const PART_LABEL: Record<PullPart['key'], string> = {
  blinking: 'Blinking',
  pauses: 'Breathing pauses',
  stare: 'Unbroken stare',
  eyes: 'Eyes on screen',
  time: 'Time sense',
  unbroken: 'Longest stretch',
  steady: 'Staying in one app',
};
