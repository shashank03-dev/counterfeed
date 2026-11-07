import { useCallback, useEffect, useState } from 'react';
import { MAX_CLIPS } from '@counterfeed/shared';
import type { ContentSourceInfo, PickedVideo, SourceList } from '../../../../shared/ipc';
import { useApp } from '../../app/store';
import { api } from '../../lib/api';
import { CLIP_MAX_MS, CLIP_MIN_MS, creditEstimate, session } from '../../session/controller';
import { useSession, type PlanClip } from '../../session/store';
import { Icon } from '../icons';
import { Button, Callout, CheckRow, cx, Segmented, Spinner, Status, Switch, TextInput, toast } from '../kit';
import { clock } from '../format';

const LENGTHS = [
  { value: '120000', label: '2 min' },
  { value: '300000', label: '5 min' },
  { value: '600000', label: '10 min' },
  { value: '0', label: 'Until I stop' },
];

/** Focus session lengths. 2 minutes is there to try it (and to demo it). */
const FOCUS_LENGTHS = [
  { value: '120000', label: '2 min' },
  { value: '600000', label: '10 min' },
  { value: '1500000', label: '25 min' },
  { value: '3000000', label: '50 min' },
  { value: '0', label: 'Until I stop' },
];

/** Choose what to watch, agree to what will happen, start. */
export function Setup() {
  const plan = useSession((s) => s.plan)!;
  const { config, prefs, setPrefs, go } = useApp();
  const [list, setList] = useState<SourceList | null>(null);
  const [loading, setLoading] = useState(false);
  const [noPictures, setNoPictures] = useState(false);
  const [reviewKind, setReviewKind] = useState<'video' | 'window'>('video');
  const [consent, setConsent] = useState({ camera: false, pictures: false, wellness: false });
  const isFeed = plan.mode === 'feed';
  const isHooks = plan.mode === 'hooks';
  const isFocus = plan.mode === 'focus';
  const isReview = plan.mode === 'review';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setList(await api.listSources());
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (isFeed || isReview) void load();
    if (isFeed) session.updatePlan({ lengthMs: prefs.feedLength || null, nudges: prefs.nudges });
    if (isFocus) session.updatePlan({ lengthMs: prefs.focusLength || null, nudges: prefs.focusNudges, trackApps: prefs.focusApps });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickSource = (s: ContentSourceInfo) => {
    setNoPictures(false);
    session.updatePlan({ content: { kind: s.kind === 'test' ? 'test' : s.kind, id: s.id, name: s.name, app: s.app }, videoUrl: null });
  };
  const pickVideo = async () => {
    const v = await api.pickVideo();
    if (v) session.updatePlan({ content: { kind: 'video', id: null, name: v.name, app: null }, videoUrl: v.url, title: plan.title ?? v.name.replace(/\.[a-z0-9]+$/i, '') });
  };

  const usingWindow = isFeed || (isReview && reviewKind === 'window');
  const okClips = plan.clips.filter((c) => c.state === 'ok');
  const checking = plan.clips.some((c) => c.state === 'checking');
  const hasContent = isFocus ? true : isHooks ? okClips.length >= 2 && !checking : noPictures ? plan.content.name.trim().length > 1 : plan.content.kind !== 'none';
  const pictures = !noPictures && (plan.content.kind === 'window' || plan.content.kind === 'screen' || plan.content.kind === 'test' || plan.content.kind === 'video');
  const ready = hasContent && consent.camera && consent.wellness && (!pictures || consent.pictures) && (!!config?.apiKey || !!config?.e2e);
  const windows = list?.sources ?? [];
  const access = list?.access;

  return (
    <div className="mx-auto grid w-full max-w-[1120px] gap-6 px-8 pt-16 pb-12 lg:grid-cols-[1fr_360px]">
      <div className="min-w-0">
        <h1 className="font-display text-[28px] leading-tight font-semibold tracking-[-0.03em]">{isFeed ? 'What are you scrolling?' : isHooks ? 'Which clips are you testing?' : isFocus ? 'What are you focusing on?' : 'What are you reviewing?'}</h1>
        <p className="mt-1.5 max-w-[560px] text-[13.5px] leading-relaxed text-fg-muted">
          {isFeed
            ? 'Pick the window you’ll scroll in. Use iPhone Mirroring to scroll your real phone apps on this Mac, or any browser tab.'
            : isHooks
              ? `Add 2 to ${MAX_CLIPS} short clips. They play one at a time, like a feed, and you swipe on whenever you would. Then see which one held you, and the second it did.`
              : isFocus
                ? 'Name the one thing you’ll work on, then work as you normally would. Counterfeed shrinks to a small bar with a timer, notices when your eyes leave the work, and at the end shows how focused you were, and in which apps.'
                : 'Watch a demo video, or try the project in any window. Counterfeed shows where it held your attention and where it lost you.'}
        </p>

        {isHooks && <HookClips />}

        {isFocus && <FocusOptions />}

        {isReview && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Segmented<'video' | 'window'>
              label="What to review"
              value={reviewKind}
              onChange={(v) => {
                setReviewKind(v);
                setNoPictures(false);
                session.updatePlan({ content: { kind: 'none', id: null, name: '', app: null }, videoUrl: null });
              }}
              options={[
                { value: 'video', label: 'A demo video', icon: <Icon.Film /> },
                { value: 'window', label: 'A window', icon: <Icon.Window /> },
              ]}
            />
          </div>
        )}

        {isReview && (
          <div className="mt-4 max-w-[420px]">
            <label className="text-[12px] font-medium" htmlFor="title">
              Project name <span className="font-normal text-fg-dim">(optional)</span>
            </label>
            <TextInput id="title" data-testid="project-title" className="mt-1.5" placeholder="e.g. Glassbreath" maxLength={120} value={plan.title ?? ''} onChange={(e) => session.updatePlan({ title: e.target.value || null })} />
          </div>
        )}

        {isReview && reviewKind === 'video' ? (
          <div className="mt-5">
            <button type="button" data-testid="pick-video" onClick={() => void pickVideo()} className={cx('flex w-full max-w-[560px] items-center gap-4 rounded-[16px] border border-dashed px-5 py-5 text-left transition-colors', plan.videoUrl ? 'border-line-strong bg-surface' : 'border-line-strong hover:bg-fg/[0.03]')}>
              <span className="grid size-11 place-items-center rounded-[12px] bg-g-feed text-white">
                <Icon.Film size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{plan.videoUrl ? plan.content.name : 'Choose a video file'}</span>
                <span className="block text-[12.5px] text-fg-muted">{plan.videoUrl ? 'Click to choose a different one' : 'MP4, MOV or WebM. It plays inside Counterfeed, so moments line up with the video.'}</span>
              </span>
              {plan.videoUrl && <Icon.Check className="text-ok" />}
            </button>
          </div>
        ) : null}

        {usingWindow && (
          <div className="mt-5">
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <h2 className="text-[11px] font-semibold tracking-[0.07em] text-fg-dim uppercase">Windows</h2>
              <Button size="sm" variant="ghost" icon={loading ? <Spinner className="size-3.5" /> : <Icon.Refresh />} onClick={() => void load()}>
                Refresh
              </Button>
            </div>
            {access && access !== 'granted' && access !== 'unknown' && (
              <div className="mb-3">
                <Callout
                  tone="info"
                  title="Allow screen recording to pick a window"
                  action={
                    <Button size="sm" onClick={() => void api.openPrivacySettings('screen')}>
                      Open settings
                    </Button>
                  }
                >
                  Counterfeed keeps small pictures of the window you choose, on this Mac only, so your report can show what was on screen. You can also continue without pictures.
                </Callout>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3" data-testid="sources">
              {windows.map((s) => {
                const sel = !noPictures && plan.content.id === s.id;
                return (
                  <button key={s.id} type="button" data-testid={`source-${s.kind}`} onClick={() => pickSource(s)} className={cx('group overflow-hidden rounded-[14px] bg-surface text-left shadow-panel transition-all duration-200', sel ? 'ring-2 ring-you' : 'hover:-translate-y-0.5')}>
                    <div className="relative aspect-[16/10] bg-surface-2">
                      {s.thumb ? <img src={s.thumb} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-fg-dim">{s.kind === 'test' ? <Icon.Sparkle size={20} /> : s.iphone ? <Icon.Phone size={20} /> : <Icon.Window size={20} />}</div>}
                      {s.iphone && <span className="absolute top-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[10.5px] font-medium text-white backdrop-blur">Your phone</span>}
                      {sel && <span className="absolute top-2 right-2 grid size-5 place-items-center rounded-full bg-you text-white"><Icon.Check size={12} strokeWidth={2.4} /></span>}
                    </div>
                    <div className="truncate px-3 py-2 text-[12.5px]">{s.name}</div>
                  </button>
                );
              })}
              <button type="button" data-testid="source-none" onClick={() => { setNoPictures(true); session.updatePlan({ content: { kind: 'none', id: null, name: '', app: null } }); }} className={cx('grid min-h-[120px] place-items-center rounded-[14px] border border-dashed border-line-strong px-4 text-center transition-colors', noPictures ? 'bg-surface ring-2 ring-you' : 'hover:bg-fg/[0.03]')}>
                <span>
                  <span className="block text-[12.5px] font-medium">Without pictures</span>
                  <span className="mt-0.5 block text-[11.5px] text-fg-dim">Measure only. Name what you’re watching.</span>
                </span>
              </button>
            </div>
            {noPictures && (
              <div className="pop mt-3 max-w-[420px]">
                <TextInput autoFocus data-testid="content-name" placeholder={isFeed ? 'e.g. Instagram Reels' : 'e.g. the project’s live demo'} maxLength={80} value={plan.content.name} onChange={(e) => session.updatePlan({ content: { kind: 'none', id: null, name: e.target.value, app: null } })} />
              </div>
            )}
            {!windows.length && !loading && <p className="mt-2 text-[12.5px] text-fg-dim">No windows to show yet. Open the app you want, then Refresh.</p>}
          </div>
        )}

        {isFeed && (
          <div className="mt-6 grid gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[12px] font-medium">How long</span>
              <Segmented
                label="Session length"
                value={String(plan.lengthMs ?? 0)}
                onChange={(v) => {
                  const ms = Number(v);
                  session.updatePlan({ lengthMs: ms || null });
                  setPrefs({ feedLength: ms });
                }}
                options={LENGTHS}
              />
            </div>
            <div className="max-w-[520px]">
              <Switch
                checked={plan.nudges}
                onChange={(v) => {
                  session.updatePlan({ nudges: v });
                  setPrefs({ nudges: v });
                }}
                label="Gentle nudge"
                hint="The bar glows softly if a breathing pause runs past 8 seconds. Leave it off to measure your usual scrolling."
                testId="pref-nudges"
              />
            </div>
          </div>
        )}
      </div>

      <aside className="h-fit rounded-[18px] bg-surface p-5 shadow-panel lg:sticky lg:top-16">
        <h2 className="text-[14px] font-semibold">Before you start</h2>
        <p className="mt-1 text-[12.5px] text-fg-muted">{isHooks ? 'Tick each line to agree. Testing on someone else? Let them read and tick these themselves.' : 'Tick each line to agree. Nothing starts until you do.'}</p>
        <div className="mt-3.5 grid gap-2">
          <CheckRow checked={consent.camera} onChange={(v) => setConsent({ ...consent, camera: v })} title="Measure me with the camera" testId="consent-camera">
            Breathing, blinking, pulse and facial-expression probabilities, measured on this Mac by SmartSpectra. Video is never stored or sent.
          </CheckRow>
          {pictures && (
            <CheckRow checked={consent.pictures} onChange={(v) => setConsent({ ...consent, pictures: v })} title={isHooks ? 'Keep a still from each clip' : plan.content.kind === 'video' ? 'Keep stills from the video' : 'Keep small pictures of that window'} testId="consent-pictures">
              Only at the moments in your report, only on this Mac. Never exported.
            </CheckRow>
          )}
          <CheckRow checked={consent.wellness} onChange={(v) => setConsent({ ...consent, wellness: v })} title="I understand this is wellness information" testId="consent-wellness">
            Not a medical measurement. It never says how you feel, only what your body did.
          </CheckRow>
        </div>
        <ul className="mt-4 grid gap-1.5 text-[12px] text-fg-muted">
          <li className="flex gap-2"><Icon.Lock size={14} className="mt-px shrink-0 text-fg-dim" />Nothing is uploaded. SDK telemetry is off.</li>
          <li className="flex gap-2"><Icon.Trash size={14} className="mt-px shrink-0 text-fg-dim" />Delete any report, any time.</li>
          {!config?.e2e && (
            <li className="flex gap-2">
              <Icon.Timer size={14} className="mt-px shrink-0 text-fg-dim" />
              Uses about {creditEstimate(isFeed || isFocus ? plan.lengthMs : isHooks ? okClips.reduce((a, c) => a + (c.durationMs ?? 0), 0) : null)} SmartSpectra credits{isFeed || isHooks ? '' : isFocus ? (plan.lengthMs ? '' : ' for 10 minutes') : ' for a 10-minute review'}.
            </li>
          )}
        </ul>
        {!config?.apiKey && !config?.e2e && (
          <div className="mt-4">
            <Callout tone="warn" title="Add your access key first" action={<Button size="sm" onClick={() => { session.cancel(); go('settings'); }}>Settings</Button>}>
              Measuring needs a free SmartSpectra key.
            </Callout>
          </div>
        )}
        <Button variant="you" size="lg" className="mt-5 w-full" disabled={!ready} onClick={() => session.confirm()} data-testid="start" trailing={<Icon.ArrowRight />}>
          {isFeed ? 'Start feed check' : isHooks ? 'Start hook test' : isFocus ? 'Start focus session' : 'Start review'}
        </Button>
        {!hasContent && <p className="mt-2 text-center text-[11.5px] text-fg-dim">{isHooks ? (checking ? 'Checking your clips…' : 'Add at least two clips that can play.') : isReview && reviewKind === 'video' ? 'Choose a video to begin.' : 'Choose a window to begin.'}</p>}
      </aside>
    </div>
  );
}

/** Read a clip's length in the page (the same decoder the test will use). Resolves 'bad' if it can't play. */
function probe(url: string): Promise<{ durationMs: number | null; problem: string | null }> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.crossOrigin = 'anonymous';
    let done = false;
    const finish = (r: { durationMs: number | null; problem: string | null }) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      v.removeAttribute('src');
      v.load();
      resolve(r);
    };
    const timer = window.setTimeout(() => finish({ durationMs: null, problem: 'Took too long to open' }), 10_000);
    v.onloadedmetadata = () => {
      const d = Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : null;
      if (d === null) finish({ durationMs: null, problem: 'Unknown length' });
      else if (!v.videoWidth) finish({ durationMs: d, problem: 'No picture in this file' });
      else if (d < CLIP_MIN_MS) finish({ durationMs: d, problem: `Too short: at least ${CLIP_MIN_MS / 1000} s` });
      else if (d > CLIP_MAX_MS) finish({ durationMs: d, problem: `Too long: up to ${CLIP_MAX_MS / 60_000} min` });
      else finish({ durationMs: d, problem: null });
    };
    v.onerror = () => finish({ durationMs: null, problem: 'Can’t play this file' });
    v.src = url;
  });
}

