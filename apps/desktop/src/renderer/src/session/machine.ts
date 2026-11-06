import type { PhaseName } from '@together/shared';

/**
 * The session state machine. Pure: (state, event) -> state, no timers, no I/O.
 *
 * idle -> consent -> connecting -> lobby -> call -> moodStart -> apart -> together -> moodEnd -> results -> ended
 *
 * The room creator (host) decides when phases change and broadcasts phase{name, startAt}; both sides switch
 * at startAt on the aligned clock. Either person can End at any time. If the partner drops, timed phases
 * pause and a 20 s reconnect window opens; after it the session ends and keeps partial results.
 */

export type State = 'idle' | 'consent' | 'connecting' | 'lobby' | 'call' | 'moodStart' | 'apart' | 'together' | 'moodEnd' | 'results' | 'ended';
export type Role = 'host' | 'guest' | 'practice';
export type Intent = { kind: 'create' } | { kind: 'join'; code: string } | { kind: 'practice'; recordingId: string };
export type EndReason = 'you-ended' | 'partner-ended' | 'partner-lost' | 'error' | 'finished';

export const ORDER: PhaseName[] = ['lobby', 'call', 'moodStart', 'apart', 'together', 'moodEnd', 'results'];
export const TIMED: Partial<Record<PhaseName, number>> = { apart: 120_000, together: 180_000 };
export const RECONNECT_MS = 20_000;

export interface Timer {
  /** Local-clock ms when the phase (re)started counting. */
  startedAt: number;
  /** Time already spent before the last pause/resume. */
  elapsedBefore: number;
  durationMs: number;
  pausedAt: number | null;
}

export interface Ctx {
  state: State;
  intent: Intent | null;
  role: Role | null;
  /** Upcoming phase switch (countdown), local-clock ms. */
  scheduled: { name: PhaseName; at: number; elapsedMs: number } | null;
  timer: Timer | null;
  partnerPresent: boolean;
  /** Local ms by which the partner must be back, else the session ends. */
  reconnectBy: number | null;
  endReason: EndReason | null;
  /** True when the session ended before finishing Together. */
  partial: boolean;
  /** Phases that actually ran, for partial results. */
  reached: PhaseName[];
  phaseScale: number;
}

export type Event =
  | { type: 'BEGIN'; intent: Intent; phaseScale?: number }
  | { type: 'CONSENT'; accepted: boolean }
  | { type: 'CONNECTED'; role: Role }
  | { type: 'PEER_JOINED' }
  /** A phase broadcast (or the host's own decision), already converted to the local clock. */
  | { type: 'SCHEDULE'; name: PhaseName; at: number; elapsedMs?: number }
  | { type: 'TICK'; now: number }
  | { type: 'PEER_LOST'; now: number }
  | { type: 'PEER_BACK'; now: number }
  | { type: 'END'; reason: EndReason; now: number }
  | { type: 'RESET' };

export function initial(): Ctx {
  return { state: 'idle', intent: null, role: null, scheduled: null, timer: null, partnerPresent: false, reconnectBy: null, endReason: null, partial: false, reached: [], phaseScale: 1 };
}

export const isPhase = (s: State): s is PhaseName => (ORDER as string[]).includes(s);
const rank = (s: State) => (isPhase(s) ? ORDER.indexOf(s) : -1);

export function phaseDuration(name: PhaseName, scale = 1): number | null {
  const d = TIMED[name];
  return d === undefined ? null : Math.round(d * scale);
}

/** Remaining ms in the current timed phase. */
export function remaining(c: Ctx, now: number): number | null {
  if (!c.timer) return null;
  const ran = c.timer.elapsedBefore + (c.timer.pausedAt ?? now) - c.timer.startedAt;
  return Math.max(0, c.timer.durationMs - ran);
}
export function elapsed(c: Ctx, now: number): number {
  if (!c.timer) return 0;
  return c.timer.elapsedBefore + (c.timer.pausedAt ?? now) - c.timer.startedAt;
}

function enter(c: Ctx, name: PhaseName, now: number, elapsedMs: number): Ctx {
  const d = phaseDuration(name, c.phaseScale);
  return {
    ...c,
    state: name,
    scheduled: null,
    timer: d === null ? null : { startedAt: now, elapsedBefore: elapsedMs, durationMs: d, pausedAt: c.partnerPresent ? null : now },
    reached: c.reached.includes(name) ? c.reached : [...c.reached, name],
  };
}

function finish(c: Ctx, reason: EndReason): Ctx {
  const partial = reason !== 'finished' && !c.reached.includes('moodEnd');
  return { ...c, state: 'ended', scheduled: null, timer: c.timer ? { ...c.timer, pausedAt: c.timer.pausedAt ?? c.timer.startedAt } : null, endReason: reason, partial, reconnectBy: null };
}

export function reduce(c: Ctx, e: Event): Ctx {
  switch (e.type) {
    case 'BEGIN':
      if (c.state !== 'idle' && c.state !== 'ended') return c;
      return { ...initial(), state: 'consent', intent: e.intent, phaseScale: e.phaseScale ?? 1 };

    case 'CONSENT':
      if (c.state !== 'consent') return c;
      return e.accepted ? { ...c, state: 'connecting' } : initial();

    case 'CONNECTED':
      if (c.state !== 'connecting') return c;
      return { ...c, role: e.role };

    case 'PEER_JOINED':
      if (c.state === 'connecting') return { ...enter({ ...c, partnerPresent: true }, 'lobby', 0, 0) };
      return c;

    case 'SCHEDULE': {
      if (c.state === 'idle' || c.state === 'consent' || c.state === 'connecting' || c.state === 'ended') return c;
      const target = rank(e.name);
      const cur = rank(c.state);
      // Forward only, or the same timed phase again (a resume after a reconnect).
      if (target < cur || (target === cur && !TIMED[e.name])) return c;
      return { ...c, scheduled: { name: e.name, at: e.at, elapsedMs: e.elapsedMs ?? 0 } };
    }

    case 'TICK': {
      let n = c;
      if (n.reconnectBy !== null && e.now >= n.reconnectBy) return finish(n, 'partner-lost');
      if (n.scheduled && e.now >= n.scheduled.at && (n.partnerPresent || n.role === 'practice')) {
        n = enter(n, n.scheduled.name, n.scheduled.at, n.scheduled.elapsedMs);
        if (n.state === 'results') n = { ...n, endReason: 'finished' };
      }
      return n;
    }

    case 'PEER_LOST': {
      if (!isPhase(c.state) || c.state === 'results') return { ...c, partnerPresent: false };
      const timer = c.timer && c.timer.pausedAt === null ? { ...c.timer, pausedAt: e.now } : c.timer;
      return { ...c, partnerPresent: false, timer, scheduled: null, reconnectBy: e.now + RECONNECT_MS };
    }

    case 'PEER_BACK': {
      // Timers stay paused until the host re-broadcasts the phase with the elapsed time (SCHEDULE).
      return { ...c, partnerPresent: true, reconnectBy: null };
    }

    case 'END':
      if (c.state === 'idle') return c;
      if (c.state === 'consent' || c.state === 'connecting') return initial();
      return finish(c, e.reason);

    case 'RESET':
      return initial();
  }
}
