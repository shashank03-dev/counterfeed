import { z } from 'zod';
import { MomentSchema } from './schemas.ts';
import { MOOD_WORDS } from './words.ts';

/** One phase's breathing-sync result, computed on this device. */
export const PhaseResultSchema = z
  .object({
    /** Phase-locking value, 0 (no consistent phase relation) to 1 (locked). */
    plv: z.number().min(0).max(1),
    /** 30 s windows (5 s step) that had enough clean, silent signal from both people. */
    windows: z.number().int().nonnegative(),
    /** Share of the phase with usable signal from both people, 0-1. */
    coverage: z.number().min(0).max(1),
    /** Surrogate (circular-shift) distribution of the same statistic. */
    chance: z.object({ mean: z.number().min(0).max(1), p95: z.number().min(0).max(1), n: z.number().int().nonnegative() }).strict(),
    /** plv / chance.mean. */
    ratio: z.number().nonnegative(),
    /** Share of surrogates below the observed value, 0-100. */
    percentile: z.number().min(0).max(100),
    /** Per-window PLV, for the timeline sparkline. */
    series: z.array(z.number().min(0).max(1)).max(2000),
  })
  .strict();
export type PhaseResult = z.infer<typeof PhaseResultSchema>;

const mood = z.enum(MOOD_WORDS).nullable();
const num = z.number().finite().nullable();

export const SessionRecordSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{8,64}$/),
    version: z.literal(1),
    startedAt: z.number().int().nonnegative(),
    endedAt: z.number().int().nonnegative(),
    role: z.enum(['host', 'guest', 'practice']),
    /** Set when the partner's signals were replayed from a recording. */
    replay: z.object({ recordedAt: z.number().nonnegative() }).strict().nullable(),
    /** Ended early (someone left or the connection dropped for good). */
    partial: z.boolean(),
    /** How long the timed phases were set to run (ms). Absent in records from before Short sessions (Full: 2 + 3 min). */
    lengths: z.object({ apart: z.number().int().positive(), together: z.number().int().positive() }).partial().strict().optional(),
    apart: PhaseResultSchema.nullable(),
    together: PhaseResultSchema.nullable(),
    breathingRate: z.object({ you: num, partner: num }).strict(),
    pulse: z.object({ you: num, partner: num }).strict(),
    moods: z.object({ you: z.object({ start: mood, end: mood }).strict(), partner: z.object({ start: mood, end: mood }).strict() }).strict(),
    moments: z.array(MomentSchema).max(500),
    sharedWithMe: z.array(MomentSchema).max(500),
  })
  .strict();
export type SessionRecord = z.infer<typeof SessionRecordSchema>;