/** Hook test: the clips to rank. Add your own, or use the demo pack; each is checked before it can start. */
function HookClips() {
  const plan = useSession((s) => s.plan)!;
  const clips = plan.clips;

  const add = (picked: PickedVideo[], replace = false) => {
    const current = replace ? [] : useSession.getState().plan!.clips;
    const names = new Set(current.map((c) => c.name));
    const fresh: PlanClip[] = picked.filter((p) => !names.has(p.name)).map((p) => ({ url: p.url, name: p.name, durationMs: null, state: 'checking', problem: null }));
    const room = MAX_CLIPS - current.length;
    if (fresh.length > room) toast({ title: `Up to ${MAX_CLIPS} clips`, body: `${fresh.length - Math.max(0, room)} weren’t added.`, tone: 'warn' });
    const next = [...current, ...fresh.slice(0, Math.max(0, room))];
    session.updatePlan({ clips: next });
    for (const c of next.filter((x) => x.state === 'checking')) {
      void probe(c.url).then((r) => {
        const cur = useSession.getState().plan;
        if (!cur) return;
        session.updatePlan({ clips: cur.clips.map((x) => (x.url === c.url ? { ...x, durationMs: r.durationMs, state: r.problem ? 'bad' : 'ok', problem: r.problem } : x)) });
      });
    }
  };
  const pick = async () => {
    const r = await api.pickClips();
    if (!r) return;
    if (r.dropped) toast({ title: `Up to ${MAX_CLIPS} clips`, body: `${r.dropped} weren’t added.`, tone: 'warn' });
    add(r.clips);
  };
  const demo = async () => {
    const d = await api.demoPack();
    if (!d.length) return toast({ title: 'The demo pack isn’t available', body: 'Add your own clips instead.', tone: 'warn' });
    add(d, true);
  };

  return (
    <div className="mt-5 grid max-w-[620px] gap-4">
      <div className="flex flex-wrap gap-2">
        <Button icon={<Icon.Plus />} onClick={() => void pick()} disabled={clips.length >= MAX_CLIPS} data-testid="add-clips">
          Add clips
        </Button>
        <Button variant="ghost" icon={<Icon.Sparkle />} onClick={() => void demo()} data-testid="demo-pack">
          Use the demo pack
        </Button>
      </div>
      {clips.length ? (
        <ol className="grid gap-1.5" data-testid="clip-list">
          {clips.map((c, i) => (
            <li key={c.url} className="flex items-center gap-3 rounded-[12px] bg-surface px-3 py-2.5 shadow-panel" data-testid="clip-item" data-state={c.state} data-name={c.name}>
              <span className={cx('grid size-8 shrink-0 place-items-center rounded-[9px]', c.state === 'bad' ? 'bg-warn/15 text-warn' : 'bg-hook-soft text-hook')}>{c.state === 'bad' ? <Icon.Warn size={15} /> : <Icon.Clips size={15} />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{c.name}</span>
                <span className={cx('tnum block text-[12px]', c.state === 'bad' ? 'text-warn' : 'text-fg-dim')}>{c.state === 'checking' ? 'Checking…' : c.state === 'bad' ? `${c.problem}. It won’t be played.` : clock(c.durationMs ?? 0)}</span>
              </span>
              <span className="tnum text-[11.5px] text-fg-dim">{i + 1}</span>
              <button type="button" aria-label={`Remove ${c.name}`} onClick={() => session.updatePlan({ clips: useSession.getState().plan!.clips.filter((x) => x.url !== c.url) })} className="grid size-7 place-items-center rounded-[8px] text-fg-dim hover:bg-fg/[0.07] hover:text-fg" data-testid="remove-clip">
                <Icon.X size={14} />
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <div className="rounded-[14px] border border-dashed border-line-strong px-5 py-6 text-center text-[12.5px] text-fg-muted">
          Vertical clips work best, 10 seconds to a minute each. MP4, MOV or WebM. Or try the demo pack: five short clips with very different openings.
        </div>
      )}
      <div className="grid max-w-[420px] gap-3">
        <div>
          <label className="text-[12px] font-medium" htmlFor="hook-title">
            Name this test <span className="font-normal text-fg-dim">(optional)</span>
          </label>
          <TextInput id="hook-title" data-testid="project-title" className="mt-1.5" placeholder="e.g. Launch reel, three openings" maxLength={120} value={plan.title ?? ''} onChange={(e) => session.updatePlan({ title: e.target.value || null })} />
        </div>
        <Switch checked={plan.shuffle} onChange={(v) => session.updatePlan({ shuffle: v })} label="Shuffle the order" hint="Recommended: then no clip gains from going first." testId="shuffle" />
      </div>
    </div>
  );
}

/** Focus session: the one thing, how long, and what Counterfeed does around it. */
function FocusOptions() {
  const plan = useSession((s) => s.plan)!;
  const { setPrefs } = useApp();
  return (
    <div className="mt-5 grid max-w-[560px] gap-5" data-testid="focus-options">
      <div>
        <label className="text-[12px] font-medium" htmlFor="focus-task">
          The one thing <span className="font-normal text-fg-dim">(optional)</span>
        </label>
        <TextInput id="focus-task" data-testid="focus-task" className="mt-1.5" placeholder="e.g. Write the launch post" maxLength={120} value={plan.title ?? ''} onChange={(e) => session.updatePlan({ title: e.target.value || null })} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[12px] font-medium">How long</span>
        <Segmented
          label="Focus length"
          value={String(plan.lengthMs ?? 0)}
          onChange={(v) => {
            const ms = Number(v);
            session.updatePlan({ lengthMs: ms || null });
            setPrefs({ focusLength: ms });
          }}
          options={FOCUS_LENGTHS}
        />
      </div>
      <FocusDnd />
      <div className="grid gap-1">
        <Switch
          checked={plan.trackApps}
          onChange={(v) => {
            session.updatePlan({ trackApps: v });
            setPrefs({ focusApps: v });
          }}
          label="Note which app is in front"
          hint="Once a second, names only, never what’s in them. The report shows where your focus went."
          testId="pref-apps"
        />
        <Switch
          checked={plan.nudges}
          onChange={(v) => {
            session.updatePlan({ nudges: v });
            setPrefs({ focusNudges: v });
          }}
          label="Gentle nudge"
          hint="The bar glows softly if you look away for 20 seconds. Leave it off to see how you usually work."
          testId="pref-nudges"
        />
      </div>
    </div>
  );
}

/**
 * Do Not Disturb. macOS has no public switch for apps, so it goes through two Shortcuts the person makes once.
 * When they exist it's a switch; when they don't, the one-minute setup, with a way to check again.
 */
function FocusDnd() {
  const plan = useSession((s) => s.plan)!;
  const setPrefs = useApp((s) => s.setPrefs);
  const [state, setState] = useState<{ ready: boolean; missing: string[] } | null>(null);
  const check = useCallback(async () => {
    setState(null);
    const r = await api.focusShortcuts().catch(() => ({ ready: false, missing: [] as string[] }));
    setState(r);
    session.updatePlan({ dnd: r.ready && useApp.getState().prefs.focusDnd });
  }, []);
  useEffect(() => {
    void check();
  }, [check]);

  if (!state)
    return (
      <div data-testid="dnd" data-state="checking" className="text-[12.5px]">
        <Status kind="busy">Looking for your Focus shortcuts…</Status>
      </div>
    );
  if (state.ready)
    return (
      <div data-testid="dnd" data-state="ready">
        <Switch
          checked={plan.dnd}
          onChange={(v) => {
            session.updatePlan({ dnd: v });
            setPrefs({ focusDnd: v });
          }}
          label="Turn on Do Not Disturb"
          hint="Runs your “Counterfeed Focus On” shortcut as the session starts, and “Counterfeed Focus Off” when it ends, however it ends."
          testId="pref-dnd"
        />
      </div>
    );
  const one = state.missing.length === 1 ? state.missing[0] : null;
  return (
    <div className="rounded-[14px] bg-surface p-4 shadow-panel" data-testid="dnd" data-state="setup">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-focus-soft text-focus-ink">
          <Icon.Moon size={16} />
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-medium">Turn on Do Not Disturb too</div>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-muted">macOS lets apps switch Focus only through Shortcuts. Set it up once; it takes about a minute.</p>
          <ol className="mt-2 grid list-decimal gap-1 pl-4 text-[12.5px] leading-relaxed text-fg-muted">
            <li>
              In Shortcuts, make a shortcut named <span className="font-medium text-fg">Counterfeed Focus On</span> with one action: <span className="font-medium text-fg">Set Focus</span>, turn Do Not Disturb on, until turned off.
            </li>
            <li>
              Make another named <span className="font-medium text-fg">Counterfeed Focus Off</span>: <span className="font-medium text-fg">Set Focus</span>, turn Do Not Disturb off.
            </li>
          </ol>
          {one && <p className="mt-2 text-[12px] text-warn">Still missing: {one}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" icon={<Icon.External />} onClick={() => void api.openShortcuts()} data-testid="open-shortcuts">
              Open Shortcuts
            </Button>
            <Button size="sm" variant="ghost" icon={<Icon.Refresh />} onClick={() => void check()} data-testid="dnd-recheck">
              Check again
            </Button>
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-fg-dim">Optional. Without it the session runs the same; you can turn Focus on yourself from Control Center.</p>
        </div>
      </div>
    </div>
  );
}
