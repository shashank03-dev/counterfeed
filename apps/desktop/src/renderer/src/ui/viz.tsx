import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ReportEvent, Thumbs } from '@counterfeed/shared';
import { smooth } from '../analysis/curve';
import { session } from '../session/controller';
import type { TraceSample } from '../sensing/normalize';
import { Icon } from './icons';
import { cx } from './kit';
import { EVENT_META, clock } from './format';

/* ------------------------------------------------------------------ brand */

/**
 * Two discs that overlap: you (tomato) and what you watch (jade). Each is lit within its own hue; the front disc
 * is cut out with a ring of the surface colour, like overlapping avatars, so the hues never mix. The ring matches
 * the panel unless the parent sets `--mark-ring` to the colour it sits on.
 */
export function BrandMark({ size = 28, still }: { size?: number; still?: boolean }) {
  const r = size * 0.3;
  const dot = (side: -1 | 1, hi: string, mid: string, lo: string, ring: boolean) => (
    <span
      className="absolute top-1/2 left-1/2 rounded-full"
      style={{
        width: r * 2,
        height: r * 2,
        marginLeft: -r,
        marginTop: -r,
        background: `radial-gradient(circle at 35% 28%, ${hi}, ${mid} 58%, ${lo})`,
        boxShadow: ring ? `0 0 0 ${Math.max(1.5, size * 0.06)}px var(--mark-ring, var(--panel))` : undefined,
        ['--dx' as string]: `${side * size * 0.19}px`,
        transform: `translateX(${side * size * 0.19}px)`,
      }}
    />
  );
  return (
    <span className={cx('relative isolate inline-block shrink-0', !still && 'breathe')} style={{ width: size, height: size }} aria-hidden>
      {dot(1, 'var(--feed-hi)', 'var(--feed)', 'var(--feed-lo)', false)}
      {dot(-1, 'var(--you-hi)', 'var(--you)', 'var(--you-lo)', true)}
    </span>
  );
}

/** One hue, highlight step to solid step (the score ring and progress). Never a multi-hue ramp. */
export function AccentGradient({ id, vertical, rotate }: { id: string; vertical?: boolean; rotate?: number }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2={vertical ? '0' : '1'} y2={vertical ? '1' : '0'} gradientTransform={rotate ? `rotate(${rotate} 0.5 0.5)` : undefined}>
      <stop offset="0" stopColor="var(--meter-1)" />
      <stop offset="1" stopColor="var(--meter-2)" />
    </linearGradient>
  );
}

function readColor(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#999';
}

/* ------------------------------------------------------------------ live breathing wave */

/**
 * Your breathing wave, live. Reads the session's buffer every animation frame (never through React). Display-only
 * processing: a running-mean detrend and a slowly adapting scale so the wave sits calmly. A breathing pause shows
 * as the line going flat, which is exactly what the report counts.
 */
export function LiveWave({ seconds = 14, className, testId, source }: { seconds?: number; className?: string; testId?: string; source?: () => readonly TraceSample[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = el.getContext('2d')!;
    let raf = 0;
    let w = 0;
    let h = 0;
    let scale = 0;
    let color = readColor('--you');
    let line = readColor('--line-strong');
    const mo = new MutationObserver(() => {
      color = readColor('--you');
      line = readColor('--line-strong');
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const resize = () => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = r.width;
      h = r.height;
      el.width = Math.max(1, Math.round(w * dpr));
      el.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      const buf = source ? source() : session.liveTrace();
      if (buf.length > 8) {
        const end = buf[buf.length - 1]!.t;
        const from = end - seconds * 1e6;
        const pts = buf.filter((s) => s.t >= from - 4e6);
        // Running mean over ~5 s as the display baseline.
        const mean: number[] = [];
        let j = 0;
        let sum = 0;
        for (let i = 0; i < pts.length; i++) {
          sum += pts[i]!.v;
          while (pts[i]!.t - pts[j]!.t > 5e6) sum -= pts[j++]!.v;
          mean.push(sum / (i - j + 1));
        }
        let peak = 0;
        for (let i = 0; i < pts.length; i++) if (pts[i]!.t >= from) peak = Math.max(peak, Math.abs(pts[i]!.v - mean[i]!));
        scale = scale ? scale + 0.04 * (Math.max(peak, 1e-6) - scale) : Math.max(peak, 1e-6);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i]!;
          if (p.t < from) continue;
          const x = ((p.t - from) / (seconds * 1e6)) * w;
          const y = h / 2 - ((p.v - mean[i]!) / scale) * (h * 0.38);
          if (!started) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          started = true;
        }
        ctx.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
    };
  }, [seconds, source]);
  return <canvas ref={ref} data-testid={testId} className={cx('block h-full w-full', className)} role="img" aria-label="Your breathing wave, live" />;
}

