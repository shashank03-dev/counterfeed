import { z } from 'zod';

/*
 * Counterfeed's stored report. Everything here is derived numbers and short labels, computed on this Mac.
 * No video, no audio, no face data, no camera frames. Pictures of the screen (thumbnails) are stored in a
 * separate file next to the report and are never part of an export.
 */

const num = z.number().finite();
const nnum = num.nullable();
const ms = z.number().int().nonnegative().max(24 * 3_600_000);
const thumbKey = z.string().regex(/^t[0-9]{1,4}$/);

/**
 * feed: scroll a feed. review: judge a project. hooks: rank a few short clips by how strongly each held you.
 * focus: work on one thing for a set time, and see how much of it your eyes stayed on the work (and in which apps).
 */
export const MODES = ['feed', 'review', 'hooks', 'focus'] as const;
export const ModeSchema = z.enum(MODES);
export type Mode = z.infer<typeof ModeSchema>;

/** What was being watched. 'none' = no pictures (screen recording not allowed, or the person chose not to). */
export const ContentKindSchema = z.enum(['window', 'screen', 'video', 'none', 'test']);
export type ContentKind = z.infer<typeof ContentKindSchema>;

export const EVENT_KINDS = ['hold', 'noblink', 'smile', 'surprise', 'frown', 'away'] as const;
export const EventKindSchema = z.enum(EVENT_KINDS);
export type EventKind = z.infer<typeof EventKindSchema>;

export const ReportEventSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    kind: EventKindSchema,
    /** Start, in ms from the start of watching. */
    atMs: ms,
    /** Position in the video (review of a video file), else null. */
    contentMs: ms.nullable(),
    durMs: ms,
    /** Peak facial-expression probability 0-100 (smile/surprise/frown), else null. */
    peak: z.number().min(0).max(100).nullable(),
    /** Key of a stored thumbnail, if one was kept for this moment. */
    thumb: thumbKey.nullable(),
  })
  .strict();
export type ReportEvent = z.infer<typeof ReportEventSchema>;

/** Score parts. Focus sessions use eyes, unbroken, steady and blinking; the others use the first five. */
export const PULL_PARTS = ['blinking', 'pauses', 'stare', 'eyes', 'time', 'unbroken', 'steady'] as const;
export const PullPartSchema = z
  .object({
    key: z.enum(PULL_PARTS),
    /** 0-1 contribution before weighting. */
    value: z.number().min(0).max(1),
    weight: z.number().min(0).max(1),
    /** One plain sentence: what was measured. */
    detail: z.string().max(200),
  })
  .strict();
export type PullPart = z.infer<typeof PullPartSchema>;

const rating = z.number().int().min(1).max(5).nullable();

/** Hook test: up to this many clips in one session. */
export const MAX_CLIPS = 6;

/**
 * The first 3 seconds of a clip. landed: it grabbed you within 3 s. slow: it grabbed you, later. steady: you stayed
 * and faced it, nothing stood out. lost: you swiped or looked away within 3 s. unclear: not enough view to tell.
 */
export const HOOK_VERDICTS = ['landed', 'slow', 'steady', 'lost', 'unclear'] as const;
export const CLIP_PARTS = ['stayed', 'eyes', 'stare', 'face'] as const;

