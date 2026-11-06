import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';
import { Session, type Buffers } from '../session/controller';

/** Where a wave reads its samples from: the live session by default, or a Diagnostics probe. */
export interface WaveFeed {
  you: Buffers;
  partner: Buffers | null;
  window(): { now: number; offsetUs: number };
}
import { Icon } from './icons';
import { cx } from './kit';

/* ------------------------------------------------------------------ brand */

/** Two overlapping lights that breathe: you and them, one shared middle. */
export function BrandMark({ size = 28, still }: { size?: number; still?: boolean }) {
  const r = size * 0.34;
  return (
    <span className={cx('relative isolate inline-block shrink-0', !still && 'breathe')} style={{ width: size, height: size }} aria-hidden>
      <span className="brand-dot absolute top-1/2 left-1/2 rounded-full" style={{ width: r * 2, height: r * 2, marginLeft: -r, marginTop: -r, background: 'radial-gradient(circle at 32% 30% in oklch, var(--you-hi), var(--you) 55%, var(--you-lo))', ['--dx' as string]: `${-size * 0.17}px`, transform: `translateX(${-size * 0.17}px)` }} />
      <span className="brand-dot absolute top-1/2 left-1/2 rounded-full" style={{ width: r * 2, height: r * 2, marginLeft: -r, marginTop: -r, background: 'radial-gradient(circle at 68% 30% in oklch, var(--them-hi), var(--them) 55%, var(--them-lo))', ['--dx' as string]: `${size * 0.17}px`, transform: `translateX(${size * 0.17}px)` }} />
    </span>
  );
}

/* ------------------------------------------------------------------ heart */

