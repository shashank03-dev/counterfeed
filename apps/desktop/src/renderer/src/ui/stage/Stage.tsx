import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../../app/store';
import { PROBLEMS } from '../../app/problems';
import { api } from '../../lib/api';
import { session } from '../../session/controller';
import { useSession, type Step } from '../../session/store';
import { Icon } from '../icons';
import { CHEST_CODES } from '../../sensing/quality';
import { Button, cx, Spinner, Status } from '../kit';
import { FOCUS_FELT } from '../../analysis/focus';
import { Report } from '../Report';
import { clock, FELT } from '../format';
import { BrandMark, CameraPreview, LiveWave, ProgressRing } from '../viz';
import { ClipFeed } from './ClipFeed';
import { Cue } from './Cue';
import { Setup } from './Setup';

const STEPS: { id: Step[]; label: string }[] = [
  { id: ['setup', 'before'], label: 'Choose' },
  { id: ['settle'], label: 'Your normal' },
  { id: ['watch'], label: 'Watch' },
  { id: ['after', 'analyzing', 'report'], label: 'Report' },
];

/** A session, full window. Shrinks to a small bar while you watch another window. */
export function Stage() {
  const step = useSession((s) => s.step);
  const plan = useSession((s) => s.plan);
  const e2e = useApp((s) => s.config?.e2e);
  const isVideo = plan?.content.kind === 'video';
  const compact = step === 'watch' && !isVideo;

  if (compact) return <WatchBar />;
  return (
    <div className="bg-glow relative flex h-full flex-col bg-bg">
      <header className="drag relative z-20 flex h-12 shrink-0 items-center justify-between gap-4 pr-4 pl-[86px] [--mark-ring:var(--bg)]">
        <div className="flex items-center gap-2">
          <BrandMark size={20} still />
          <span className="text-[13px] font-semibold tracking-[-0.01em]">Counterfeed</span>
          {e2e && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-medium text-warn">Test signal</span>}
        </div>
        <ol className="hidden items-center gap-1.5 md:flex" aria-label="Progress">
          {STEPS.map((s, i) => {
            const idx = STEPS.findIndex((x) => x.id.includes(step));
            const state = i < idx ? 'done' : i === idx ? 'now' : 'next';
            return (
              <li key={s.label} className="flex items-center gap-1.5">
                <span className={cx('flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] transition-colors', state === 'now' ? 'bg-fg/[0.08] font-medium text-fg' : state === 'done' ? 'text-fg-muted' : 'text-fg-dim')} aria-current={state === 'now' ? 'step' : undefined}>
                  {state === 'done' ? <Icon.Check size={12} strokeWidth={2.4} className="text-ok" /> : <span className="tnum text-[11px]">{i + 1}</span>}
                  {s.label === 'Watch' && plan?.mode === 'focus' ? 'Focus' : s.label}
                </span>
                {i < STEPS.length - 1 && <span className="h-px w-4 bg-line-strong" />}
              </li>
            );
          })}
        </ol>
        <div className="flex w-[160px] justify-end">
          {(step === 'setup' || step === 'before' || step === 'problem') && (
            <Button size="sm" variant="ghost" icon={<Icon.X />} onClick={() => session.cancel()} data-testid="cancel">
              Cancel
            </Button>
          )}
          {step === 'settle' && (
            <Button size="sm" variant="ghost" icon={<Icon.X />} onClick={() => session.cancel()} data-testid="cancel">
              Stop
            </Button>
          )}
          {step === 'report' && (
            <Button size="sm" variant="primary" onClick={() => session.cancel()} data-testid="done">
              Done
            </Button>
          )}
        </div>
      </header>
      <div className="scroll relative min-h-0 flex-1">
        {isVideo && (step === 'settle' || step === 'watch') && (plan?.mode === 'hooks' ? <ClipFeed /> : <VideoReview />)}
        {step === 'setup' && <Setup />}
        {step === 'before' && <Before />}
        {step === 'settle' && <Settle />}
        {step === 'after' && <After />}
        {step === 'analyzing' && <Center><Spinner className="size-6 text-fg-muted" /><p className="mt-3 text-[14px] text-fg-muted">Reading your session…</p></Center>}
        {step === 'report' && <ReportStep />}
        {step === 'problem' && <ProblemStep />}
      </div>
    </div>
  );
}

function Center({ children }: { children: ReactNode }) {
  return <div className="fade grid min-h-full place-items-center px-8 py-10 text-center"><div className="grid justify-items-center">{children}</div></div>;
}

function FeltPicker({ value, onChange, testId, words = FELT, tone = 'you', label }: { value: number | null; onChange: (v: number) => void; testId: string; words?: readonly string[]; tone?: 'you' | 'focus'; label?: string }) {
  return (
    <div className="flex flex-wrap justify-center gap-2" role="radiogroup" aria-label={label} data-testid={testId}>
      {words.map((w, i) => (
        <button key={w} type="button" role="radio" aria-checked={value === i + 1} data-testid={`${testId}-${i + 1}`} onClick={() => onChange(i + 1)} className={cx('h-11 min-w-[88px] rounded-[12px] border px-4 text-[14px] font-medium transition-all duration-150', value === i + 1 ? cx('border-transparent text-white', tone === 'focus' ? 'bg-g-focus' : 'bg-g-you') : 'border-line-strong bg-surface text-fg hover:bg-surface-2')}>
          {w}
        </button>
      ))}
    </div>
  );
}

function Before() {
  const felt = useSession((s) => s.felt.before);
  return (
    <Center>
      <h1 className="font-display text-[28px] font-semibold tracking-[-0.03em]">How do you feel right now?</h1>
      <p className="mt-1.5 mb-6 text-[13.5px] text-fg-muted">In your own word. You’ll be asked again at the end; the report shows both, without explaining them for you.</p>
      <FeltPicker value={felt} onChange={(v) => session.setFelt('before', v)} testId="felt-before" />
      <div className="mt-8 flex gap-2">
        <Button variant="ghost" onClick={() => { session.setFelt('before', null); void session.startSettle(); }} data-testid="skip-felt">Skip</Button>
        <Button variant="you" size="lg" disabled={felt === null} onClick={() => void session.startSettle()} data-testid="continue" trailing={<Icon.ArrowRight />}>Continue</Button>
      </div>
    </Center>
  );
}

function Settle() {
  const { settle, quality, preview, plan } = useSession();
  const e2e = useApp((s) => s.config?.e2e);
  const rows = [
    { k: 'light', label: 'Light', v: quality?.light },
    { k: 'framing', label: 'In view, facing the screen', v: quality?.framing },
    { k: 'stillness', label: 'Sitting still', v: quality?.stillness },
  ] as const;
  // Chest-only hints are tips, not problems: your normal is measured from the face either way.
  const chestOnly = !!quality && CHEST_CODES.has(quality.code);
  const hint = quality && quality.code !== 0 && !chestOnly ? quality.hint : null;
  const breathing = quality?.breathing ?? 'unknown';
  return (
    <Center>
      <ProgressRing progress={settle.progress} size={236}>
        <CameraPreview stream={preview} className="size-[212px] rounded-full">
          {e2e && !preview && <div className="absolute inset-0 grid place-items-center text-[12px] text-fg-dim">Test signal, no camera</div>}
        </CameraPreview>
      </ProgressRing>
      <h1 className="mt-6 font-display text-[26px] font-semibold tracking-[-0.03em]" data-testid="settle-title">Finding your normal</h1>
      <p className="mt-1.5 max-w-[460px] text-[13.5px] leading-relaxed text-fg-muted">
        Sit as you usually do when you {plan?.mode === 'review' ? 'review' : plan?.mode === 'focus' ? 'work' : 'scroll'}, and look at the screen. About 40 seconds of clear view, then {plan?.mode === 'hooks' ? 'the first clip starts' : plan?.content.kind === 'video' ? 'the video starts' : plan?.mode === 'focus' ? 'Counterfeed shrinks to a small bar and your focus time starts' : 'Counterfeed shrinks to a small bar and you go'}.
      </p>
      <div className="mt-5 grid w-[320px] gap-2 rounded-[14px] bg-surface p-3.5 text-left text-[13px] shadow-panel" data-testid="checklist">
        {rows.map((r) => (
          <div key={r.k} data-testid={`row-${r.k}`} data-state={r.v ?? 'unknown'}>
            <Status kind={r.v === 'ok' ? 'ok' : r.v === 'warn' ? 'warn' : 'busy'}>{r.label}</Status>
          </div>
        ))}
        <div className="mt-1 border-t border-line pt-2" data-testid="breathing-row" data-state={breathing}>
          <Status kind={breathing === 'ok' ? 'ok' : 'idle'}>
            {breathing === 'ok' ? 'Chest in view: breathing pauses on' : breathing === 'warn' ? 'Chest out of view: breathing pauses off' : 'Breathing: checking'}
          </Status>
          {breathing === 'warn' && <p className="mt-1 pl-6 text-[12px] leading-snug text-fg-dim">Optional. Sit back or tilt the screen so your shoulders are in view to measure breathing too.</p>}
        </div>
      </div>
      <p className="mt-3 h-5 text-[13px] text-warn" role="status" data-testid="settle-hint">{hint}</p>
      <div className="tnum mt-1 text-[12px] text-fg-dim">{Math.round(settle.progress * 100)}%</div>
      {settle.canForce && (
        <div className="pop mt-4 grid justify-items-center gap-2">
          <p className="max-w-[420px] text-[12.5px] text-fg-muted">It’s taking a while to get a clear view. You can go on anyway; the report will leave out comparisons with your normal.</p>
          <Button onClick={() => session.forceContinue()} data-testid="force-continue">Continue anyway</Button>
        </div>
      )}
    </Center>
  );
}

/** The small always-on-top bar while you scroll another window. */
function WatchBar() {
  const { watch, plan } = useSession();
  const e2e = useApp((s) => s.config?.e2e);
  const limit = plan?.lengthMs ? plan.lengthMs * (useApp.getState().config?.timeScale ?? 1) : null;
  const focus = plan?.mode === 'focus';
  return (
    <div className={cx('drag fade flex h-full flex-col justify-between rounded-[14px] bg-panel px-3.5 py-2.5 shadow-bar', watch.nudge && 'nudge', focus && '[--nudge:var(--focus)]')} data-testid="watch-bar">
      <div className="flex items-center gap-2.5">
        <BrandMark size={18} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold">
            {focus ? (plan?.title ? `Focus · ${plan.title}` : 'Focus session') : plan?.mode === 'feed' ? 'Feed check' : plan?.mode === 'hooks' ? 'Hook test' : 'Review'}
            {e2e && <span className="ml-1.5 font-medium text-warn">· Test signal</span>}
          </div>
          <div className="tnum text-[11px] text-fg-dim" data-testid="watch-clock">
            {focus && limit ? `${clock(Math.max(0, limit - watch.elapsedMs))} left` : clock(watch.elapsedMs)}
            {!focus && limit ? ` / ${clock(limit)}` : ''}
            {!focus && !watch.captureLive && ' · no pictures'}
          </div>
        </div>
        <Button size="sm" variant="subtle" icon={<Icon.Stop />} onClick={() => void session.stopWatch('user')} data-testid="stop">
          Stop
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <div className="h-[34px] min-w-0 flex-1">
          <LiveWave seconds={14} testId="live-wave" />
        </div>
        <div className="w-[150px] shrink-0">
          <Cue compact />
        </div>
      </div>
      {watch.nudge && <div className="sr-only" role="status">{focus ? 'Back to the work' : 'Breathe out'}</div>}
    </div>
  );
}

/** Video review: the player, plus the live strip. Mounted during settle (hidden, preloading) and watch. */
function VideoReview() {
  const { step, plan, watch } = useSession();
  const ref = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState({ playing: false, t: 0, d: 0 });
  useEffect(() => {
    session.attachVideo(ref.current);
    return () => session.attachVideo(null);
  }, []);
  useEffect(() => {
    if (step === 'watch') void ref.current?.play().catch(() => {});
  }, [step]);
  useEffect(() => {
    if (step !== 'watch') return;
    const id = window.setInterval(() => {
      const v = ref.current;
      if (v && !v.paused) session.mark(true, v.currentTime * 1000);
    }, 250);
    return () => window.clearInterval(id);
  }, [step]);
  const live = step === 'watch';
  const v = ref.current;
  const mark = () => {
    const el = ref.current;
    if (!el) return;
    setState({ playing: !el.paused, t: el.currentTime, d: Number.isFinite(el.duration) ? el.duration : 0 });
    if (live) session.mark(!el.paused && !el.ended, el.currentTime * 1000);
  };
  return (
    <div className={cx('absolute inset-0 flex flex-col', !live && 'pointer-events-none invisible')} data-testid="video-review" aria-hidden={!live}>
      <div className="grid min-h-0 flex-1 place-items-center px-8 pt-2">
        <video
          ref={ref}
          src={plan?.videoUrl ?? undefined}
          crossOrigin="anonymous"
          playsInline
          preload="auto"
          className="max-h-full max-w-full rounded-[14px] bg-black shadow-pop"
          onPlay={mark}
          onPause={mark}
          onSeeked={mark}
          onTimeUpdate={() => setState((s) => ({ ...s, t: ref.current?.currentTime ?? 0, d: Number.isFinite(ref.current?.duration) ? ref.current!.duration : s.d }))}
          onLoadedMetadata={mark}
          onEnded={() => {
            mark();
            void session.stopWatch('ended');
          }}
          onError={() => session.videoFailed()}
          data-testid="review-video"
        />
      </div>
      <div className="mx-auto mt-3 mb-5 flex w-full max-w-[900px] items-center gap-4 rounded-[16px] bg-surface px-4 py-3 shadow-panel">
        <Button size="md" variant="subtle" icon={state.playing ? <Icon.Pause /> : <Icon.Play />} onClick={() => (v?.paused ? void v.play() : v?.pause())} aria-label={state.playing ? 'Pause' : 'Play'} data-testid="play-pause" />
        <input
          type="range"
          min={0}
          max={state.d || 0}
          step={0.1}
          value={state.t}
          onChange={(e) => {
            if (ref.current) ref.current.currentTime = Number(e.target.value);
          }}
          className="min-w-0 flex-1 accent-[var(--feed)]"
          aria-label="Position in the video"
        />
        <span className="tnum w-[92px] text-right text-[12px] text-fg-muted">
          {clock(state.t * 1000)} / {clock(state.d * 1000)}
        </span>
        <div className="h-[30px] w-[150px] shrink-0">
          <LiveWave seconds={12} />
        </div>
        <div className="w-[150px] shrink-0">
          <Cue compact />
        </div>
        <Button size="md" variant="primary" icon={<Icon.Stop />} onClick={() => void session.stopWatch('user')} data-testid="stop">
          Finish
        </Button>
      </div>
      <span className="sr-only">{clock(watch.elapsedMs)}</span>
    </div>
  );
}

function After() {
  const plan = useSession((s) => s.plan);
  return plan?.mode === 'hooks' ? <AfterHooks /> : plan?.mode === 'focus' ? <AfterFocus /> : <AfterSession />;
}

/** Focus session: how focused it felt, asked before the report so it can sit next to what was measured. */
function AfterFocus() {
  const { watch, plan } = useSession();
  const [felt, setFelt] = useState<number | null>(null);
  return (
    <Center>
      <h1 className="font-display text-[28px] font-semibold tracking-[-0.03em]">How focused did that feel?</h1>
      <p className="mt-1.5 mb-7 max-w-[480px] text-[13.5px] text-fg-muted">Optional. Answer before you see the report; it sits next to what the camera measured.</p>
      <FeltPicker value={felt} onChange={setFelt} testId="felt-focus" words={FOCUS_FELT} tone="focus" label="How focused it felt" />
      <Button variant="primary" size="lg" className="mt-8" onClick={() => void session.finish({ guessMs: null, after: felt, ratings: null, note: null })} data-testid="see-report" trailing={<Icon.ArrowRight />}>
        See my focus report
      </Button>
      <p className="tnum mt-3 text-[12px] text-fg-dim">
        {clock(watch.elapsedMs)} measured{plan?.title ? ` · ${plan.title}` : ''}
      </p>
    </Center>
  );
}

/** Hook test: which clip would you post? Your answer sits next to what held you, in the report. */
function AfterHooks() {
  const { plan, watch } = useSession();
  const [stills] = useState(() => session.clipStills());
  const [picked, setPicked] = useState<number | null>(null);
  const clips = plan?.clips ?? [];
  // Only clips you actually saw can be picked.
  const shown = clips.map((c, i) => ({ c, i, still: stills[i]?.still ?? null, seen: !!stills[i]?.shown })).filter((x) => x.seen);
  return (
    <Center>
      <h1 className="font-display text-[28px] font-semibold tracking-[-0.03em]">Which one would you post?</h1>
      <p className="mt-1.5 mb-7 max-w-[480px] text-[13.5px] text-fg-muted">Optional. Pick before you see what held you, so the report can compare the two.</p>
      <div className="flex max-w-[860px] flex-wrap justify-center gap-3" role="radiogroup" aria-label="The clip you would post" data-testid="pick">
        {shown.map(({ c, i, still }) => (
          <button
            key={c.url}
            type="button"
            role="radio"
            aria-checked={picked === i}
            onClick={() => setPicked(picked === i ? null : i)}
            data-testid={`pick-${i}`}
            className={cx('group w-[120px] overflow-hidden rounded-[14px] bg-surface text-left shadow-panel transition-all duration-150', picked === i ? 'ring-2 ring-hook' : 'hover:-translate-y-0.5')}
          >
            <span className="relative block aspect-[9/16] bg-surface-3">
              {still ? <img src={still} alt="" className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center text-fg-dim"><Icon.Clips size={20} /></span>}
              {picked === i && <span className="absolute top-2 right-2 grid size-5 place-items-center rounded-full bg-hook text-white"><Icon.Check size={12} strokeWidth={2.4} /></span>}
            </span>
            <span className="block truncate px-2.5 py-2 text-[12px]">{c.name.replace(/\.[a-z0-9]{2,4}$/i, '')}</span>
          </button>
        ))}
      </div>
      {!shown.length && <p className="text-[13px] text-fg-dim">No clip played long enough to pick from.</p>}
      <Button variant="primary" size="lg" className="mt-8" onClick={() => void session.finish({ guessMs: null, after: null, ratings: null, note: null, picked })} data-testid="see-report" trailing={<Icon.ArrowRight />}>
        See what held me
      </Button>
      <p className="tnum mt-3 text-[12px] text-fg-dim">{clock(watch.elapsedMs)} measured</p>
    </Center>
  );
}

function AfterSession() {
  const { plan, watch } = useSession();
  const isFeed = plan?.mode === 'feed';
  const [guessMin, setGuessMin] = useState<number | null>(null);
  const [after, setAfter] = useState<number | null>(null);
  const [ratings, setRatings] = useState<{ technology: number | null; usability: number | null; originality: number | null }>({ technology: null, usability: null, originality: null });
  const [note, setNote] = useState('');
  const submit = () =>
    void session.finish({
      guessMs: isFeed && guessMin !== null ? Math.round(guessMin * 60_000) : null,
      after: isFeed ? after : null,
      ratings: isFeed ? null : ratings,
      note: isFeed ? null : note.trim() || null,
    });
  return (
    <Center>
      <h1 className="font-display text-[28px] font-semibold tracking-[-0.03em]">{isFeed ? 'Two quick questions' : 'Your own scores'}</h1>
      <p className="mt-1.5 mb-7 max-w-[480px] text-[13.5px] text-fg-muted">{isFeed ? 'Answer before you see the report. Both are optional.' : 'Optional. They’re shown next to what your body did, so you can see where they agree.'}</p>
      {isFeed ? (
        <div className="grid w-[520px] max-w-full gap-8">
          <div>
            <div className="text-[14px] font-medium">How long do you think you scrolled?</div>
            <div className="mt-3 flex items-center gap-4">
              <input
                type="range"
                min={0.5}
                max={30}
                step={0.5}
                value={guessMin ?? 5}
                onChange={(e) => setGuessMin(Number(e.target.value))}
                // A click or key on the resting position is still an answer.
                onPointerUp={(e) => setGuessMin(Number(e.currentTarget.value))}
                onKeyUp={(e) => setGuessMin(Number(e.currentTarget.value))}
                className={cx('min-w-0 flex-1 accent-[var(--you)]', guessMin === null && 'opacity-60')}
                aria-label="Your guess in minutes"
                data-testid="guess"
              />
              <span className="tnum w-[70px] text-right text-[15px] font-semibold">{guessMin === null ? '–' : `${guessMin} min`}</span>
            </div>
          </div>
          <div>
            <div className="mb-3 text-[14px] font-medium">How do you feel now?</div>
            <FeltPicker value={after} onChange={setAfter} testId="felt-after" />
          </div>
        </div>
      ) : (
        <div className="grid w-[560px] max-w-full gap-4 text-left">
          {(['technology', 'usability', 'originality'] as const).map((k) => (
            <div key={k} className="flex items-center justify-between gap-4">
              <span className="text-[13.5px] font-medium">{k === 'technology' ? 'Use of technology' : k === 'usability' ? 'Usability' : 'Originality'}</span>
              <div className="flex gap-1.5" role="radiogroup" aria-label={k}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={ratings[k] === n} data-testid={`rate-${k}-${n}`} onClick={() => setRatings({ ...ratings, [k]: n })} className={cx('tnum size-9 rounded-[10px] border text-[13px] font-medium transition-colors', ratings[k] !== null && n <= ratings[k]! ? 'border-transparent bg-g-feed text-white' : 'border-line-strong bg-surface hover:bg-surface-2')}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="Notes for yourself (optional)" className="mt-2 h-24 resize-none rounded-[12px] border border-line-strong bg-surface-2 p-3 text-[13px] outline-none placeholder:text-fg-dim focus:border-fg-dim" data-testid="review-note" />
        </div>
      )}
      <Button variant="you" size="lg" className="mt-8" onClick={submit} data-testid="see-report" trailing={<Icon.ArrowRight />}>
        See my report
      </Button>
      <p className="tnum mt-3 text-[12px] text-fg-dim">{clock(watch.elapsedMs)} measured</p>
    </Center>
  );
}

function ReportStep() {
  const { report, thumbs, plan, endedBy } = useSession();
  if (!report) return null;
  const why = endedBy && endedBy !== 'closed' ? PROBLEMS[endedBy]?.title : null;
  return (
    <div className="mx-auto w-full max-w-[1040px] px-8 pt-6 pb-14">
      <Report
        report={report}
        thumbs={thumbs}
        videoUrl={plan?.videoUrl ?? null}
        clipUrls={report.mode === 'hooks' ? (plan?.clips.map((c) => c.url) ?? null) : null}
        banner={why ? <div className="rounded-[12px] border border-warn/25 bg-warn/[0.07] px-4 py-2.5 text-[12.5px] text-fg-muted">Ended early: {why}. This report covers what was measured before that.</div> : undefined}
      />
      <div className="mt-6 flex justify-center gap-2">
        <Button onClick={() => session.begin(report.mode)} icon={<Icon.Refresh />} data-testid="again">
          {report.mode === 'feed' ? 'Check another feed' : report.mode === 'hooks' ? 'Test more clips' : report.mode === 'focus' ? 'Start another focus session' : 'Review another project'}
        </Button>
        <Button variant="primary" onClick={() => session.cancel()}>
          Done
        </Button>
      </div>
    </div>
  );
}

function ProblemStep() {
  const problem = useSession((s) => s.problem);
  const plan = useSession((s) => s.plan);
  const go = useApp((s) => s.go);
  if (!problem) return null;
  const copy = PROBLEMS[problem.kind];
  const act = () => {
    const k = copy.action?.kind;
    if (k === 'settings') {
      session.cancel();
      go('settings');
    } else if (k === 'camera-privacy') void api.openPrivacySettings('camera');
    else if (k === 'presage-keys') void api.openExternal('presage-keys');
    else if (k === 'retry' && plan) {
      useSession.setState({ step: 'setup', problem: null });
    } else session.cancel();
  };
  return (
    <Center>
      <span className="grid size-12 place-items-center rounded-full bg-warn/15 text-warn">
        <Icon.Warn size={22} />
      </span>
      <h1 className="mt-4 font-display text-[24px] font-semibold tracking-[-0.025em]" data-testid="problem-title">
        {copy.title}
      </h1>
      <p className="mt-1.5 max-w-[440px] text-[13.5px] leading-relaxed text-fg-muted">{copy.body}</p>
      <div className="mt-6 flex gap-2">
        <Button onClick={() => session.cancel()}>Back to home</Button>
        {copy.action && copy.action.kind !== 'home' && (
          <Button variant="primary" onClick={act} data-testid="problem-action">
            {copy.action.label}
          </Button>
        )}
      </div>
    </Center>
  );
}
