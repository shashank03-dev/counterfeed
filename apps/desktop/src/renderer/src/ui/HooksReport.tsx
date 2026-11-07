import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { ClipResult, Report as R, Thumbs } from '@counterfeed/shared';
import { smooth } from '../analysis/curve';
import { clipName, HOOK_LABEL, isCloseCall } from '../analysis/hooks';
import { Icon } from './icons';
import { Button, cx } from './kit';
import { clock, duration, formatDay } from './format';
import { Disclosure, Notes } from './Report';
import { useWidth } from './viz';

/**
 * Hook test report: the winner and why, every clip ranked with its first 3 seconds, and each clip second by
 * second. Clips play again from any second while the session is open (History keeps the stills, not the files).
 */
export function HooksReport({ report: r, thumbs, clipUrls, banner }: { report: R; thumbs: Thumbs; clipUrls: string[] | null; banner?: ReactNode }) {
  const clips = useMemo(() => r.clips ?? [], [r.clips]);
  const ranked = useMemo(() => clips.filter((c) => c.rank !== null).sort((a, b) => a.rank! - b.rank!), [clips]);
  const rest = clips.filter((c) => c.rank === null);
  const winner = ranked.length >= 2 ? ranked[0]! : null;
  const close = isCloseCall(clips);
  const picked = r.picked == null ? null : (clips.find((c) => c.index === r.picked) ?? null);
  const still = (c: ClipResult | null) => (c?.thumb ? (thumbs[c.thumb] ?? null) : null);
  const [playing, setPlaying] = useState<{ index: number; fromMs: number } | null>(null);
  const player = useRef<HTMLVideoElement>(null);
  const canPlay = !!clipUrls?.length;
  const play = (c: ClipResult, fromMs: number) => {
    if (!canPlay || !clipUrls![c.index]) return;
    setPlaying({ index: c.index, fromMs });
    requestAnimationFrame(() => {
      const v = player.current;
      if (!v) return;
      v.currentTime = Math.max(0, fromMs / 1000 - 0.5);
      void v.play().catch(() => {});
    });
  };
  const spanMs = Math.max(1000, ...ranked.map((c) => c.durationMs));

  return (
    <div className="grid gap-4" data-testid="report">
      {banner}
      <header className="rise" style={{ ['--i' as string]: 0 }}>
        <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-fg/[0.06] px-2 py-0.5 font-medium text-fg">
            <Icon.Clips size={13} />
            Hook test
          </span>
          <span>{formatDay(r.startedAt)}</span>
          <span aria-hidden>·</span>
          <span className="tnum" data-testid="watched">{duration(r.watchMs)} watched</span>
          <span aria-hidden>·</span>
          <span className="tnum">{clips.length} clips</span>
          {r.signal === 'test' && <span className="rounded-full bg-warn/15 px-2 py-0.5 font-medium text-warn">Test signal</span>}
          {r.partial && <span className="rounded-full bg-fg/[0.06] px-2 py-0.5">Ended early</span>}
        </div>
        <h1 className="truncate font-display text-[26px] leading-tight font-semibold tracking-[-0.03em]" data-testid="report-title">
          {r.title || `${clips.length} clips`}
        </h1>
      </header>

      {/* Hero: the winner, one sentence, your pick next to your body's, one suggestion. */}
      <section className="rise grid items-center gap-6 rounded-[18px] bg-surface p-6 shadow-panel md:grid-cols-[auto_1fr]" style={{ ['--i' as string]: 1 }} data-testid="hook-winner">
        <div className="grid justify-items-center gap-2">
          <button type="button" onClick={() => winner && play(winner, winner.bestMs ?? 0)} disabled={!winner || !canPlay} className="relative h-[234px] w-[132px] overflow-hidden rounded-[16px] bg-surface-3 ring-2 ring-hook ring-offset-2 ring-offset-surface enabled:cursor-pointer" aria-label={winner ? `Play ${clipName(winner.name)}` : 'No winner'}>
            {still(winner) ? <img src={still(winner)!} alt="" className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center text-fg-dim"><Icon.Clips size={26} /></span>}
            {winner && <span className="tnum absolute top-2 left-2 rounded-full bg-g-hook px-2 py-0.5 text-[11.5px] font-semibold text-white">#1</span>}
          </button>
          <div className="text-center">
            <div className="tnum font-display text-[30px] leading-none font-semibold tracking-[-0.03em]" data-testid="score-ring">{winner?.score ?? '–'}</div>
            <div className="mt-1 text-[11px] font-semibold tracking-[0.08em] text-fg-dim uppercase">Hold</div>
          </div>
        </div>
        <div className="min-w-0">
          <p className="font-display text-[19px] leading-snug font-medium tracking-[-0.015em] text-fg" data-testid="summary">
            {r.summary}
          </p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-fg-dim">Hold score: how long you stayed, times how strongly the clip held you while it played. Measured against your own normal.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {close && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-fg/[0.06] px-2.5 py-1 text-[12px] font-medium text-fg-muted" data-testid="close-call">
                <Icon.Info size={13} />
                Close call: the top two are within a few points
              </span>
            )}
            {picked && winner && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-hook-soft px-2.5 py-1 text-[12px] font-medium text-fg" data-testid="hook-pick">
                <Icon.Check size={13} className="text-hook" />
                {picked.index === winner.index ? `You’d post ${clipName(picked.name)} too. Your pick and your body agree.` : `You’d post ${clipName(picked.name)}. Your body stayed with ${clipName(winner.name)}.`}
              </span>
            )}
          </div>
          {r.suggestion && (
            <div className="mt-4 flex items-start gap-3 rounded-[14px] border border-line bg-surface-2 px-4 py-3" data-testid="suggestion">
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-g-hook text-white">
                <Icon.Sparkle size={15} />
              </span>
              <div>
                <div className="text-[11px] font-semibold tracking-[0.07em] text-fg-dim uppercase">One thing to try</div>
                <div className="mt-0.5 text-[13.5px] leading-relaxed text-fg">{r.suggestion.text}</div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Every clip, ranked. */}
      <section className="rise rounded-[18px] bg-surface p-5 shadow-panel" style={{ ['--i' as string]: 2 }}>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[14px] font-semibold">Every clip, ranked</h2>
          <span className="text-[12px] text-fg-dim">By how strongly each one held you{canPlay ? ' · click to play its strongest moment' : ''}</span>
        </div>
        <ol className="grid gap-1.5" data-testid="hook-ranking">
          {[...ranked, ...rest].map((c) => (
            <ClipRow key={c.index} c={c} still={still(c)} onPlay={canPlay && c.rank !== null ? () => play(c, c.bestMs ?? 0) : undefined} active={playing?.index === c.index} />
          ))}
        </ol>
      </section>

      {/* Player (while the session's files are still available). */}
      {playing && clipUrls?.[playing.index] && (
        <section className="fade flex items-center gap-5 rounded-[18px] bg-surface p-4 shadow-panel" data-testid="hook-player">
          <video ref={player} src={clipUrls[playing.index]} crossOrigin="anonymous" playsInline controls className="h-[300px] w-[169px] shrink-0 rounded-[12px] bg-black object-contain" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold tracking-[0.07em] text-fg-dim uppercase">Playing</div>
            <div className="mt-0.5 truncate text-[15px] font-semibold">{clipName(clips.find((c) => c.index === playing.index)?.name ?? '')}</div>
            <div className="tnum mt-0.5 text-[12.5px] text-fg-muted">from {clock(playing.fromMs)}</div>
          </div>
          <Button size="sm" variant="ghost" icon={<Icon.X />} onClick={() => setPlaying(null)}>
            Close
          </Button>
        </section>
      )}

      {/* Second by second. */}
      {ranked.length > 0 && (
        <section className="rise rounded-[18px] bg-surface p-5 shadow-panel" style={{ ['--i' as string]: 3 }} data-testid="hook-curves">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[14px] font-semibold">Second by second</h2>
            <span className="text-[12px] text-fg-dim">How strongly each clip held you{canPlay ? ' · click any second to play from there' : ''}</span>
          </div>
          <div className="grid gap-2.5">
            {ranked.map((c) => (
              <ClipCurve key={c.index} c={c} spanMs={spanMs} onPick={canPlay ? (ms) => play(c, ms) : undefined} />
            ))}
          </div>
          {/* Shared time axis: every row uses the same scale, so clip lengths compare. */}
          <div className="mt-1 grid grid-cols-[150px_1fr] gap-3" aria-hidden>
            <span />
            <div className="relative h-4">
              {axisTicks(spanMs).map((t) => (
                <span key={t} className="tnum absolute -translate-x-1/2 text-[10.5px] text-fg-dim first:translate-x-0" style={{ left: `${(t / spanMs) * 100}%` }}>
                  {clock(t)}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px] text-fg-muted">
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-hook" />Grabbed you</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 border-l border-dashed border-fg-muted" />Swiped</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm bg-fg/[0.14]" />How strongly it held you</span>
          </div>
        </section>
      )}

      <Disclosure title="How each clip is scored" testId="how-built">
        <div className="grid gap-3 text-[12.5px] leading-relaxed text-fg-muted">
          <p>
            <span className="font-medium text-fg">Hold score</span> = how much of the clip you watched before swiping × (0.35 + 0.65 × how strongly it held you while it played). Staying multiplies everything, so a clip you swiped early can’t outrank one you watched.
          </p>
          <p>
            <span className="font-medium text-fg">How strongly it held you</span> comes from facing the screen (the SmartSpectra face check and your head position), going longer than your usual gap without blinking, and strong smile or surprise probabilities. SmartSpectra misses some blinks, so staying and facing the screen count for more.
          </p>
          <p>
            <span className="font-medium text-fg">The first 3 seconds.</span> Landed: it held you strongly within 3 s. Slow start: it did, but later. Kept you: you stayed and faced it, nothing stood out. Lost you: you swiped or looked away within 3 s.
          </p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {ranked.map((c) => (
              <div key={c.index} className="rounded-[12px] bg-surface-2 px-3.5 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[12.5px] font-medium text-fg">{clipName(c.name)}</span>
                  <span className="tnum text-[12px] text-fg">{c.score}</span>
                </div>
                <ul className="mt-1 grid gap-0.5 text-[12px]">
                  {c.parts.map((p) => (
                    <li key={p.key}>{p.detail}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p>The clips play in a shuffled order unless you turn that off, so no clip gains from going first. One viewer is one viewer: try your clips on a few people.</p>
        </div>
      </Disclosure>

      <Disclosure title="How this is measured" testId="details">
        <dl className="grid gap-x-8 gap-y-2 text-[12.5px] sm:grid-cols-2">
          <div className="flex items-baseline justify-between gap-4 border-b border-line py-1.5"><dt className="text-fg-muted">Your normal</dt><dd className="tnum text-fg">{duration(r.baseline.durationMs)} · {r.baseline.quality === 'good' ? 'clear' : 'not clear, blink comparisons left out'}</dd></div>
          <div className="flex items-baseline justify-between gap-4 border-b border-line py-1.5"><dt className="text-fg-muted">Clear view of your face</dt><dd className="tnum text-fg">{Math.round(r.metrics.coverage * 100)}% of the time</dd></div>
          <div className="flex items-baseline justify-between gap-4 border-b border-line py-1.5"><dt className="text-fg-muted">Clips watched</dt><dd className="tnum text-fg">{ranked.length} of {clips.length}</dd></div>
          <div className="flex items-baseline justify-between gap-4 border-b border-line py-1.5"><dt className="text-fg-muted">Signal</dt><dd className="text-fg">{r.signal === 'test' ? 'Test signal (automated run)' : 'SmartSpectra, on this Mac'}</dd></div>
        </dl>
      </Disclosure>

      {r.notes.length > 0 && <Notes notes={r.notes} />}

      <p className="pb-2 text-center text-[11.5px] text-fg-dim">
        Wellness information, not a medical measurement. The Hold score shows how strongly each clip held one viewer’s attention. It is not a brain chemical or a health measure, and it never compares you with anyone else.
      </p>
    </div>
  );
}

const STATUS = (c: ClipResult) =>
  c.status === 'finished'
    ? 'Watched to the end'
    : c.status === 'skipped'
      ? `Swiped at ${clock(c.leftAtMs ?? 0)} of ${clock(c.durationMs)}`
      : c.status === 'stopped'
        ? `Session ended at ${clock(c.leftAtMs ?? 0)} of ${clock(c.durationMs)}`
        : c.status === 'failed'
          ? 'Couldn’t play'
          : 'Not watched';

function hookText(c: ClipResult): string {
  if (c.rank === null) return '';
  if (c.hook === 'slow' && c.grabbedAtMs !== null) return `Slow start · grabbed you at ${clock(c.grabbedAtMs)}`;
  return HOOK_LABEL[c.hook];
}

function ClipRow({ c, still, onPlay, active }: { c: ClipResult; still: string | null; onPlay?: () => void; active: boolean }) {
  const ranked = c.rank !== null;
  const tone = c.hook === 'landed' ? 'text-fg' : c.hook === 'lost' ? 'text-fg-dim' : 'text-fg-muted';
  return (
    <li data-testid="hook-row" data-name={c.name} data-rank={c.rank ?? ''} data-hook={c.hook} data-status={c.status} data-score={c.score ?? ''}>
      <button
        type="button"
        onClick={onPlay}
        disabled={!onPlay}
        className={cx('grid w-full grid-cols-[28px_40px_1fr] items-center gap-3 rounded-[12px] px-2 py-2 text-left transition-colors md:grid-cols-[28px_40px_1fr_220px_190px]', onPlay && 'hover:bg-fg/[0.04]', active && 'bg-fg/[0.05]', !ranked && 'opacity-60')}
      >
        <span className={cx('tnum grid size-7 place-items-center rounded-full text-[12.5px] font-semibold', c.rank === 1 ? 'bg-g-hook text-white' : 'bg-fg/[0.07] text-fg-muted')}>{c.rank ?? '–'}</span>
        <span className="block h-[71px] w-10 overflow-hidden rounded-[7px] bg-surface-3">{still ? <img src={still} alt="" className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center text-fg-dim"><Icon.Clips size={14} /></span>}</span>
        <span className="min-w-0">
          <span className="block truncate text-[13.5px] font-medium">{clipName(c.name)}</span>
          <span className="tnum block truncate text-[12px] text-fg-dim">
            {STATUS(c)} · played {c.index + 1}
            {c.awayMs >= 1000 ? ` · looked away ${Math.round(c.awayMs / 1000)} s` : ''}
          </span>
        </span>
        <span className={cx('hidden truncate text-[12.5px] md:block', tone)} data-testid="hook-verdict">{hookText(c)}</span>
        <span className="hidden items-center gap-3 md:flex">
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-fg/[0.07]">
            {ranked && <span className="block h-full rounded-full bg-g-hook-meter" style={{ width: `${Math.max(2, c.score ?? 0)}%` }} />}
          </span>
          <span className="tnum w-7 text-right text-[13px] font-semibold" data-testid="hook-score">{c.score ?? '–'}</span>
        </span>
      </button>
    </li>
  );
}

/** Tick positions (ms) for the shared clip axis: every 5, 10, 15 or 30 s, never more than 7 labels. */
function axisTicks(spanMs: number): number[] {
  const step = [5000, 10_000, 15_000, 30_000, 60_000].find((s) => spanMs / s <= 6) ?? 60_000;
  const out: number[] = [];
  for (let t = 0; t <= spanMs - step / 3; t += step) out.push(t);
  return out;
}

const level = (v: number) => (v >= 0.85 ? 'held you strongly' : v >= 0.6 ? 'held you' : v >= 0.35 ? 'watching' : 'looked away or drifting');

/** One clip's attention, second by second, on an x axis shared by every clip (so lengths compare). */
function ClipCurve({ c, spanMs, onPick }: { c: ClipResult; spanMs: number; onPick?: (ms: number) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 40;
  const plotW = Math.max(10, width);
  const sx = (ms: number) => (Math.min(spanMs, Math.max(0, ms)) / spanMs) * plotW;
  const sy = (v: number) => 3 + (1 - v) * (H - 6);
  const sm = useMemo(() => smooth(c.curve), [c.curve]);
  const segs = useMemo(() => {
    const out: { x: number; y: number }[][] = [];
    let cur: { x: number; y: number }[] = [];
    sm.forEach((v, i) => {
      if (v === null) {
        if (cur.length) out.push(cur);
        cur = [];
      } else cur.push({ x: sx((i + 0.5) * 1000), y: sy(v) });
    });
    if (cur.length) out.push(cur);
    return out.map((p) => {
      const pts = p.length === 1 ? [{ x: p[0]!.x - 2, y: p[0]!.y }, { x: p[0]!.x + 2, y: p[0]!.y }] : p;
      const line = pts.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`).join('');
      return { line, area: `${line}L${pts[pts.length - 1]!.x.toFixed(1)},${H}L${pts[0]!.x.toFixed(1)},${H}Z` };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sm, spanMs, plotW]);
  const bin = hover === null ? null : Math.min(sm.length - 1, Math.max(0, Math.floor(((hover / plotW) * spanMs) / 1000)));
  const hv = bin === null ? null : sm[bin];
  return (
    <div className="grid grid-cols-[150px_1fr] items-center gap-3" data-testid="hook-curve" data-name={c.name}>
      <div className="min-w-0">
        <div className="truncate text-[12.5px] font-medium">{clipName(c.name)}</div>
        <div className="tnum text-[11.5px] text-fg-dim">{clock(c.durationMs)}</div>
      </div>
      <div ref={ref} className="relative">
        {width > 0 && (
          <svg
            width={width}
            height={H}
            className={cx('block overflow-visible', onPick && 'cursor-pointer')}
            role="img"
            aria-label={`${clipName(c.name)}: attention second by second`}
            onMouseMove={(e) => setHover(e.clientX - e.currentTarget.getBoundingClientRect().left)}
            onMouseLeave={() => setHover(null)}
            onClick={(e) => onPick?.(Math.floor((((e.clientX - e.currentTarget.getBoundingClientRect().left) / plotW) * spanMs) / 1000) * 1000)}
          >
            <rect x={0} y={0} width={sx(c.durationMs)} height={H} rx={6} fill="var(--fg)" opacity={0.035} />
            {segs.map((p, i) => (
              <g key={i}>
                <path d={p.area} fill="var(--fg)" opacity={0.12} />
                <path d={p.line} fill="none" stroke="var(--fg)" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
              </g>
            ))}
            {c.leftAtMs !== null && c.status !== 'finished' && (
              <g>
                <line x1={sx(c.leftAtMs)} x2={sx(c.leftAtMs)} y1={0} y2={H} stroke="var(--fg-muted)" strokeDasharray="3 3" />
                <text x={sx(c.leftAtMs) + 4} y={10} className="fill-fg-dim text-[10px]">{c.status === 'skipped' ? 'swiped' : 'ended'}</text>
              </g>
            )}
            {c.grabbedAtMs !== null && <circle cx={sx(c.grabbedAtMs + 500)} cy={sy(sm[Math.floor(c.grabbedAtMs / 1000)] ?? 0.9)} r={4.5} fill="var(--hook)" stroke="var(--surface)" strokeWidth={2} data-testid="hook-grab" />}
            {hover !== null && <line x1={hover} x2={hover} y1={0} y2={H} stroke="var(--fg-dim)" strokeWidth={1} />}
          </svg>
        )}
        {hover !== null && bin !== null && (
          <div className="pointer-events-none absolute -top-8 z-10 -translate-x-1/2 rounded-[8px] bg-overlay px-2 py-1 text-[11.5px] whitespace-nowrap shadow-pop" style={{ left: hover }}>
            <span className="tnum">{clock(bin * 1000)}</span>
            <span className="text-fg-muted"> · {hv === null || hv === undefined ? 'no clear view' : level(hv)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
