import { useId, useState, type ReactNode } from 'react';
import type { FocusResult, Report as R } from '@counterfeed/shared';
import { focusBand, FOCUS_FELT, OTHER_APPS } from '../analysis/focus';
import { PART_LABEL } from '../analysis/score';
import { Icon } from './icons';
import { cx } from './kit';
import { clock, duration, formatDay, round, sourceLabel } from './format';
import { Disclosure, Notes, Row, Tile } from './Report';
import { niceTicks, ScoreRing, useWidth } from './viz';

/*
 * A focus session's report. First the answer (one score, one sentence, how it felt next to what was measured, one
 * suggestion), then four numbers, the session as a map (focused stretches, breaks, and the app in front), and where
 * your focus went, app by app. How it's built is one click away.
 */

const pct = (v: number) => Math.round(v * 100);
const LABEL: Record<string, string> = { ...PART_LABEL, eyes: 'Eyes on the work' };

/** "21 min" from 10 minutes up, else "4 min 12 s" / "45 s". */
function short(ms: number): string {
  return ms >= 10 * 60_000 ? `${Math.round(ms / 60_000)} min` : duration(ms);
}

export function FocusReport({ report: r, banner }: { report: R; banner?: ReactNode }) {
  const f = r.focus ?? null;
  const m = r.metrics;
  const b = r.baseline;
  const tooShort = r.watchMs < 20_000;
  const share = f && f.measuredMs > 0 ? f.focusedMs / f.measuredMs : null;
  const felt = r.felt.after;
  const compare = b.quality === 'good';

  return (
    <div className="grid gap-4" data-testid="report" data-mode="focus">
      {banner}
      <header className="rise" style={{ ['--i' as string]: 0 }}>
        <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-fg/[0.06] px-2 py-0.5 font-medium text-fg">
            <Icon.Focus size={13} />
            Focus session
          </span>
          <span>{formatDay(r.startedAt)}</span>
          <span aria-hidden>·</span>
          <span className="tnum" data-testid="watched">
            {f?.plannedMs ? `${duration(r.watchMs)} of ${duration(f.plannedMs)}` : `${duration(r.watchMs)}`}
          </span>
          {f?.dnd === 'on' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-focus-soft px-2 py-0.5 font-medium text-focus-ink" data-testid="dnd-badge">
              <Icon.Moon size={12} />
              Do Not Disturb was on
            </span>
          )}
          {r.signal === 'test' && <span className="rounded-full bg-warn/15 px-2 py-0.5 font-medium text-warn">Test signal</span>}
          {r.partial && <span className="rounded-full bg-fg/[0.06] px-2 py-0.5">Ended early</span>}
        </div>
        <h1 className="truncate font-display text-[26px] leading-tight font-semibold tracking-[-0.03em]" data-testid="report-title">
          {sourceLabel(r)}
        </h1>
      </header>

      {/* Hero: one number, one sentence, how it felt, one suggestion. */}
      <section className="rise meter-focus grid items-center gap-6 rounded-[18px] bg-surface p-6 shadow-panel md:grid-cols-[auto_1fr]" style={{ ['--i' as string]: 1 }}>
        <div className="grid justify-items-center gap-2">
          <ScoreRing value={r.pull.score} label="Focus" testId="score-ring" />
          <span className="text-[13px] font-medium text-fg-muted" data-testid="score-band">
            {r.pull.score === null ? 'Not enough to score' : `${focusBand(r.pull.score)} focus`}
          </span>
        </div>
        <div className="min-w-0">
          <p className="font-display text-[19px] leading-snug font-medium tracking-[-0.015em] text-fg" data-testid="summary">
            {r.summary}
          </p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-fg-dim">
            Focus score: how much of the time your eyes stayed on the work, how long the stretches ran{f?.switches !== null && f ? ', how often you switched apps' : ''}, and your blinking against your own normal.
          </p>
          {felt !== null && share !== null && !tooShort && (
            <div className="mt-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-focus-soft px-2.5 py-1 text-[12px] font-medium text-fg" data-testid="focus-felt">
                <Icon.Check size={12} strokeWidth={2.4} className="text-focus-ink" />
                It felt {FOCUS_FELT[felt - 1]?.toLowerCase()}. The camera measured {pct(share)}% focused.
              </span>
            </div>
          )}
          {r.suggestion && (
            <div className="mt-4 flex items-start gap-3 rounded-[14px] border border-line bg-surface-2 px-4 py-3" data-testid="suggestion">
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-g-focus text-white">
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

      {(tooShort || !f) && <Notes notes={r.notes} />}
      {!tooShort && f && (
        <>
          <section className="rise grid gap-3 sm:grid-cols-2 lg:grid-cols-4" style={{ ['--i' as string]: 2 }}>
            <Tile icon={<Icon.Focus />} label="Focused" value={short(f.focusedMs)} sub={share === null ? 'no clear view' : `${pct(share)}% of the time`} testId="tile-focused" accent="--focus" />
            <Tile icon={<Icon.Timer />} label="Longest stretch" value={short(f.longestMs)} sub="without a break" testId="tile-longest" />
            <Tile icon={<Icon.Eye />} label="Breaks" value={String(f.breaks)} sub={f.leftCount ? `left your desk ${f.leftCount === 1 ? 'once' : `${f.leftCount} times`}` : 'away 10 s or more'} testId="tile-breaks" accent="--ev-away" />
            <Tile icon={<Icon.Apps />} label="App switches" value={f.switches === null ? '–' : String(f.switches)} sub={f.apps === null ? 'not tracked' : `across ${f.apps.filter((a) => a.name !== OTHER_APPS).length} ${f.apps.length === 1 ? 'app' : 'apps'}`} testId="tile-switches" />
          </section>
          <section className="rise grid gap-3 sm:grid-cols-2" style={{ ['--i' as string]: 3 }}>
            <Tile icon={<Icon.Wind />} label="Breathing pauses while you worked" value={m.holds === null ? '–' : String(m.holds)} sub={m.holds === null ? 'not readable: needs a clear view of your chest' : m.longestHoldMs ? `longest ${Math.round(m.longestHoldMs / 1000)} s` : 'none found'} testId="tile-holds" accent="--ev-hold" />
            <Tile icon={<Icon.Eye />} label="Blinking" value={m.blinkPerMin === null ? '–' : round(m.blinkPerMin)} unit="/ min" sub={compare && b.blinkPerMin !== null ? `your normal ${round(b.blinkPerMin)} / min` : 'no comparison'} testId="tile-blinks" accent="--ev-stare" />
          </section>

          <section className="rise rounded-[18px] bg-surface p-5 shadow-panel" style={{ ['--i' as string]: 4 }}>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[14px] font-semibold tracking-[-0.01em]">Your session, start to finish</h2>
              <span className="text-[12px] text-fg-dim">Hover for detail</span>
            </div>
            <FocusMap f={f} spanMs={r.watchMs} />
          </section>

          {f.apps && f.apps.length > 0 && <FocusApps f={f} />}

          <Disclosure title="How the score is built" testId="how-built">
            {r.pull.parts.length ? (
              <div className="grid gap-3 meter-focus">
                {r.pull.parts.map((p) => (
                  <div key={p.key} className="grid items-center gap-x-4 gap-y-1 sm:grid-cols-[150px_1fr_44px]">
                    <div className="text-[12.5px] font-medium">{LABEL[p.key]}</div>
                    <div className="h-2 overflow-hidden rounded-full bg-fg/[0.07]">
                      <div className="h-full rounded-full bg-g-meter" style={{ width: `${Math.max(2, p.value * 100)}%` }} />
                    </div>
                    <div className="tnum text-right text-[12px] text-fg-muted">{Math.round(p.weight * 100)}%</div>
                    <div className="text-[12px] text-fg-dim sm:col-span-3">{p.detail}</div>
                  </div>
                ))}
                <p className="text-[12px] text-fg-dim">The right-hand number is how much each part counts. Parts that couldn’t be measured are left out rather than guessed.</p>
              </div>
            ) : (
              <p className="text-[12.5px] text-fg-muted">Not enough was measured to build a score.</p>
            )}
          </Disclosure>

          <Disclosure title="How this is measured" testId="details">
            <dl className="grid gap-x-8 gap-y-2 text-[12.5px] sm:grid-cols-2">
              <Row k="Your normal (settle)" v={`${duration(b.durationMs)} · ${b.quality === 'good' ? 'clear' : 'not clear, comparisons left out'}`} />
              <Row k="Time the camera could read" v={`${duration(f.measuredMs)} of ${duration(r.watchMs)}`} />
              <Row k="Do Not Disturb" v={f.dnd === 'on' ? 'on for the session' : f.dnd === 'failed' ? 'the shortcut didn’t run' : 'not used'} />
              <Row k="Front app" v={f.apps === null ? 'not tracked' : 'noted once a second, names only'} />
              <Row k="Breathing rate" v={m.holds === null ? 'not readable (chest out of view)' : `${round(m.breathPerMin)} / min${compare && b.breathPerMin !== null ? ` (normal ${round(b.breathPerMin)})` : ''}`} />
              <Row k="Pulse" v={m.pulse === null ? '–' : `${round(m.pulse)} bpm${m.pulseDelta !== null ? ` (${m.pulseDelta >= 0 ? '+' : ''}${round(m.pulseDelta)} vs your normal)` : ''}`} />
              <Row k="Clear view of your face" v={`${Math.round(m.coverage * 100)}% of the time`} />
              <Row k="Signal" v={r.signal === 'test' ? 'Test signal (automated run)' : 'SmartSpectra, on this Mac'} />
            </dl>
            {r.notes.length > 0 && (
              <div className="mt-3">
                <Notes notes={r.notes} bare />
              </div>
            )}
            <p className="mt-3 text-[12px] leading-relaxed text-fg-dim">
              Focused: your face toward the screen, from the SmartSpectra face check and your head pose compared with how you usually sit. Looking away for under 10 s (thinking, checking notes) still counts as focused; 10 s or more is a break, and ends a stretch. No face for 30 s or more is “left your desk”. Time the camera couldn’t read (light, movement) is left out of both. The front app is read from macOS once a second; only its name is kept, never what’s in it.
            </p>
          </Disclosure>
        </>
      )}

      <p className="pb-2 text-center text-[11.5px] text-fg-dim">
        Wellness information, not a medical measurement. The Focus score shows how much of the time your eyes stayed on your work. It is not a brain chemical or a health measure, and it never compares you with anyone else.
      </p>
    </div>
  );
}

/**
 * App shades by rank (most time first): one neutral hue in clearly separate steps, so the lane never competes with
 * focus, and the strongest step stays dark enough for its label to read on it.
 */
const SHADES = [34, 21, 13, 9, 7, 6, 5, 5, 4];
const appShade = (i: number) => `color-mix(in oklab, var(--fg) ${SHADES[Math.min(i, SHADES.length - 1)]}%, transparent)`;

/**
 * The session as a map: focused stretches (plum) and breaks (hatched; denser where you left your desk) on one lane,
 * the app in front on a second. One crosshair tooltip says what was happening at that moment.
 */
function FocusMap({ f, spanMs }: { f: FocusResult; spanMs: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/:/g, '');
  const GUTTER = 52;
  const LANE = 22;
  const APP = 18;
  const hasApps = !!f.appSpans?.length && !!f.apps;
  const H = LANE + (hasApps ? 10 + APP : 0);
  const span = Math.max(1000, spanMs);
  const plotW = Math.max(10, width - GUTTER);
  const sx = (ms: number) => GUTTER + (Math.min(span, Math.max(0, ms)) / span) * plotW;
  const seg = (a: number, b: number) => ({ x: sx(a) + 1, w: Math.max(0, sx(b) - sx(a) - 2) });

  const at = hover === null ? null : (hover / plotW) * span;
  const brk = at === null ? null : f.breakSpans.find((x) => at >= x.startMs && at < x.endMs) ?? null;
  const str = at === null ? null : f.stretches.find((x) => at >= x.startMs && at < x.endMs) ?? null;
  const app = at === null || !f.appSpans || !f.apps ? null : f.appSpans.find(([s, e]) => at >= s && at < e) ?? null;
  const left = f.breakSpans.some((x) => x.left);

  return (
    <div data-testid="focus-map">
      <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
        <svg
          width={width}
          height={H + 22}
          className="block overflow-visible"
          role="img"
          aria-label={`Focus map: ${f.stretches.length} focused ${f.stretches.length === 1 ? 'stretch' : 'stretches'} and ${f.breaks} ${f.breaks === 1 ? 'break' : 'breaks'}`}
          onMouseMove={(e) => {
            const x = e.clientX - e.currentTarget.getBoundingClientRect().left - GUTTER;
            setHover(x >= 0 && x <= plotW ? x : null);
          }}
        >
          <defs>
            <pattern id={`${gid}-h`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="1.6" height="6" fill="var(--ev-away)" opacity="0.6" />
            </pattern>
            <pattern id={`${gid}-l`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="1.8" height="4" fill="var(--ev-away)" opacity="0.85" />
            </pattern>
          </defs>
          <text x={0} y={LANE / 2 + 4} className="fill-fg-dim text-[11px]">
            Focus
          </text>
          <rect x={GUTTER} y={0} width={plotW} height={LANE} rx={5} fill="var(--fg)" opacity={0.05} />
          {f.stretches.map((s) => {
            const g = seg(s.startMs, s.endMs);
            return g.w > 0 ? <rect key={`s${s.startMs}`} x={g.x} y={0} width={g.w} height={LANE} rx={4} fill="var(--focus)" data-testid="map-stretch" /> : null;
          })}
          {f.breakSpans.map((s) => {
            const g = seg(s.startMs, s.endMs);
            return g.w > 0 ? <rect key={`b${s.startMs}`} x={g.x} y={0} width={g.w} height={LANE} rx={4} fill={`url(#${gid}-${s.left ? 'l' : 'h'})`} stroke="var(--line-strong)" data-testid="map-break" /> : null;
          })}
          {hasApps && (
            <g transform={`translate(0 ${LANE + 10})`}>
              <text x={0} y={APP / 2 + 4} className="fill-fg-dim text-[11px]">
                Apps
              </text>
              {f.appSpans!.map(([s, e, i]) => {
                const g = seg(s, e);
                const name = f.apps![i]?.name ?? '';
                return g.w > 0 ? (
                  <g key={`a${s}`}>
                    <rect x={g.x} y={0} width={g.w} height={APP} rx={4} fill={appShade(i)} data-testid="map-app" />
                    {g.w > 58 && (
                      <text x={g.x + 6} y={APP / 2 + 4} className="pointer-events-none fill-fg text-[10.5px]">
                        {name.length > Math.floor(g.w / 6.5) ? `${name.slice(0, Math.max(1, Math.floor(g.w / 6.5) - 1))}…` : name}
                      </text>
                    )}
                  </g>
                ) : null;
              })}
            </g>
          )}
          {niceTicks(span).map((t) => (
            <text key={t} x={sx(t)} y={H + 16} textAnchor={t === 0 ? 'start' : 'middle'} className="tnum fill-fg-dim text-[10.5px]">
              {clock(t)}
            </text>
          ))}
          {hover !== null && <line x1={GUTTER + hover} x2={GUTTER + hover} y1={-3} y2={H + 3} stroke="var(--fg)" strokeOpacity={0.5} strokeWidth={1} />}
        </svg>
        {hover !== null && at !== null && (
          <div className="pointer-events-none absolute top-[-6px] z-10 -translate-y-full rounded-[8px] border border-line-strong bg-overlay px-2.5 py-1.5 text-[11.5px] whitespace-nowrap shadow-pop" style={{ left: Math.min(Math.max(GUTTER + hover - 90, 0), Math.max(0, width - 180)) }} data-testid="map-tip">
            <div className="tnum font-medium text-fg">{clock(at)}</div>
            <div className="text-fg-muted">
              {brk ? `${brk.left ? 'Left your desk' : 'Break'}: ${duration(brk.endMs - brk.startMs)}` : str ? `Focused stretch: ${duration(str.endMs - str.startMs)}` : 'No reading'}
              {app && f.apps ? ` · ${f.apps[app[2]]?.name}` : ''}
            </div>
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-fg-muted" data-testid="map-legend">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded-[3px] bg-focus" />
          Focused
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="hatch inline-block h-2.5 w-4 rounded-[3px] border border-line-strong" />
          Break (away 10 s or more)
        </span>
        {left && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-[3px] border border-line-strong" style={{ backgroundImage: 'repeating-linear-gradient(135deg, color-mix(in srgb, var(--ev-away) 85%, transparent) 0 1.8px, transparent 1.8px 4px)' }} />
            Left your desk
          </span>
        )}
        {hasApps &&
          f.apps!.slice(0, 4).map((a, i) => (
            <span key={a.name} className="inline-flex items-center gap-1.5" data-testid="map-app-key">
              <span className="inline-block h-2.5 w-4 rounded-[3px]" style={{ background: appShade(i) }} />
              {a.name}
            </span>
          ))}
        {hasApps && f.apps!.length > 4 && <span className="text-fg-dim">+{f.apps!.length - 4} more</span>}
      </div>
    </div>
  );
}

/** Where your focus went: time in each app, and how much of it your eyes were on the work. */
function FocusApps({ f }: { f: FocusResult }) {
  const apps = f.apps ?? [];
  const known = apps.reduce((t, a) => t + a.ms, 0);
  const every = f.switches ? known / f.switches : null;
  return (
    <section className="rise rounded-[18px] bg-surface p-5 shadow-panel" style={{ ['--i' as string]: 5 }} data-testid="focus-apps">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[14px] font-semibold tracking-[-0.01em]">Where your focus went</h2>
        <span className="text-[12px] text-fg-dim" data-testid="switches-line">
          {f.switches === null ? '' : f.switches === 0 ? 'You stayed in one app' : `${f.switches} app ${f.switches === 1 ? 'switch' : 'switches'}${every ? `, about every ${duration(every)}` : ''}`}
        </span>
      </div>
      <div className="grid gap-1" role="table" aria-label="Time and focus in each app">
        <div role="row" className="grid grid-cols-[minmax(0,1fr)_72px_minmax(120px,240px)_44px] items-center gap-3 px-2 pb-1 text-[11px] font-semibold tracking-[0.06em] text-fg-dim uppercase">
          <span role="columnheader">App</span>
          <span role="columnheader" className="text-right">Time</span>
          <span role="columnheader">Eyes on the work</span>
          <span role="columnheader" className="sr-only">Share</span>
        </div>
        {apps.map((a, i) => {
          const fs = a.ms > 0 ? a.focusedMs / a.ms : 0;
          return (
            <div key={a.name} role="row" className="grid grid-cols-[minmax(0,1fr)_72px_minmax(120px,240px)_44px] items-center gap-3 rounded-[10px] px-2 py-2 hover:bg-fg/[0.04]" data-testid="focus-app" data-name={a.name}>
              <span role="cell" className="flex min-w-0 items-center gap-2.5">
                <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: appShade(i) }} aria-hidden />
                <span className={cx('truncate text-[13px]', a.name === OTHER_APPS ? 'text-fg-muted' : 'font-medium text-fg')}>{a.name}</span>
              </span>
              <span role="cell" className="tnum text-right text-[12.5px] text-fg-muted">
                {short(a.ms)}
              </span>
              <span role="cell" className="h-2 overflow-hidden rounded-full bg-fg/[0.07]">
                <span className="block h-full rounded-full bg-focus" style={{ width: `${Math.max(2, fs * 100)}%` }} />
              </span>
              <span role="cell" className="tnum text-right text-[12.5px] font-medium text-fg">
                {pct(fs)}%
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
