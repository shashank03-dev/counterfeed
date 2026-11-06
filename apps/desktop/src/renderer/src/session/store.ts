import { create } from 'zustand';
import type { Moment, MoodWord, PhaseName, SessionRecord } from '@together/shared';
import type { CallStats, LinkState } from '../call/PeerSession';
import type { ClockEstimate } from '../link/clock';
import type { Quality, SourceStatus } from '../sensing/types';
import { initial, type Ctx } from './machine';

/** Things a person may need to act on. Each maps to plain words in ui/problems.ts. */
export type Problem =
  | 'invalid-key'
  | 'no-key'
  | 'credit'
  | 'network'
  | 'camera-denied'
  | 'camera-busy'
  | 'camera-missing'
  | 'unavailable'
  | 'low-frame-rate'
  | 'failed'
  | 'mic-denied'
  | 'signal-unreachable'
  | 'room-not-found'
  | 'room-full'
  | 'rate-limited'
  | 'expired'
  | 'ice-failed'
  | 'recording-missing';

export interface PersonLive {
  pulse: number | null;
  pulseStable: boolean;
  rate: number | null;
  rateConf: number;
  talking: boolean;
  /** ms since the last signal frame arrived (partner), or since the last metric (you). */
  ageMs: number | null;
}

export interface Live {
  you: PersonLive & { quality: Quality | null; status: SourceStatus; breathingReady: boolean };
  partner: PersonLive;
  /** Live PLV over the last 30 s (Together only). */
  sync: number | null;
  /** How in step these two rhythms look by accident (circular-shift chance level, last 90 s). Together only. */
  chance: number | null;
  clock: ClockEstimate | null;
  call: CallStats | null;
  link: LinkState;
}

export interface OwnMoment {
  moment: Moment | null;
  /** Detected, waiting for the 15 s pulse check. */
  pending: { id: string; kind: Moment['kind']; atMs: number; peak: number } | null;
  shared: boolean;
}

export interface SessionState {
  ctx: Ctx;
  code: string | null;
  problem: Problem | null;
  /** Non-blocking notices (low frame rate, mic denied). */
  notice: Problem | null;
  sourceKind: 'camera' | 'replay' | 'test' | null;
  partner: {
    connected: boolean;
    video: boolean;
    replay: { recordedAt: number } | null;
    sharesReactions: boolean;
    ready: Partial<Record<PhaseName, boolean>>;
    moods: { start: MoodWord | null; end: MoodWord | null };
  };
  you: {
    ready: Partial<Record<PhaseName, boolean>>;
    moods: { start: MoodWord | null; end: MoodWord | null };
    shareMoods: boolean;
    shareReactions: boolean;
  };
  streams: { local: MediaStream | null; remote: MediaStream | null };
  mic: boolean;
  camera: boolean;
  recording: boolean;
  /** Replay of your own signals (peer 2). */
  selfReplay: { recordedAt: number } | null;
  moments: OwnMoment[];
  sharedWithMe: Moment[];
  /** Call started at (local ms), for the elapsed clock. */
  callStartedAt: number | null;
  result: SessionRecord | null;
  analyzing: boolean;
  live: Live;
}

const person = (): PersonLive => ({ pulse: null, pulseStable: false, rate: null, rateConf: 0, talking: false, ageMs: null });

export const blankSession = (): SessionState => ({
  ctx: initial(),
  code: null,
  problem: null,
  notice: null,
  sourceKind: null,
  partner: { connected: false, video: true, replay: null, sharesReactions: false, ready: {}, moods: { start: null, end: null } },
  you: { ready: {}, moods: { start: null, end: null }, shareMoods: false, shareReactions: false },
  streams: { local: null, remote: null },
  mic: true,
  camera: true,
  recording: false,
  selfReplay: null,
  moments: [],
  sharedWithMe: [],
  callStartedAt: null,
  result: null,
  analyzing: false,
  live: {
    you: { ...person(), quality: null, status: 'off', breathingReady: false },
    partner: person(),
    sync: null,
    chance: null,
    clock: null,
    call: null,
    link: 'new',
  },
});

export const useSession = create<SessionState>(() => blankSession());