export const ClipResultSchema = z
  .object({
    /** Position in the order the clips were played (0-based). */
    index: z.number().int().min(0).max(MAX_CLIPS - 1),
    name: z.string().max(160),
    durationMs: ms,
    /** Time the clip was actually playing. */
    watchedMs: ms,
    /** finished: played to the end. skipped: swiped on. stopped: the session ended during it. */
    status: z.enum(['finished', 'skipped', 'stopped', 'unwatched', 'failed']),
    /** Position in the clip where you swiped or the session stopped. */
    leftAtMs: ms.nullable(),
    /** Hold score 0-100; null when the clip wasn't watched. */
    score: z.number().int().min(0).max(100).nullable(),
    rank: z.number().int().min(1).max(MAX_CLIPS).nullable(),
    hook: z.enum(HOOK_VERDICTS),
    /** Position where it first held you strongly (2 s or more), if it did. */
    grabbedAtMs: ms.nullable(),
    /** Strongest moment in the clip. */
    bestMs: ms.nullable(),
    awayMs: ms,
    parts: z
      .array(
        z
          .object({ key: z.enum(CLIP_PARTS), value: z.number().min(0).max(1), weight: z.number().min(0).max(1), detail: z.string().max(200) })
          .strict(),
      )
      .max(CLIP_PARTS.length),
    /** Attention along the clip, one value (0-1) per second; null where there was no clear view. */
    curve: z.array(z.number().min(0).max(1).nullable()).max(400),
    thumb: thumbKey.nullable(),
  })
  .strict();
export type ClipResult = z.infer<typeof ClipResultSchema>;

/** Focus session: an app's share of the session. Names only (from macOS), never what was in it. */
export const MAX_FOCUS_APPS = 8;
export const FocusAppSchema = z
  .object({
    /** App name as macOS reports it ("Code", "Safari"); "Other apps" folds in the rest. */
    name: z.string().max(80),
    /** Time this app was in front. */
    ms,
    /** Of that, time with your eyes on the work. */
    focusedMs: ms,
  })
  .strict();
export type FocusApp = z.infer<typeof FocusAppSchema>;

/**
 * Focus session results. "Focused" = your face toward the screen; looking away for under 10 s (a glance) still
 * counts. A break is 10 s or more away; it ends a stretch. Time the camera couldn't read is left out of both.
 */
export const FocusSchema = z
  .object({
    /** The length you set; null = until you stopped. */
    plannedMs: ms.nullable(),
    /** Time with a reading (focused + breaks). */
    measuredMs: ms,
    focusedMs: ms,
    /** Longest stretch without a break. */
    longestMs: ms,
    breaks: z.number().int().nonnegative(),
    /** Of the breaks: no face for 30 s or more. */
    leftCount: z.number().int().nonnegative(),
    leftMs: ms,
    /** Focus stretches and breaks, in ms from the start of the session (for the focus map). */
    stretches: z.array(z.object({ startMs: ms, endMs: ms }).strict()).max(400),
    breakSpans: z.array(z.object({ startMs: ms, endMs: ms, left: z.boolean() }).strict()).max(400),
    /** Apps in front, most time first; null when app tracking was off. */
    apps: z.array(FocusAppSchema).max(MAX_FOCUS_APPS + 1).nullable(),
    /** App changes on the app lane: [startMs, endMs, index into `apps`]. */
    appSpans: z.array(z.tuple([ms, ms, z.number().int().min(0).max(MAX_FOCUS_APPS)])).max(2000).nullable(),
    switches: z.number().int().nonnegative().nullable(),
    /** Your Mac's Do Not Disturb: on for the session, not asked for, or the shortcut failed. */
    dnd: z.enum(['on', 'off', 'failed']),
  })
  .strict();
export type FocusResult = z.infer<typeof FocusSchema>;