/** A heart that beats at the measured rate. Unsteady readings dim it and stop the beat (no fake rhythm). */
export function Heart({ bpm, stable, who, size = 'md', label, testId, onMedia }: { bpm: number | null; stable: boolean; who: 'you' | 'them'; size?: 'sm' | 'md' | 'lg'; label?: string; testId?: string; onMedia?: boolean }) {
  const live = bpm !== null && bpm >= 40 && bpm <= 110 && stable;
  const px = size === 'lg' ? 26 : size === 'md' ? 18 : 14;
  return (
    <span data-testid={testId} className="inline-flex items-center gap-1.5" aria-label={label ? `${label}: ${live ? `${Math.round(bpm!)} beats per minute` : 'pulse settling'}` : undefined}>
      <span className={cx('inline-grid place-items-center transition-opacity duration-500', live ? 'beat opacity-100' : 'opacity-35')} style={{ ['--beat' as string]: live ? `${60 / bpm!}s` : undefined, color: `var(--${who})` } as CSSProperties}>
        <Icon.Heart size={px} />
      </span>
      <span className={cx('tnum font-medium', size === 'lg' ? 'text-[22px] tracking-[-0.02em]' : size === 'md' ? 'text-[14px]' : 'text-[12px]', onMedia ? (live ? 'text-white' : 'text-white/60') : live ? 'text-fg' : 'text-fg-dim')}>
        {bpm !== null && bpm > 0 ? Math.round(bpm) : '–'}
        <span className={cx('ml-0.5 font-normal', onMedia ? 'text-white/60' : 'text-fg-dim', size === 'lg' ? 'text-[12px]' : 'text-[10.5px]')}>bpm</span>
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ live breathing wave (canvas) */

interface Lane {
  who: 'you' | 'them';
  scale: number;
}

function readColor(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#999';
}

/**
 * Live breathing wave(s). Reads the session's sample buffers directly every animation frame, so the 30 Hz
 * stream never touches React. Display-only processing: a running-mean detrend and a robust, slowly adapting
 * scale so the wave sits calmly in its lane. Pauses when hidden or off screen.
 */
export function Waves({ show, seconds = 20, className, testId, feed }: { show: ('you' | 'them')[]; seconds?: number; className?: string; testId?: string; feed?: () => WaveFeed | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const lanes = useRef<Lane[]>([]);
  const key = show.join(',');
  useEffect(() => {
    lanes.current = show.map((who) => ({ who, scale: 0 }));
  }, [key, show]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext('2d', { alpha: true })!;
    let raf = 0;
    let visible = true;
    let w = 0;
    let h = 0;
    let colors = { you: readColor('--you'), them: readColor('--them'), line: readColor('--line'), dark: !document.documentElement.dataset.theme?.includes('light') };
    const recolor = () => (colors = { you: readColor('--you'), them: readColor('--them'), line: readColor('--line'), dark: document.documentElement.dataset.theme !== 'light' });
    const mo = new MutationObserver(recolor);
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
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      if (visible) loop();
    });
    io.observe(el);

    const xs: number[] = [];
    const ys: number[] = [];
    let last = 0;

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const s: WaveFeed | null = feed ? feed() : Session.current;
      // Baseline.
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (!s) return;
      const win = s.window();
      const end = win.now - 350_000; // a little behind real time so batched arrivals draw smoothly
      const from = end - seconds * 1e6;
      ctx.globalCompositeOperation = colors.dark ? 'lighter' : 'source-over';
      for (const lane of lanes.current) {
        const buf = lane.who === 'you' ? s.you : s.partner;
        if (!buf) continue;
        const off = lane.who === 'you' ? 0 : win.offsetUs;
        const series = buf.trace;
        const k0 = Math.max(0, series.lowerBound(from - 8e6 + off));
        const n = series.length;
        if (n - k0 < 4) continue;
        // Running mean over ~6 s for display detrend (prefix sums over the visible range).
        xs.length = 0;
        ys.length = 0;
        let sum = 0;
        const q: number[] = [];
        const qt: number[] = [];
        let qi = 0;
        const vals: number[] = [];
        for (let k = k0; k < n; k++) {
          const t = series.tAt(k) - off;
          const v = series.vAt(k);
          q.push(v);
          qt.push(t);
          sum += v;
          while (qt[qi]! < t - 6e6) sum -= q[qi++]!;
          if (t < from || t > end) continue;
          const d = v - sum / (q.length - qi);
          xs.push(((t - from) / (end - from)) * w);
          ys.push(d);
          vals.push(d);
        }
        if (xs.length < 2) continue;
        // Display-only smoothing (~120 ms EMA at ~30 Hz): removes pixel jitter, keeps every breath's shape.
        for (let i = 1; i < ys.length; i++) ys[i] = ys[i - 1]! + 0.25 * (ys[i]! - ys[i - 1]!);
        vals.sort((a, b) => a - b);
        const lo = vals[Math.floor(vals.length * 0.05)]!;
        const hi = vals[Math.floor(vals.length * 0.95)]!;
        const target = Math.max(1e-9, (hi - lo) / 2);
        lane.scale = lane.scale ? lane.scale + (target - lane.scale) * 0.03 : target;
        const amp = (h / 2) * (show.length > 1 ? 0.62 : 0.7);
        const color = lane.who === 'you' ? colors.you : colors.them;
        const yAt = (i: number) => h / 2 - Math.max(-1.4, Math.min(1.4, ys[i]! / lane.scale)) * amp;

        // Area wash that fades toward the midline (single wave only: two overlapping washes turn muddy).
        if (show.length === 1) {
          const wash = ctx.createLinearGradient(0, 0, 0, h);
          wash.addColorStop(0, color + '40');
          wash.addColorStop(0.5, color + '00');
          wash.addColorStop(1, color + '40');
          ctx.beginPath();
          ctx.moveTo(xs[0]!, h / 2);
          for (let i = 0; i < xs.length; i++) ctx.lineTo(xs[i]!, yAt(i));
          ctx.lineTo(xs[xs.length - 1]!, h / 2);
          ctx.closePath();
          ctx.fillStyle = wash;
          ctx.fill();
        }

        // Smoothed line: quadratic curves through midpoints.
        const path = new Path2D();
        path.moveTo(xs[0]!, yAt(0));
        for (let i = 1; i < xs.length - 1; i++) {
          const mx = (xs[i]! + xs[i + 1]!) / 2;
          const my = (yAt(i) + yAt(i + 1)) / 2;
          path.quadraticCurveTo(xs[i]!, yAt(i), mx, my);
        }
        path.lineTo(xs[xs.length - 1]!, yAt(xs.length - 1));
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.25;
        ctx.stroke(path);

        // Leading point.
        const lx = xs[xs.length - 1]!;
        const ly = yAt(xs.length - 1);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(lx, ly, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      // Fade the oldest seconds into the background.
      ctx.globalCompositeOperation = 'destination-out';
      const fade = ctx.createLinearGradient(0, 0, w * 0.18, 0);
      fade.addColorStop(0, 'rgba(0,0,0,1)');
      fade.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, w * 0.18, h);
      ctx.globalCompositeOperation = 'source-over';
    };

    const loop = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame((ts) => {
        if (!visible || document.hidden) return;
        // Cap at ~45 fps: smooth to the eye, gentle on battery.
        if (ts - last >= 21) {
          last = ts;
          draw();
        }
        loop();
      });
    };
    const onVis = () => !document.hidden && loop();
    document.addEventListener('visibilitychange', onVis);
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [key, seconds, show.length, feed]);

  return <canvas ref={canvas} data-testid={testId} className={cx('block h-full w-full', className)} aria-label={show.length > 1 ? 'Both breathing waves' : 'Your breathing wave'} role="img" />;
}

