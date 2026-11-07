import type { EventKind, Report } from '@counterfeed/shared';

export function formatDay(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const yest = new Date(Date.now() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return `Today, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  if (same(d, yest)) return `Yesterday, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "3:07" (minutes:seconds), for positions on a timeline. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "4 min 12 s", "45 s". */
export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}

export const EVENT_META: Record<EventKind, { label: string; color: string; bar: boolean }> = {
  hold: { label: 'Breathing pause', color: '--ev-hold', bar: true },
  noblink: { label: 'Unbroken stare', color: '--ev-stare', bar: true },
  smile: { label: 'Smile', color: '--ev-face', bar: false },
  surprise: { label: 'Surprise', color: '--ev-face', bar: false },
  frown: { label: 'Frown', color: '--ev-face', bar: false },
  away: { label: 'Looked away', color: '--ev-away', bar: false },
};

/** Self-report scale (how you feel), 1-5. Words, not faces, so nobody has to read an emoji. */
export const FELT = ['Low', 'Meh', 'Okay', 'Good', 'Great'] as const;
export const feltWord = (v: number | null) => (v === null ? '–' : FELT[v - 1] ?? '–');

export const MODE_LABEL: Record<Report['mode'], string> = { feed: 'Feed check', review: 'Review', hooks: 'Hook test', focus: 'Focus session' };

export function sourceLabel(r: Pick<Report, 'content' | 'title' | 'mode'> & { clips?: Report['clips'] }): string {
  if (r.mode === 'hooks') return r.title || `${r.clips?.length ?? 0} clips`;
  if (r.mode === 'focus') return r.title || 'Focus session';
  if (r.mode === 'review' && r.title) return r.title;
  return r.content.name || (r.mode === 'feed' ? 'Feed' : 'Project');
}

export function round(v: number | null, digits = 0): string {
  if (v === null || !Number.isFinite(v)) return '–';
  return v.toFixed(digits);
}
