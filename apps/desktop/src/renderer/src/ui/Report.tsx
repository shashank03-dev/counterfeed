import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Report as R, Thumbs } from '@counterfeed/shared';
import { axisMs, heldMoments, lulls, opening } from '../analysis/curve';
import { band, PART_LABEL } from '../analysis/score';
import { MODE_WORD } from '../analysis/words';
import { FocusReport } from './FocusReport';
import { HooksReport } from './HooksReport';
import { Icon } from './icons';
import { cx } from './kit';
import { clock, duration, EVENT_META, feltWord, formatDay, round, sourceLabel } from './format';
import { AttentionTimeline, eventDetail, EventSwatch, ScoreRing, type TimelineEvent } from './viz';

/**
 * A report: the abstracted layer first (one score, one sentence, one suggestion, four numbers, the timeline),
 * with how it's built and the raw-ish numbers one click away under "How this is measured".
 */
export function Report(props: { report: R; thumbs: Thumbs; videoUrl?: string | null; clipUrls?: string[] | null; banner?: ReactNode }) {
  if (props.report.mode === 'hooks') return <HooksReport report={props.report} thumbs={props.thumbs} clipUrls={props.clipUrls ?? null} banner={props.banner} />;
  if (props.report.mode === 'focus') return <FocusReport report={props.report} banner={props.banner} />;
  return <SessionReport {...props} />;
}