/* ------------------------------------------------------------------ sync meter */

/** How in step the two of you are right now (PLV over the last 30 s), as an arc. */
export function SyncMeter({ value, size = 168, testId }: { value: number | null; size?: number; testId?: string }) {
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  const arc = c * (240 / 360);
  const v = value === null ? 0 : Math.max(0, Math.min(1, value));
  const id = useId();
  return (
    <div data-testid={testId} className="relative grid place-items-center" style={{ width: size, height: size * 0.86 }} role="meter" aria-label="In step" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === null ? undefined : Math.round(v * 100)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute top-0" style={{ transform: 'rotate(150deg)' }}>
        <defs>
          {/* The svg is turned 150°; turn the gradient back so it runs left to right along the arc on screen. */}
          <DuoGradient id={id} rotate={-150} />
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-strong)" strokeWidth={8} strokeLinecap="round" strokeDasharray={`${arc} ${c}`} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${CSS.escape(id)})`}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={`${arc * v} ${c}`}
          style={{ transition: 'stroke-dasharray 900ms var(--ease)' }}
        />
      </svg>
      <div className="relative mt-3 text-center">
        <div className="tnum font-display text-[40px] leading-none font-semibold tracking-[-0.04em] text-fg">{value === null ? '–' : Math.round(v * 100)}</div>
        <div className="mt-1.5 text-[11px] font-medium tracking-[0.08em] text-fg-dim uppercase">{value === null ? 'Listening' : 'In step'}</div>
      </div>
    </div>
  );
}

/**
 * The shared "dusk" gradient as SVG stops. SVG interpolates in sRGB, so four close stops (the same ones the
 * CSS gradient uses in OKLCH) keep every segment short enough to stay clean.
 */
export function DuoGradient({ id, vertical, rotate }: { id: string; vertical?: boolean; rotate?: number }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2={vertical ? '0' : '1'} y2={vertical ? '1' : '0'} gradientTransform={rotate ? `rotate(${rotate} 0.5 0.5)` : undefined}>
      <stop offset="0" stopColor="var(--duo-1)" />
      <stop offset="0.35" stopColor="var(--duo-2)" />
      <stop offset="0.65" stopColor="var(--duo-3)" />
      <stop offset="1" stopColor="var(--duo-4)" />
    </linearGradient>
  );
}

/* ------------------------------------------------------------------ countdown ring */

