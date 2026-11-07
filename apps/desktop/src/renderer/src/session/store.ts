import { create } from 'zustand';
import type { ContentKind, Mode, Report, Thumbs } from '@counterfeed/shared';
import type { Quality, SensingProblem } from '../sensing/types';

export type Step = 'idle' | 'setup' | 'before' | 'settle' | 'watch' | 'after' | 'analyzing' | 'report' | 'problem';

/** What the person chose on the setup screen. */
export interface Plan {
  mode: Mode;
  content: { kind: ContentKind; id: string | null; name: string; app: string | null };
  /** For a video review: the cfmedia:// URL main handed out for the picked file. */
  videoUrl: string | null;
  /** Timed session length; null = until you stop (capped at 30 min) or, for a video, its length. */
  lengthMs: number | null;
  nudges: boolean;
  title: string | null;
  /** Hook test: the clips, in the order they'll play (shuffled on start when `shuffle` is on). */
  clips: PlanClip[];
  shuffle: boolean;
  /** Focus session: turn on Do Not Disturb (through the person's Shortcuts) for the session. */
  dnd: boolean;
  /** Focus session: note which app is in front, once a second (names only). */
  trackApps: boolean;
}

/** A clip picked for a hook test. Duration and playability are checked on the setup screen. */
export interface PlanClip {
  url: string;
  name: string;
  durationMs: number | null;
  /** 'checking' until its metadata loads; 'bad' if it can't play or its length is out of range. */
  state: 'checking' | 'ok' | 'bad';
  problem: string | null;
}

export type Problem = SensingProblem | 'video-error';

/** A short live cue on the bar while you watch: the real-time response to your signals. */
export interface LiveCue {
  kind: 'hold' | 'noblink' | 'face' | 'measuring' | 'starting' | 'focus';
  text: string;
}

export interface SessionState {
  step: Step;
  plan: Plan | null;
  /** Settle: 0-1 of the time needed for your normal, and how long we've waited. */
  settle: { progress: number; waitedMs: number; canForce: boolean };
  quality: Quality | null;
  preview: MediaStream | null;
  watch: { elapsedMs: number; startedAt: number | null; captureLive: boolean; cue: LiveCue; nudge: boolean };
  /** Hook test: which clip is playing (index into plan.clips). */
  clip: number;
  felt: { before: number | null; after: number | null };
  problem: { kind: Problem; detail: string } | null;
  report: Report | null;
  thumbs: Thumbs;
  /** Problems that happened during watching but still left enough for a report. */
  endedBy: Problem | 'closed' | null;
}

export const initialSession = (): SessionState => ({
  step: 'idle',
  plan: null,
  settle: { progress: 0, waitedMs: 0, canForce: false },
  quality: null,
  preview: null,
  watch: { elapsedMs: 0, startedAt: null, captureLive: false, cue: { kind: 'starting', text: 'Starting…' }, nudge: false },
  clip: 0,
  felt: { before: null, after: null },
  problem: null,
  report: null,
  thumbs: {},
  endedBy: null,
});

export const useSession = create<SessionState>(() => initialSession());