function SessionReport({ report: r, thumbs, videoUrl, banner }: { report: R; thumbs: Thumbs; videoUrl?: string | null; banner?: ReactNode }) {
  const word = MODE_WORD[r.mode];
  const spanMs = r.curveAxis === 'content' && r.content.durationMs ? r.content.durationMs : Math.max(r.watchMs, r.curve.length * r.curveBinMs);
  const events: TimelineEvent[] = useMemo(() => r.events.map((e) => ({ ...e, x: axisMs(r, e) })), [r]);
  const [selected, setSelected] = useState<string | null>(null);
  const sel = events.find((e) => e.id === selected) ?? null;
  const player = useRef<HTMLVideoElement>(null);
  const canPlay = !!videoUrl && r.curveAxis === 'content';
  const playAt = (ms: number) => {
    const v = player.current;
    if (!v) return;
    v.currentTime = Math.max(0, ms / 1000 - 1);
    void v.play().catch(() => {});
  };
  const select = (id: string) => {
    setSelected(id);
    const e = events.find((x) => x.id === id);
    if (e && canPlay) playAt(e.x);
  };

  const m = r.metrics;
  const b = r.baseline;
  // Under 20 s nothing is read: show the explanation only, never zeros that look like results.
  const tooShort = r.watchMs < 20_000;
  const compare = b.quality === 'good';
  const highlights = useMemo(() => {
    const prio: Record<string, number> = { hold: 0, noblink: 1, smile: 2, surprise: 2, frown: 2, away: 3 };
    return [...events].sort((a, c) => (c.thumb ? 1 : 0) - (a.thumb ? 1 : 0) || prio[a.kind]! - prio[c.kind]! || c.durMs - a.durMs).slice(0, 6).sort((a, c) => a.x - c.x);
  }, [events]);

  return (
    <div className="grid gap-4" data-testid="report">
      {banner}
      <header className="rise flex flex-wrap items-end justify-between gap-3" style={{ ['--i' as string]: 0 }}>
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-fg/[0.06] px-2 py-0.5 font-medium text-fg">
              {r.mode === 'feed' ? <Icon.Phone size={13} /> : <Icon.Review size={13} />}
              {r.mode === 'feed' ? 'Feed check' : 'Review'}
            </span>
            <span>{formatDay(r.startedAt)}</span>
            <span aria-hidden>·</span>
            <span className="tnum" data-testid="watched">{duration(r.watchMs)} watched</span>
            {r.signal === 'test' && <span className="rounded-full bg-warn/15 px-2 py-0.5 font-medium text-warn">Test signal</span>}
            {r.partial && <span className="rounded-full bg-fg/[0.06] px-2 py-0.5">Ended early</span>}
          </div>
          <h1 className="truncate font-display text-[26px] leading-tight font-semibold tracking-[-0.03em]" data-testid="report-title">
            {sourceLabel(r)}
          </h1>
          {r.mode === 'review' && r.title && r.content.name !== r.title && <div className="mt-0.5 truncate text-[12.5px] text-fg-dim">{r.content.name}</div>}
        </div>
      </header>

      {/* Hero: one number, one sentence, one suggestion. */}
      <section className="rise grid items-center gap-6 rounded-[18px] bg-surface p-6 shadow-panel md:grid-cols-[auto_1fr]" style={{ ['--i' as string]: 1 }}>
        <div className="grid justify-items-center gap-2">
          <ScoreRing value={r.pull.score} label={word.score} testId="score-ring" />
          <span className="text-[13px] font-medium text-fg-muted" data-testid="score-band">
            {band(r.pull.score)} {r.pull.score !== null && (r.mode === 'feed' ? 'pull' : 'hold')}
          </span>
        </div>
        <div className="min-w-0">
          <p className="font-display text-[19px] leading-snug font-medium tracking-[-0.015em] text-fg" data-testid="summary">
            {r.summary}
          </p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-fg-dim">
            {word.score} score: how strongly {r.mode === 'feed' ? 'the feed' : 'the project'} held your attention, from your blinking, {m.holds === null ? '' : 'breathing '}and gaze against your own normal.
          </p>
          {r.suggestion && (
            <div className="mt-4 flex items-start gap-3 rounded-[14px] border border-line bg-surface-2 px-4 py-3" data-testid="suggestion">
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-g-feed text-white">
                <Icon.Sparkle size={15} />
              </span>
              <div>
                <div className="text-[11px] font-semibold tracking-[0.07em] text-fg-dim uppercase">{r.mode === 'feed' ? 'One thing to try' : 'Reviewer note'}</div>
                <div className="mt-0.5 text-[13.5px] leading-relaxed text-fg">{r.suggestion.text}</div>
              </div>
            </div>
          )}
        </div>
      </section>

      {tooShort && <Notes notes={r.notes} />}
      {!tooShort && <>
      {/* Four numbers. */}
      <section className="rise grid gap-3 sm:grid-cols-2 lg:grid-cols-4" style={{ ['--i' as string]: 2 }}>
        <Tile icon={<Icon.Wind />} label="Breathing pauses" value={m.holds === null ? '–' : String(m.holds)} sub={m.holds === null ? 'not readable: chest out of view' : m.longestHoldMs ? `longest ${Math.round(m.longestHoldMs / 1000)} s` : 'none found'} testId="tile-holds" accent="--ev-hold" />
        <Tile icon={<Icon.Eye />} label="Blinking" value={m.blinkPerMin === null ? '–' : `${round(m.blinkPerMin)}`} unit="/ min" sub={compare && b.blinkPerMin !== null ? `your normal ${round(b.blinkPerMin)} / min` : 'no comparison'} testId="tile-blinks" accent="--ev-stare" />
        <Tile icon={<Icon.Timer />} label="Unbroken stare" value={m.longestNoBlinkMs === null ? '–' : `${Math.round(m.longestNoBlinkMs / 1000)}`} unit="s" sub="longest without blinking" testId="tile-stare" accent="--ev-stare" />
        <Tile icon={<Icon.Monitor />} label="Eyes on screen" value={`${Math.round((1 - (r.watchMs ? m.awayMs / r.watchMs : 0)) * 100)}`} unit="%" sub={m.awayCount ? `looked away ${m.awayCount} ${m.awayCount === 1 ? 'time' : 'times'}` : 'never looked away'} testId="tile-eyes" accent="--ev-away" />
      </section>

      {r.mode === 'feed' && (r.guessMs !== null || r.felt.before !== null || r.felt.after !== null) && (
        <section className="rise grid gap-3 sm:grid-cols-2" style={{ ['--i' as string]: 3 }}>
          {r.guessMs !== null && <Tile icon={<Icon.Timer />} label="Time sense" value={duration(r.watchMs)} sub={`you guessed ${duration(r.guessMs)}`} testId="tile-time" />}
          {(r.felt.before !== null || r.felt.after !== null) && <Tile icon={<Icon.Smile />} label="How you felt" value={`${feltWord(r.felt.before)} → ${feltWord(r.felt.after)}`} sub="your own words, before and after" testId="tile-felt" />}
        </section>
      )}

      {/* Timeline. */}
      <section className="rise rounded-[18px] bg-surface p-5 shadow-panel" style={{ ['--i' as string]: 3 }}>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[14px] font-semibold tracking-[-0.01em]">Attention over time</h2>
          <span className="text-[12px] text-fg-dim">{r.curveAxis === 'content' ? 'Along the video' : 'Along your session'} · hover for detail, click a moment</span>
        </div>
        <div className={cx('grid gap-5', canPlay && 'lg:grid-cols-[1fr_300px]')}>
          <div className="min-w-0">
            <AttentionTimeline curve={r.curve} binMs={r.curveBinMs} spanMs={spanMs} events={events} thumbs={thumbs} selected={selected} onSelect={select} testId="timeline" />
          </div>
          {canPlay && (
            <div className="min-w-0">
              <video ref={player} src={videoUrl!} controls playsInline className="aspect-video w-full rounded-[12px] bg-black" data-testid="report-player" />
              <div className="mt-1.5 text-[11.5px] text-fg-dim">Click any moment to play from just before it.</div>
            </div>
          )}
        </div>
        {sel && (
          <div className="pop mt-4 flex items-center gap-4 rounded-[14px] border border-line bg-surface-2 p-3" data-testid="moment-detail">
            {sel.thumb && thumbs[sel.thumb] ? <img src={thumbs[sel.thumb]} alt="What was on screen" className="h-[72px] w-[116px] shrink-0 rounded-[8px] object-cover" /> : <div className="grid h-[72px] w-[116px] shrink-0 place-items-center rounded-[8px] bg-surface-3 text-fg-dim"><Icon.Window /></div>}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[13px] font-medium">
                <EventSwatch kind={sel.kind} />
                {EVENT_META[sel.kind].label}
              </div>
              <div className="tnum mt-0.5 text-[12.5px] text-fg-muted">
                at {clock(sel.x)} · {eventDetail(sel)}
              </div>
            </div>
          </div>
        )}
      </section>

      {r.mode === 'review' && <ReviewLists r={r} events={events} onPick={(ms) => (canPlay ? playAt(ms) : undefined)} canPlay={canPlay} />}

      {highlights.length > 0 && (
        <section className="rise" style={{ ['--i' as string]: 4 }}>
          <h2 className="mb-2.5 text-[14px] font-semibold tracking-[-0.01em]">Moments</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="moments">
            {highlights.map((e) => (
              <button key={e.id} type="button" onClick={() => select(e.id)} className={cx('group overflow-hidden rounded-[14px] bg-surface text-left shadow-panel transition-transform duration-200 hover:-translate-y-0.5', selected === e.id && 'ring-2 ring-fg/40')}>
                {e.thumb && thumbs[e.thumb] ? <img src={thumbs[e.thumb]} alt="" className="aspect-[16/9] w-full object-cover" /> : <div className="grid aspect-[16/9] w-full place-items-center bg-surface-2 text-fg-dim"><Icon.Window size={20} /></div>}
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <EventSwatch kind={e.kind} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{eventDetail(e)}</span>
                  <span className="tnum text-[12px] text-fg-dim">{clock(e.x)}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {r.mode === 'review' && r.ratings && Object.values(r.ratings).some((v) => v !== null) && (
        <section className="rise rounded-[18px] bg-surface p-5 shadow-panel" style={{ ['--i' as string]: 5 }} data-testid="ratings">
          <h2 className="mb-3 text-[14px] font-semibold tracking-[-0.01em]">Your scores, next to what your body did</h2>
          <div className="grid gap-2 sm:grid-cols-3">
            {(['technology', 'usability', 'originality'] as const).map((k) => (
              <div key={k} className="rounded-[12px] bg-surface-2 px-3.5 py-3">
                <div className="text-[12px] text-fg-muted capitalize">{k === 'technology' ? 'Use of technology' : k}</div>
                <Dots value={r.ratings![k]} />
              </div>
            ))}
          </div>
          {r.reviewNote && <p className="selectable mt-3 text-[13px] leading-relaxed whitespace-pre-wrap text-fg-muted">{r.reviewNote}</p>}
        </section>
      )}

      <Disclosure title="How the score is built" testId="how-built">
        {r.pull.parts.length ? (
          <div className="grid gap-3">
            {r.pull.parts.map((p) => (
              <div key={p.key} className="grid items-center gap-x-4 gap-y-1 sm:grid-cols-[150px_1fr_44px]">
                <div className="text-[12.5px] font-medium">{PART_LABEL[p.key]}</div>
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
          <Row k="Breathing rate" v={m.holds === null ? 'not readable (chest out of view)' : `${round(m.breathPerMin)} / min${compare && b.breathPerMin !== null ? ` (normal ${round(b.breathPerMin)})` : ''}`} />
          <Row k="Pulse" v={m.pulse === null ? '–' : `${round(m.pulse)} bpm${m.pulseDelta !== null ? ` (${m.pulseDelta >= 0 ? '+' : ''}${round(m.pulseDelta)} vs your normal)` : ''}`} />
          <Row k="Heart rate variability" v={m.hrvMs === null ? 'needs a minute of steady signal' : `${round(m.hrvMs)} ms (RMSSD)`} />
          <Row k="Smile probability over 50%" v={`${Math.round(m.smileMs / 1000)} s`} />
          <Row k="Clear view of your face" v={`${Math.round(m.coverage * 100)}% of the time`} />
          {m.screenChanges !== null && <Row k="Big on-screen changes" v={`about ${m.screenChanges}`} />}
          <Row k="Signal" v={r.signal === 'test' ? 'Test signal (automated run)' : 'SmartSpectra, on this Mac'} />
        </dl>
        {r.notes.length > 0 && <div className="mt-3"><Notes notes={r.notes} bare /></div>}
        <p className="mt-3 text-[12px] leading-relaxed text-fg-dim">
          Breathing pauses: your breathing wave stays under a third of its usual size for 6 s or more. They’re only looked for when the camera could see your upper chest for most of the session; otherwise they’re left out, not counted as zero. Unbroken stare: a gap between blinks over 2.5× your usual gap. Looking away: the SmartSpectra face check, plus your head turning or tilting down compared with how you usually sit. Expressions are facial-expression probabilities from SmartSpectra, never a reading of feelings. Moments only count while the camera had a clear view of your face and you weren’t talking.
        </p>
      </Disclosure>

      </>}

      <p className="pb-2 text-center text-[11.5px] text-fg-dim">
        Wellness information, not a medical measurement. The {word.score} score shows how strongly your attention was held. It is not a brain chemical or a health measure, and it never compares you with anyone else.
      </p>
    </div>
  );
}

export function Notes({ notes, bare }: { notes: string[]; bare?: boolean }) {
  if (!notes.length) return null;
  return (
    <ul className={cx('grid gap-1 text-[12.5px] text-fg-muted', !bare && 'rounded-[16px] bg-surface px-5 py-4 shadow-panel')} data-testid="notes">
      {notes.map((n) => (
        <li key={n} className="flex gap-2">
          <Icon.Info size={14} className="mt-0.5 shrink-0 text-fg-dim" />
          {n}
        </li>
      ))}
    </ul>
  );
}

function ReviewLists({ r, events, onPick, canPlay }: { r: R; events: TimelineEvent[]; onPick: (ms: number) => void; canPlay: boolean }) {
  const held = heldMoments(r.curve, r.curveBinMs);
  const lost = [...events.filter((e) => e.kind === 'away').map((e) => ({ at: e.x, end: e.x + e.durMs, why: `looked away ${Math.max(1, Math.round(e.durMs / 1000))} s` })), ...lulls(r.curve, r.curveBinMs).map((l) => ({ at: l.startMs, end: l.endMs, why: 'attention light' }))].sort((a, b) => a.at - b.at).slice(0, 5);
  const open = opening(r.curve, r.curveBinMs);
  const Item = ({ at, children, testId }: { at: number; children: ReactNode; testId: string }) => (
    <li>
      <button type="button" disabled={!canPlay} onClick={() => onPick(at)} data-testid={testId} className="flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left enabled:hover:bg-fg/[0.05]">
        <span className="tnum w-11 shrink-0 text-[12.5px] font-medium text-fg">{clock(at)}</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-muted">{children}</span>
        {canPlay && <Icon.Play size={13} className="shrink-0 text-fg-dim" />}
      </button>
    </li>
  );
  return (
    <section className="rise grid gap-3 md:grid-cols-3" style={{ ['--i' as string]: 4 }}>
      <div className="rounded-[18px] bg-surface p-4 shadow-panel" data-testid="held">
        <h3 className="mb-1.5 px-2.5 text-[13px] font-semibold">Where it held you</h3>
        {held.length ? <ul>{held.map((h) => <Item key={h.atMs} at={h.atMs} testId="held-item">attention {Math.round(h.value * 100)}</Item>)}</ul> : <p className="px-2.5 text-[12.5px] text-fg-dim">No strong peaks.</p>}
      </div>
      <div className="rounded-[18px] bg-surface p-4 shadow-panel" data-testid="lost">
        <h3 className="mb-1.5 px-2.5 text-[13px] font-semibold">Where it lost you</h3>
        {lost.length ? <ul>{lost.map((l) => <Item key={`${l.at}-${l.why}`} at={l.at} testId="lost-item">{l.why}</Item>)}</ul> : <p className="px-2.5 text-[12.5px] text-fg-dim">It never lost you.</p>}
      </div>
      <div className="rounded-[18px] bg-surface p-4 shadow-panel" data-testid="opening">
        <h3 className="mb-1.5 px-2.5 text-[13px] font-semibold">The first 30 seconds</h3>
        <div className="px-2.5">
          <div className="tnum font-display text-[30px] leading-none font-semibold tracking-[-0.03em]">{open === null ? '–' : Math.round(open * 100)}</div>
          <p className="mt-1.5 text-[12.5px] text-fg-muted">{open === null ? 'Not enough signal at the start.' : open >= 0.45 ? 'It hooked you early.' : open >= 0.25 ? 'A moderate start.' : 'A slow start for you.'}</p>
        </div>
      </div>
    </section>
  );
}

export function Tile({ icon, label, value, unit, sub, testId, accent }: { icon: ReactNode; label: string; value: string; unit?: string; sub: string; testId?: string; accent?: string }) {
  return (
    <div className="rounded-[16px] bg-surface px-4 py-3.5 shadow-panel" data-testid={testId}>
      <div className="flex items-center gap-2 text-[12px] text-fg-muted">
        <span className="text-fg-dim [&_svg]:size-[15px]" style={accent ? { color: `var(${accent})` } : undefined}>
          {icon}
        </span>
        {label}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="tnum font-display text-[26px] leading-none font-semibold tracking-[-0.03em] text-fg">{value}</span>
        {unit && <span className="text-[12px] text-fg-dim">{unit}</span>}
      </div>
      <div className="mt-1 truncate text-[12px] text-fg-dim">{sub}</div>
    </div>
  );
}

function Dots({ value }: { value: number | null }) {
  return (
    <div className="mt-1.5 flex items-center gap-1.5" aria-label={value === null ? 'not scored' : `${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cx('size-2.5 rounded-full', value !== null && i <= value ? 'bg-feed' : 'bg-fg/[0.1]')} />
      ))}
      <span className="tnum ml-1 text-[12px] text-fg-muted">{value ?? '–'}</span>
    </div>
  );
}

export function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-1.5">
      <dt className="text-fg-muted">{k}</dt>
      <dd className="tnum text-right text-fg">{v}</dd>
    </div>
  );
}

export function Disclosure({ title, children, testId, defaultOpen }: { title: string; children: ReactNode; testId?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const id = useRef(`d-${Math.random().toString(36).slice(2)}`).current;
  useEffect(() => setOpen(!!defaultOpen), [defaultOpen]);
  return (
    <section className="rounded-[16px] bg-surface shadow-panel" data-testid={testId}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left">
        <span className="text-[13px] font-semibold">{title}</span>
        <Icon.ChevronRight size={15} className={cx('text-fg-dim transition-transform duration-200', open && 'rotate-90')} />
      </button>
      {open && (
        <div id={id} className="fade border-t border-line px-5 py-4">
          {children}
        </div>
      )}
    </section>
  );
}
