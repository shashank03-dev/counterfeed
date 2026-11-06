import { z } from 'zod';
import { MOOD_WORDS, ROOM_CODE_RE } from './words.ts';

/* ---------------------------------------------------------------------------
 * Peer-to-peer data channel ("signals"). Only derived numbers cross the wire:
 * never video frames, never expression streams.
 * ------------------------------------------------------------------------- */

const finite = z.number().finite();
/** Microseconds since the Unix epoch on the SENDER's clock. */
const micros = z.number().finite().nonnegative();

export const SignalFrameSchema = z
  .object({
    t: micros,
    trace: finite.optional(),
    traceStable: z.boolean().optional(),
    pulse: z.number().min(0).max(250).optional(),
    pulseConf: z.number().min(0).max(100).optional(),
    talking: z.boolean().optional(),
  })
  .strict();
export type SignalFrame = z.infer<typeof SignalFrameSchema>;

export const PHASES = ['lobby', 'call', 'moodStart', 'apart', 'together', 'moodEnd', 'results'] as const;
export const PhaseNameSchema = z.enum(PHASES);
export type PhaseName = z.infer<typeof PhaseNameSchema>;

export const MomentKindSchema = z.enum(['smile', 'surprise']);
export type MomentKind = z.infer<typeof MomentKindSchema>;

export const MomentSchema = z
  .object({
    id: z.string().min(1).max(64),
    /** Microseconds, sender clock. */
    t: micros,
    /** Offset from the start of the session, ms (what the person sees: "at 04:32"). */
    atMs: z.number().int().nonnegative(),
    kind: MomentKindSchema,
    /** Peak smoothed facial-expression probability, 0-100. */
    peak: z.number().min(0).max(100),
    /** BPM change, or null when there was not enough stable pulse signal. */
    pulseDelta: z.number().min(-200).max(200).nullable(),
  })
  .strict();
export type Moment = z.infer<typeof MomentSchema>;

const id = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const MsgSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('hello'),
      appVersion: z.string().max(32),
      sharing: z.object({ expressions: z.boolean() }).strict(),
      /** Set when the sender's signals come from a recording, never live. */
      replay: z.object({ recordedAt: micros }).strict().nullable().optional(),
      /** The sender has its camera off (e.g. a replay-only second instance). */
      video: z.boolean().optional(),
    })
    .strict(),
  z.object({ type: z.literal('ping'), id, t0: micros }).strict(),
  z.object({ type: z.literal('pong'), id, t0: micros, t1: micros, t2: micros }).strict(),
  z.object({ type: z.literal('sig'), frames: z.array(SignalFrameSchema).max(240) }).strict(),
  z
    .object({
      type: z.literal('phase'),
      name: PhaseNameSchema,
      /** When both sides switch, in the HOST's clock (us). */
      startAt: micros,
      /** Time already spent in this phase before a pause (resume after a reconnect). */
      elapsedMs: z.number().int().nonnegative().max(3_600_000).optional(),
    })
    .strict(),
  z.object({ type: z.literal('ready'), phase: PhaseNameSchema, ready: z.boolean() }).strict(),
  z.object({ type: z.literal('mood'), when: z.enum(['start', 'end']), label: z.enum(MOOD_WORDS) }).strict(),
  z.object({ type: z.literal('moment'), moment: MomentSchema }).strict(),
  z.object({ type: z.literal('bye'), reason: z.enum(['ended', 'closed']).optional() }).strict(),
]);
export type Msg = z.infer<typeof MsgSchema>;
export type MsgOf<T extends Msg['type']> = Extract<Msg, { type: T }>;

/** Largest data channel message we accept, in bytes of JSON. */
export const MAX_MSG_BYTES = 64 * 1024;

export function parseMsg(raw: string): Msg | null {
  if (raw.length > MAX_MSG_BYTES) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const r = MsgSchema.safeParse(json);
  return r.success ? r.data : null;
}

/* ---------------------------------------------------------------------------
 * Signaling (desktop <-> apps/signal). The server relays only offer, answer,
 * ice and leave between the two people in a room, and stores nothing.
 * ------------------------------------------------------------------------- */

const code = z.string().regex(ROOM_CODE_RE);
const token = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
const sdp = z.string().min(1).max(32 * 1024);
const candidate = z
  .object({
    candidate: z.string().max(1024),
    sdpMid: z.string().max(64).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
    usernameFragment: z.string().max(256).nullable().optional(),
  })
  .strict();

export const RelaySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('offer'), sdp }).strict(),
  z.object({ type: z.literal('answer'), sdp }).strict(),
  z.object({ type: z.literal('ice'), candidate: candidate.nullable() }).strict(),
  z.object({ type: z.literal('leave') }).strict(),
]);
export type Relay = z.infer<typeof RelaySchema>;

export const ClientMsgSchema = z.union([
  z.object({ type: z.literal('create') }).strict(),
  z.object({ type: z.literal('join'), code }).strict(),
  z.object({ type: z.literal('rejoin'), code, token }).strict(),
  RelaySchema,
]);
export type ClientMsg = z.infer<typeof ClientMsgSchema>;

export const SignalErrorCodeSchema = z.enum(['room-not-found', 'room-full', 'rate-limited', 'bad-message', 'not-in-room', 'expired']);
export type SignalErrorCode = z.infer<typeof SignalErrorCodeSchema>;

export const ServerMsgSchema = z.union([
  z.object({ type: z.literal('created'), code, token }).strict(),
  z.object({ type: z.literal('joined'), code, token }).strict(),
  z.object({ type: z.literal('rejoined'), code, peerPresent: z.boolean() }).strict(),
  z.object({ type: z.literal('peer-joined') }).strict(),
  /** The other person's connection dropped; their seat is held until the room expires. */
  z.object({ type: z.literal('peer-away') }).strict(),
  z.object({ type: z.literal('peer-back') }).strict(),
  z.object({ type: z.literal('error'), code: SignalErrorCodeSchema }).strict(),
  RelaySchema,
]);
export type ServerMsg = z.infer<typeof ServerMsgSchema>;

export const MAX_SIGNAL_BYTES = 40 * 1024;

export function parseClientMsg(raw: string): ClientMsg | null {
  return parseWith(ClientMsgSchema, raw, MAX_SIGNAL_BYTES);
}
export function parseServerMsg(raw: string): ServerMsg | null {
  return parseWith(ServerMsgSchema, raw, MAX_SIGNAL_BYTES);
}
function parseWith<T>(schema: z.ZodType<T>, raw: string, max: number): T | null {
  if (raw.length > max) return null;
  try {
    const r = schema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * Recordings (JSONL): line 1 is a header, then one line per outgoing batch or
 * phase mark. Only SignalFrames, never video or audio.
 * ------------------------------------------------------------------------- */

export const RecordingHeaderSchema = z
  .object({
    kind: z.literal('together-recording'),
    version: z.literal(1),
    recordedAt: micros,
    appVersion: z.string().max(32),
  })
  .strict();
export type RecordingHeader = z.infer<typeof RecordingHeaderSchema>;

export const RecordingLineSchema = z.union([
  z.object({ k: z.literal('sig'), frames: z.array(SignalFrameSchema).max(240) }).strict(),
  z.object({ k: z.literal('phase'), name: PhaseNameSchema, t: micros }).strict(),
]);
export type RecordingLine = z.infer<typeof RecordingLineSchema>;