export function CountdownRing({ remainingMs, totalMs, size = 64, who = 'you', children }: { remainingMs: number; totalMs: number; size?: number; who?: 'you' | 'them' | 'duo'; children?: ReactNode }) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const frac = totalMs ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
  const s = Math.ceil(remainingMs / 1000);
  const id = useId();
  const stroke = who === 'duo' ? `url(#${CSS.escape(id)})` : `var(--${who})`;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }} role="timer" aria-label={`${Math.floor(s / 60)} minutes ${s % 60} seconds left`}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        {who === 'duo' && (
          <defs>
            <DuoGradient id={id} vertical />
          </defs>
        )}
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={2.5} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={stroke} strokeWidth={2.5} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} style={{ transition: 'stroke-dashoffset 300ms linear' }} />
      </svg>
      {children ?? (
        <span className="tnum text-[13px] font-medium text-fg">
          {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ small charts */

export function Sparkline({ values, width = 120, height = 28, className }: { values: number[]; width?: number; height?: number; className?: string }) {
  const id = useId();
  if (values.length < 2) return <div style={{ width, height }} className={className} />;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (width - 2) + 1).toFixed(1)},${(height - 2 - Math.max(0, Math.min(1, v)) * (height - 4)).toFixed(1)}`);
  return (
    <svg width={width} height={height} className={className} aria-hidden>
      <defs>
        <DuoGradient id={id} />
      </defs>
      <polyline points={pts.join(' ')} fill="none" stroke={`url(#${CSS.escape(id)})`} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Apart vs Together, each against its own chance level. */
export function CompareBars({ rows }: { rows: { label: string; value: number | null; chance: number | null; hint?: string; testId?: string }[] }) {
  return (
    <div className="grid gap-4">
      {rows.map((r) => (
        <div key={r.label} data-testid={r.testId}>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[12.5px] font-medium text-fg">{r.label}</span>
            <span className="tnum text-[12.5px] text-fg-muted">{r.value === null ? 'not enough signal' : `${Math.round(r.value * 100)} in step`}</span>
          </div>
          <div className="relative h-2.5 overflow-hidden rounded-full bg-fg/[0.07]">
            {r.value !== null && <div className="absolute inset-y-0 left-0 rounded-full bg-g-duo transition-[width] duration-700 ease-soft" style={{ width: `${Math.max(2, r.value * 100)}%` }} />}
            {r.chance !== null && <div className="absolute inset-y-[-2px] w-[2px] rounded-full bg-bg ring-1 ring-fg-muted" style={{ left: `calc(${r.chance * 100}% - 1px)` }} title="Chance level" />}
          </div>
          {r.hint && <div className="mt-1 text-[11.5px] text-fg-dim">{r.hint}</div>}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ video */

export function VideoTile({ stream, mirrored, muted = true, className, children, placeholder, testId }: { stream: MediaStream | null; mirrored?: boolean; muted?: boolean; className?: string; children?: ReactNode; placeholder?: ReactNode; testId?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const hasVideo = !!stream && stream.getVideoTracks().some((t) => t.readyState === 'live');
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    // Electron doesn't always honour autoplay when srcObject changes after load.
    if (stream) void v.play().catch(() => {});
  }, [stream]);
  return (
    // Position comes from the caller when given (absolute/fixed); otherwise relative. Never both: conflicting
    // utilities resolve by stylesheet order, not class order.
    <div data-testid={testId} className={cx(/\b(absolute|fixed)\b/.test(className ?? '') ? '' : 'relative', 'isolate overflow-hidden bg-surface-2 bg-[radial-gradient(120%_100%_at_50%_0%,var(--surface-3),transparent_70%)]', className)}>
      <video ref={ref} autoPlay playsInline muted={muted} disablePictureInPicture className={cx('absolute inset-0 h-full w-full object-cover transition-opacity duration-500', mirrored && '-scale-x-100', hasVideo ? 'opacity-100' : 'opacity-0')} />
      {!hasVideo && placeholder && <div className="absolute inset-0 grid place-items-center">{placeholder}</div>}
      {children}
    </div>
  );
}
