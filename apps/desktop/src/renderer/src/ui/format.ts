import type { PhaseResult } from '@together/shared';

export function formatDay(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const yest = new Date(Date.now() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return `today, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  if (same(d, yest)) return 'yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Fewer usable surrogates than this and we don't claim anything about chance. */
export const MIN_SURROGATES = 100;

/**
 * Turn a phase result into honest words. "Above chance" is claimed only when the observed value beats at
 * least 95 % of at least 100 circular-shift surrogates; otherwise we say it looks like chance, or that there
 * wasn't enough data to tell.
 */
export function verdict(r: PhaseResult | null): { headline: string; short: string; detail: string; strong: boolean } {
  if (!r) return { headline: 'Not enough quiet signal to compare', short: 'Not enough signal', detail: 'Stillness, steady light and not talking all help.', strong: false };
  const x = r.ratio;
  const pct = Math.round(r.percentile);
  if (r.chance.n < MIN_SURROGATES) {
    return { headline: 'Too short to compare with chance', short: 'Too short to tell', detail: `There were ${Math.round(r.plv * 100)} points of steady rhythm, but not enough clean signal to test it against chance.`, strong: false };
  }
  if (r.percentile >= 95 && x >= 1.05) {
    return {
      headline: `${x.toFixed(1)}× more in step than chance`,
      short: `${x.toFixed(1)}× in step`,
      detail: `More in step than ${pct}% of random pairings of the same two breaths.`,
      strong: true,
    };
  }
  return {
    headline: 'About as in step as chance',
    short: 'Like chance',
    detail:
      pct < 50
        ? 'Two people breathing at a similar pace look this in step by accident; there was no sign of syncing up beyond that.'
        : `More in step than ${pct}% of random pairings of the same breaths; it takes 95% to call it more than chance.`,
    strong: false,
  };
}