export const ReportSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{8,64}$/),
    version: z.literal(1),
    mode: ModeSchema,
    startedAt: z.number().int().nonnegative(),
    endedAt: z.number().int().nonnegative(),
    /** 'test' only in automated runs; always labelled in the UI. */
    signal: z.enum(['camera', 'test']),
    content: z
      .object({
        kind: ContentKindSchema,
        /** "Instagram (iPhone Mirroring)", "demo.mp4", "Safari - My project". */
        name: z.string().max(160),
        /** Owning app for a window, else null. */
        app: z.string().max(80).nullable(),
        /** Video length (review of a file). */
        durationMs: ms.nullable(),
      })
      .strict(),
    /** Project name (review), else null. */
    title: z.string().max(120).nullable(),
    /** Stopped early, or ended by a problem. */
    partial: z.boolean(),
    /** Plain-language notes about what limited the reading ("The window closed at 03:12"). */
    notes: z.array(z.string().max(200)).max(8),

    baseline: z
      .object({
        durationMs: ms,
        /** 'weak' when the settle minute never had a clear, steady signal. Comparisons are hidden then. */
        quality: z.enum(['good', 'weak']),
        blinkPerMin: nnum,
        breathPerMin: nnum,
        pulse: nnum,
      })
      .strict(),
    /** Time spent watching (excludes settle and paused video). */
    watchMs: ms,
    metrics: z
      .object({
        blinkPerMin: nnum,
        longestNoBlinkMs: ms.nullable(),
        /** null: breathing couldn't be read (chest out of view), so pauses weren't looked for. */
        holds: z.number().int().nonnegative().nullable(),
        longestHoldMs: ms.nullable(),
        breathPerMin: nnum,
        pulse: nnum,
        pulseDelta: nnum,
        hrvMs: nnum,
        smileMs: ms,
        awayCount: z.number().int().nonnegative(),
        awayMs: ms,
        /** Share of watching time with a clear view of the face, 0-1. */
        coverage: z.number().min(0).max(1),
        /** Large on-screen changes (swipes, scrolls, cuts). Approximate. */
        screenChanges: z.number().int().nonnegative().nullable(),
      })
      .strict(),
    pull: z
      .object({
        score: z.number().int().min(0).max(100).nullable(),
        parts: z.array(PullPartSchema).max(PULL_PARTS.length),
      })
      .strict(),
    events: z.array(ReportEventSchema).max(400),
    /** Attention curve, 0-1 per bin; null where there was no clear signal. */
    curve: z.array(z.number().min(0).max(1).nullable()).max(2000),
    curveBinMs: z.number().int().min(1000).max(120_000),
    /** Whether the curve's x axis is video time (review of a file) or watching time. */
    curveAxis: z.enum(['content', 'watch']),
    /** Self-report, 1 (low) to 5 (great). */
    felt: z.object({ before: rating, after: rating }).strict(),
    /** How long the person thought they had scrolled (feed). */
    guessMs: ms.nullable(),
    /** Reviewer's own scores (review). */
    ratings: z.object({ technology: rating, usability: rating, originality: rating }).strict().nullable(),
    reviewNote: z.string().max(2000).nullable(),
    /** One headline sentence and one suggestion, built from the person's own numbers. */
    summary: z.string().max(300),
    suggestion: z.object({ key: z.string().max(40), text: z.string().max(300) }).strict().nullable(),
    /** Hook test only: every clip, in the order played. Absent in other reports (and in reports saved before). */
    clips: z.array(ClipResultSchema).max(MAX_CLIPS).optional(),
    /** Hook test only: the clip you said you'd post (its index), if you picked one. */
    picked: z.number().int().min(0).max(MAX_CLIPS - 1).nullable().optional(),
    /** Focus session only. Absent in other reports. */
    focus: FocusSchema.optional(),
  })
  .strict();
export type Report = z.infer<typeof ReportSchema>;

/** Thumbnails for one report: key -> small JPEG data URL. Never exported. */
export const THUMB_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
export const MAX_THUMB_BYTES = 120 * 1024;
export const MAX_THUMBS = 24;
export const ThumbsSchema = z
  .record(z.string().regex(/^t[0-9]{1,4}$/), z.string().max(MAX_THUMB_BYTES).regex(THUMB_RE))
  .refine((r) => Object.keys(r).length <= MAX_THUMBS, 'too many thumbnails');
export type Thumbs = z.infer<typeof ThumbsSchema>;

/** The export file (also what "Open a report file" reads). */
export const ExportSchema = z
  .object({
    kind: z.literal('counterfeed-export'),
    version: z.literal(1),
    exportedAt: z.string().max(40),
    note: z.string().max(400),
    reports: z.array(ReportSchema).max(5000),
  })
  .strict();
export type ExportFile = z.infer<typeof ExportSchema>;
