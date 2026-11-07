import type { Mode } from '@counterfeed/shared';
import { minutesLabel } from './score';

/*
 * Every sentence Counterfeed writes about a person's body comes from here: plain, descriptive, about what was
 * measured. It never names a feeling, a brain chemical or a health condition. The words below are checked in
 * the unit tests and on every screen in the e2e suite.
 */

export const BANNED_WORDS = [
  'stress',
  'anxi',
  'addict',
  'dopamine',
  'detox',
  'unhealthy',
  'emotion',
  'diagnos',
  'depress',
  'disorder',
  'symptom',
  'therap',
  'treat',
  'mental health',
  'toxic',
  'cortisol',
  'brain chemical',
] as const;

/** The banned words found in `text` (case-insensitive). Allows the explicit disclaimer phrase "not a brain chemical". */
export function findBanned(text: string): string[] {
  const t = text.toLowerCase().replaceAll('not a brain chemical', '');
  return BANNED_WORDS.filter((w) => t.includes(w));
}

export interface SuggestInputs {
  mode: Mode;
  holds: number;
  activeMin: number;
  blinkDrop: number | null;
  watchMs: number;
  guessMs: number | null;
  feltBefore: number | null;
  feltAfter: number | null;
  awayCount: number;
  /** Review: first and last "looked away" times (ms on the report's axis). */
  awaySpan: [number, number] | null;
  /** Review: hold over the first 30 s (0-1) and the strongest moment (ms on the axis). */
  opening: number | null;
  peakAt: number | null;
  score: number | null;
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * One small suggestion, chosen from the person's own numbers. Each candidate gets a salience (how far the number
 * is from ordinary) and the strongest wins. Worded as "try", never as an instruction about health.
 */
export function suggest(i: SuggestInputs): { key: string; text: string } | null {
  const c: { key: string; s: number; text: string }[] = [];
  if (i.mode === 'feed') {
    const perMin = i.activeMin > 0 ? i.holds / i.activeMin : 0;
    if (i.holds >= 2 && perMin >= 0.4)
      c.push({ key: 'pauses', s: Math.min(1, perMin / 1.5), text: `You paused your breathing ${i.holds} times. Next time, try three slow breaths out before you open the app.` });
    if (i.blinkDrop !== null && i.blinkDrop >= 0.35)
      c.push({ key: 'blinking', s: Math.min(1, i.blinkDrop / 0.6), text: `Your blinking dropped by ${Math.round(i.blinkDrop * 100)}%. Every 10 minutes, try looking at something far away for 20 seconds.` });
    if (i.guessMs !== null && i.watchMs > 0 && (i.watchMs - i.guessMs) / i.watchMs >= 0.3)
      c.push({ key: 'time', s: Math.min(1, (i.watchMs - i.guessMs) / i.watchMs / 0.5), text: `It felt like ${minutesLabel(i.guessMs)} but was ${minutesLabel(i.watchMs)}. Try setting a timer for the length you meant.` });
    if (i.feltBefore !== null && i.feltAfter !== null && i.feltAfter < i.feltBefore)
      c.push({ key: 'felt', s: Math.min(1, (i.feltBefore - i.feltAfter) / 2), text: 'You felt a little lower afterwards. Try ending on something you chose, like a message to a friend.' });
    if (!c.length) return i.score === null ? null : { key: 'none', text: 'This looked close to your normal. Nothing to change.' };
  } else {
    if (i.awayCount >= 2 && i.awaySpan)
      c.push({ key: 'away', s: Math.min(1, i.awayCount / 5), text: `You looked away ${i.awayCount} times between ${mmss(i.awaySpan[0])} and ${mmss(i.awaySpan[1])}. Worth a second look at that part before you score it.` });
    if (i.opening !== null && i.opening < 0.25)
      c.push({ key: 'opening', s: 0.6, text: 'The first 30 seconds didn’t hold you. Many viewers decide in that time, so it may be worth telling the maker.' });
    if (i.peakAt !== null)
      c.push({ key: 'peak', s: 0.3, text: `It held you most at ${mmss(i.peakAt)}. If you write feedback, start there.` });
    if (!c.length) return null;
  }
  c.sort((a, b) => b.s - a.s);
  return { key: c[0]!.key, text: c[0]!.text };
}

export const MODE_WORD: Record<Mode, { score: string; thing: string }> = {
  feed: { score: 'Pull', thing: 'The feed' },
  review: { score: 'Hold', thing: 'The project' },
  hooks: { score: 'Hold', thing: 'The clip' },
  focus: { score: 'Focus', thing: 'The session' },
};

/** The one-sentence headline at the top of a report. */
export function summarize(o: { mode: Mode; score: number | null; band: string; facts: string[]; tooShort?: boolean }): string {
  if (o.tooShort) return 'Too short to read. A report needs at least 20 seconds of watching.';
  if (o.score === null) return 'There wasn’t enough clear signal to read this session. Steady light and staying in view help.';
  const lead = `${o.band} ${o.mode === 'feed' ? 'pull' : 'hold'}`;
  const facts = o.facts.slice(0, 2);
  if (!facts.length) return `${lead}.`;
  return `${lead}: ${facts.join(' and ')}.`;
}