/* ------------------------------------------------------------------ rings */

/** The Pull / Hold score as a 300° arc, one hue from its highlight step to its solid step. */
export function ScoreRing({ value, label, size = 176, testId }: { value: number | null; label: string; size?: number; testId?: string }) {
  const r = size / 2 - 11;
  const c = 2 * Math.PI * r;
  const arc = c * (300 / 360);
  const v = value === null ? 0 : Math.max(0, Math.min(100, value)) / 100;
  const id = useId();
  return (
    <div data-testid={testId} className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} role="meter" aria-label={`${label} score`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0" style={{ transform: 'rotate(120deg)' }}>
        <defs>
          <AccentGradient id={id} rotate={-120} />
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-strong)" strokeWidth={10} strokeLinecap="round" strokeDasharray={`${arc} ${c}`} />
        {value !== null && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${CSS.escape(id)})`} strokeWidth={10} strokeLinecap="round" strokeDasharray={`${Math.max(0.001, arc * v)} ${c}`} className="ring-in" style={{ ['--arc' as string]: `${arc * v}` }} />
        )}
      </svg>
      <div className="relative text-center">
        <div className="tnum font-display text-[52px] leading-none font-semibold tracking-[-0.045em] text-fg">{value === null ? '–' : value}</div>
        <div className="mt-1.5 text-[11px] font-semibold tracking-[0.1em] text-fg-dim uppercase">{label}</div>
      </div>
    </div>
  );
}

/** Settle progress: fills while the camera has a clear view. */
export function ProgressRing({ progress, size = 112, children }: { progress: number; size?: number; children?: ReactNode }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const id = useId();
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <defs>
          <AccentGradient id={id} vertical />
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-strong)" strokeWidth={4} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${CSS.escape(id)})`} strokeWidth={4} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, progress)))} style={{ transition: 'stroke-dashoffset 300ms linear' }} />
      </svg>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ camera preview */

/** The camera, only to help you frame yourself. Mirrored like a mirror. */
export function CameraPreview({ stream, className, children }: { stream: MediaStream | null; className?: string; children?: ReactNode }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    if (stream) void v.play().catch(() => {});
  }, [stream]);
  return (
    <div className={cx('relative overflow-hidden bg-surface-3', className)}>
      {stream ? <video ref={ref} muted playsInline className="h-full w-full scale-x-[-1] object-cover" /> : !children && <div className="grid h-full w-full place-items-center text-fg-dim"><Icon.Video size={22} /></div>}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ attention timeline */

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e!.contentRect.width)));
    ro.observe(el);
    setW(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function niceTicks(spanMs: number): number[] {
  const steps = [10, 15, 30, 60, 120, 300, 600, 900, 1800].map((s) => s * 1000);
  const step = steps.find((s) => spanMs / s <= 7) ?? 3_600_000;
  const out: number[] = [];
  for (let t = 0; t <= spanMs; t += step) out.push(t);
  return out;
}

export interface TimelineEvent extends ReportEvent {
  x: number;
}

/**
 * Attention over time (one series: no legend box, the title names it), with the moments on a lane below and
 * "looked away" as hatched bands behind. Crosshair tooltip on the curve; each moment has its own tooltip and is
 * clickable. Text stays in text colours; colour only marks identity, always with an icon in the legend.
 */
export function AttentionTimeline({
  curve,
  binMs,
  spanMs,
  events,
  thumbs,
  selected,
  onSelect,
  testId,
}: {
  curve: (number | null)[];
  binMs: number;
  spanMs: number;
  events: TimelineEvent[];
  thumbs: Thumbs;
  selected: string | null;
  onSelect: (id: string) => void;
  testId?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ x: number; kind: 'curve' | 'event'; id?: string } | null>(null);
  const gid = useId();
  const H = 132;
  const LANE = 30;
  const PAD_L = 34;
  const PAD_R = 8;
  const plotW = Math.max(10, width - PAD_L - PAD_R);
  const sx = (ms: number) => PAD_L + (Math.min(spanMs, Math.max(0, ms)) / Math.max(1, spanMs)) * plotW;
  const sy = (v: number) => 8 + (1 - v) * (H - 16);
  const sm = useMemo(() => smooth(curve), [curve]);

  // Area path, broken where there was no signal.
  const paths = useMemo(() => {
    const segs: { x: number; y: number }[][] = [];
    let cur: { x: number; y: number }[] = [];
    sm.forEach((v, i) => {
      if (v === null) {
        if (cur.length) segs.push(cur);
        cur = [];
        return;
      }
      cur.push({ x: sx((i + 0.5) * binMs), y: sy(v) });
    });
    if (cur.length) segs.push(cur);
    return segs.map((p) => {
      const pts = p.length === 1 ? [{ x: p[0]!.x - 3, y: p[0]!.y }, { x: p[0]!.x + 3, y: p[0]!.y }] : p;
      const line = pts.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`).join('');
      const area = `${line}L${pts[pts.length - 1]!.x.toFixed(1)},${sy(0)}L${pts[0]!.x.toFixed(1)},${sy(0)}Z`;
      return { line, area };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sm, binMs, spanMs, plotW]);

  const away = events.filter((e) => e.kind === 'away');
  const marks = events.filter((e) => e.kind !== 'away');
  const hoverEvent = hover?.kind === 'event' ? events.find((e) => e.id === hover.id) : null;
  const hoverBin = hover?.kind === 'curve' ? Math.min(sm.length - 1, Math.max(0, Math.floor((((hover.x - PAD_L) / plotW) * spanMs) / binMs))) : null;
  const ticks = niceTicks(spanMs);

  return (
    <div ref={ref} data-testid={testId} className="relative w-full select-none">
      {width > 0 && (
        <svg width={width} height={H + LANE + 22} className="block overflow-visible" role="img" aria-label="Attention over time, with moments">
          <defs>
            <linearGradient id={`${gid}-a`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--fg)" stopOpacity="0.14" />
              <stop offset="1" stopColor="var(--fg)" stopOpacity="0" />
            </linearGradient>
            <pattern id={`${gid}-h`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="1.6" height="6" fill="var(--ev-away)" opacity="0.5" />
            </pattern>
          </defs>
          {/* Grid: recessive. */}
          {[0, 0.5, 1].map((v) => (
            <g key={v}>
              <line x1={PAD_L} x2={PAD_L + plotW} y1={sy(v)} y2={sy(v)} stroke="var(--line)" strokeDasharray={v === 0 ? undefined : '2 4'} />
              <text x={PAD_L - 6} y={sy(v) + 3.5} textAnchor="end" className="fill-fg-dim text-[10px]">
                {v === 1 ? 'High' : v === 0.5 ? 'Mid' : 'Low'}
              </text>
            </g>
          ))}
          {/* Looked away: hatched bands behind. */}
          {away.map((e) => (
            <rect key={e.id} x={sx(e.x)} y={6} width={Math.max(3, sx(e.x + e.durMs) - sx(e.x))} height={H + LANE - 6} fill={`url(#${CSS.escape(`${gid}-h`)})`} rx={2} onMouseEnter={() => setHover({ x: sx(e.x), kind: 'event', id: e.id })} onMouseLeave={() => setHover(null)} onClick={() => onSelect(e.id)} className="cursor-pointer" data-testid="tl-away" />
          ))}
          {paths.map((p, i) => (
            <g key={i}>
              <path d={p.area} fill={`url(#${CSS.escape(`${gid}-a`)})`} />
              <path d={p.line} fill="none" stroke="var(--fg)" strokeOpacity={0.82} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          ))}
          {/* Crosshair hit area. */}
          <rect
            x={PAD_L}
            y={0}
            width={plotW}
            height={H}
            fill="transparent"
            onMouseMove={(e) => {
              const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
              setHover({ x: e.clientX - r.left, kind: 'curve' });
            }}
            onMouseLeave={() => setHover(null)}
          />
          {hoverBin !== null && sm[hoverBin] != null && (
            <g pointerEvents="none">
              <line x1={sx((hoverBin + 0.5) * binMs)} x2={sx((hoverBin + 0.5) * binMs)} y1={4} y2={H} stroke="var(--fg-dim)" strokeDasharray="2 3" />
              <circle cx={sx((hoverBin + 0.5) * binMs)} cy={sy(sm[hoverBin]!)} r={4.5} fill="var(--fg)" stroke="var(--surface)" strokeWidth={2} />
            </g>
          )}
          {/* Moments lane. */}
          <line x1={PAD_L} x2={PAD_L + plotW} y1={H + LANE / 2} y2={H + LANE / 2} stroke="var(--line)" />
          {marks.map((e) => {
            const meta = EVENT_META[e.kind];
            const x0 = sx(e.x);
            const wBar = Math.max(8, sx(e.x + e.durMs) - x0);
            const sel = selected === e.id;
            return (
              <g key={e.id} className="cursor-pointer" onMouseEnter={() => setHover({ x: x0, kind: 'event', id: e.id })} onMouseLeave={() => setHover(null)} onClick={() => onSelect(e.id)} data-testid={`tl-${e.kind}`}>
                <rect x={x0 - 4} y={H + 4} width={wBar + 8} height={LANE - 8} fill="transparent" />
                {meta.bar ? (
                  <rect x={x0} y={H + LANE / 2 - 4} width={wBar} height={8} rx={4} fill={`var(${meta.color})`} stroke="var(--surface)" strokeWidth={2} paintOrder="stroke" />
                ) : (
                  <circle cx={x0} cy={H + LANE / 2} r={5} fill={`var(${meta.color})`} stroke="var(--surface)" strokeWidth={2} />
                )}
                {sel && <rect x={x0 - 3} y={H + LANE / 2 - 8} width={(meta.bar ? wBar : 0) + 6} height={16} rx={6} fill="none" stroke="var(--fg)" strokeWidth={1.5} />}
              </g>
            );
          })}
          {/* X axis. */}
          {ticks.map((t) => (
            <text key={t} x={sx(t)} y={H + LANE + 16} textAnchor={t === 0 ? 'start' : 'middle'} className="tnum fill-fg-dim text-[10px]">
              {clock(t)}
            </text>
          ))}
        </svg>
      )}
      {hover && (hoverEvent || (hoverBin !== null && sm[hoverBin] != null)) && (
        <div className="pointer-events-none absolute z-10 w-max max-w-[240px] -translate-x-1/2 rounded-[10px] border border-line-strong bg-overlay p-2 text-[11.5px] shadow-pop" style={{ left: Math.min(width - 120, Math.max(120, hover.x)), top: hoverEvent ? H - 120 : 0 }}>
          {hoverEvent ? (
            <>
              {hoverEvent.thumb && thumbs[hoverEvent.thumb] && <img src={thumbs[hoverEvent.thumb]} alt="" className="mb-1.5 max-h-[96px] w-full rounded-[6px] object-cover" />}
              <div className="flex items-center gap-1.5 font-medium text-fg">
                <EventSwatch kind={hoverEvent.kind} />
                {EVENT_META[hoverEvent.kind].label}
              </div>
              <div className="tnum mt-0.5 text-fg-muted">
                {clock(hoverEvent.x)} · {eventDetail(hoverEvent)}
              </div>
            </>
          ) : (
            <div className="tnum text-fg">
              <span className="text-fg-muted">{clock(hoverBin! * binMs)}</span> · attention {Math.round(sm[hoverBin!]! * 100)}
            </div>
          )}
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 pl-[34px] text-[11.5px] text-fg-muted" aria-label="Legend">
        {(['hold', 'noblink', 'smile', 'away'] as const).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <EventSwatch kind={k} />
            {k === 'smile' ? 'Expression' : EVENT_META[k].label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function eventDetail(e: Pick<ReportEvent, 'kind' | 'durMs' | 'peak'>): string {
  const s = Math.max(1, Math.round(e.durMs / 1000));
  switch (e.kind) {
    case 'hold':
      return `breathing paused ${s} s`;
    case 'noblink':
      return `no blinks for ${s} s`;
    case 'away':
      return `looked away ${s} s`;
    default:
      return `${EVENT_META[e.kind].label.toLowerCase()} probability ${e.peak ?? '–'}%`;
  }
}

export function EventSwatch({ kind, size = 10 }: { kind: ReportEvent['kind']; size?: number }) {
  const meta = EVENT_META[kind];
  if (kind === 'away') return <span className="hatch inline-block shrink-0 rounded-[3px] border border-line-strong" style={{ width: size + 4, height: size }} aria-hidden />;
  return <span className={cx('inline-block shrink-0', meta.bar ? 'rounded-full' : 'rounded-full')} style={{ width: meta.bar ? size + 6 : size, height: meta.bar ? size - 4 : size, background: `var(${meta.color})` }} aria-hidden />;
}
