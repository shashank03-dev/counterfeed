import { useState } from 'react';
import { useApp } from '../../app/store';
import { PROBLEMS } from '../../app/problems';
import { api } from '../../lib/api';
import { Session } from '../../session/controller';
import { remaining } from '../../session/machine';
import { useSession } from '../../session/store';
import { Icon } from '../icons';
import { Button, Confirm, cx, IconButton, Tooltip, useCopy, useNow } from '../kit';
import { BrandMark } from '../viz';
import { formatDate } from '../format';
import { Breathing } from './Breathing';
import { Call } from './Call';
import { Consent } from './Consent';
import { LiveDiagnostics } from './Diagnostics';
import { Lobby } from './Lobby';
import { Mood } from './Mood';
import { Results } from './Results';
import { Waiting } from './Waiting';

const RAIL = [
  { label: 'Talk', states: ['call', 'moodStart'] },
  { label: 'Apart', states: ['apart'] },
  { label: 'Together', states: ['together'] },
  { label: 'Results', states: ['moodEnd', 'results', 'ended'] },
];

/** The immersive session view: no sidebar, one calm stage, the phase rail on top. */
export function Stage() {
  const state = useSession((s) => s.ctx.state);
  const problem = useSession((s) => s.problem);
  const [drawer, setDrawer] = useState(false);

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--stage)' }}>
      <TopBar onDiagnostics={() => setDrawer((d) => !d)} drawer={drawer} />
      <Banners />
      <div className="relative min-h-0 flex-1">
        <div key={state} className="fade absolute inset-0">
          {state === 'consent' && <Consent />}
          {state === 'connecting' && <Waiting />}
          {state === 'lobby' && <Lobby />}
          {state === 'call' && <Call />}
          {(state === 'moodStart' || state === 'moodEnd') && <Mood when={state === 'moodStart' ? 'start' : 'end'} />}
          {(state === 'apart' || state === 'together') && <Breathing phase={state} />}
          {(state === 'results' || state === 'ended') && <SessionResults />}
        </div>
        <PhaseCountdown />
        {drawer && (
          <aside className="pop absolute top-3 right-3 bottom-3 z-30 w-[340px] overflow-hidden rounded-[16px] bg-overlay shadow-pop" aria-label="Session details">
            <LiveDiagnostics onClose={() => setDrawer(false)} />
          </aside>
        )}
      </div>
      {problem && PROBLEMS[problem].blocking && <ProblemScreen />}
    </div>
  );
}

function TopBar({ onDiagnostics, drawer }: { onDiagnostics: () => void; drawer: boolean }) {
  const s = useSession();
  const [confirm, setConfirm] = useState(false);
  const { copy, done } = useCopy();
  const now = useNow(500);
  const idx = RAIL.findIndex((r) => r.states.includes(s.ctx.state));
  const finished = s.ctx.state === 'results' || s.ctx.state === 'ended';
  const preCall = s.ctx.state === 'consent' || s.ctx.state === 'connecting' || s.ctx.state === 'lobby';
  const end = () => {
    if (finished || s.ctx.state === 'consent') return Session.current?.dispose();
    setConfirm(true);
  };

  return (
    <header className="drag relative flex h-[52px] shrink-0 items-center gap-3 pr-3 pl-[86px]">
      <div className="flex min-w-0 items-center gap-2.5">
        <BrandMark size={20} still />
        {s.code && (
          <Tooltip content={done ? 'Copied' : 'Copy room code'}>
            <button type="button" onClick={() => void copy(s.code!)} className="flex h-7 items-center gap-1.5 rounded-[8px] px-2 font-mono text-[12px] tracking-[0.06em] text-fg-muted transition-colors hover:bg-fg/[0.06] hover:text-fg" data-testid="room-code-chip">
              {s.code}
              {done ? <Icon.Check size={13} className="text-ok" /> : <Icon.Copy size={13} />}
            </button>
          </Tooltip>
        )}
        {s.recording && (
          <Tooltip content="Your numbers are being kept on this laptop for Practice. No video or audio.">
            <span className="flex h-6 items-center gap-1.5 rounded-full px-2 text-[11.5px] text-fg-muted" data-testid="recording-indicator">
              <span className="size-1.5 rounded-full bg-bad" /> Rec
            </span>
          </Tooltip>
        )}
        {s.sourceKind === 'test' && <span className="rounded-[6px] bg-warn/15 px-1.5 py-0.5 text-[11px] font-medium text-warn">Test signal</span>}
      </div>

      {/* An ended session has no honest progress to show (it may have ended before breathing began). */}
      {!preCall && s.ctx.state !== 'ended' && (
        <nav aria-label="Session progress" className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1">
          {RAIL.map((r, i) => {
            const on = i === idx;
            const past = i < idx || (finished && i <= idx);
            const timed = on && (s.ctx.state === 'apart' || s.ctx.state === 'together') && s.ctx.timer;
            const left = timed ? remaining(s.ctx, now) ?? 0 : 0;
            return (
              <div key={r.label} className="flex items-center gap-1">
                {i > 0 && <span className={cx('h-px w-6 transition-colors duration-500', past || on ? 'bg-fg-muted/50' : 'bg-line-strong')} />}
                <span
                  className={cx(
                    'flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] transition-all duration-500',
                    on ? 'bg-fg/[0.08] font-medium text-fg shadow-[0_0_0_0.5px_var(--line-strong)_inset]' : past ? 'text-fg-muted' : 'text-fg-dim',
                  )}
                  aria-current={on ? 'step' : undefined}
                >
                  {past && !on ? <Icon.Check size={12} strokeWidth={2.2} className="text-ok" /> : <span className={cx('size-1.5 rounded-full', on ? 'bg-g-duo' : 'bg-current opacity-60')} />}
                  {r.label}
                  {timed && <span className="tnum text-fg-muted">{Math.floor(Math.ceil(left / 1000) / 60)}:{String(Math.ceil(left / 1000) % 60).padStart(2, '0')}</span>}
                </span>
              </div>
            );
          })}
        </nav>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        {!preCall && !finished && (
          <IconButton label="Session details" onClick={onDiagnostics} active={drawer}>
            <Icon.Pulse />
          </IconButton>
        )}
        {finished ? (
          <Button size="sm" variant="primary" onClick={end} data-testid="done">
            Done
          </Button>
        ) : (
          <Button size="sm" variant="quiet-danger" icon={<Icon.Leave />} onClick={end} data-testid="end">
            {s.ctx.state === 'consent' ? 'Cancel' : 'End'}
          </Button>
        )}
      </div>
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        title={preCall ? 'Leave the room?' : 'End the session for both of you?'}
        body={preCall ? 'The room closes and nothing is saved.' : 'Camera and microphone stop on both laptops. Whatever was measured so far is kept on this laptop.'}
        confirmLabel={preCall ? 'Leave' : 'End session'}
        onConfirm={() => Session.current?.end()}
      />
    </header>
  );
}

/** Banners that must stay visible: replayed partner, reconnecting, notices. */
function Banners() {
  const replay = useSession((s) => s.partner.replay);
  const selfReplay = useSession((s) => s.selfReplay);
  const reconnectBy = useSession((s) => s.ctx.reconnectBy);
  const notice = useSession((s) => s.notice);
  const now = useNow(250);
  const left = reconnectBy ? Math.max(0, Math.ceil((reconnectBy - now) / 1000)) : 0;
  return (
    <div className="grid gap-2 px-4 empty:hidden">
      {replay && (
        <div data-testid="replay-banner" className="flex items-center gap-2 rounded-[10px] border border-them/30 bg-them/[0.08] px-3 py-2 text-[12.5px] text-fg">
          <Icon.Play size={14} className="text-them" />
          <span>
            <span className="font-medium">Replayed session</span> <span className="text-fg-muted">(recorded {formatDate(replay.recordedAt / 1000)}). Your partner’s signals are a recording, not live.</span>
          </span>
        </div>
      )}
      {selfReplay && (
        <div className="flex items-center gap-2 rounded-[10px] border border-line-strong bg-surface-2 px-3 py-2 text-[12.5px] text-fg-muted">
          <Icon.Play size={14} /> This instance sends a recording (recorded {formatDate(selfReplay.recordedAt / 1000)}), not a live measurement.
        </div>
      )}
      {reconnectBy && (
        <div role="status" className="flex items-center gap-2 rounded-[10px] border border-warn/30 bg-warn/[0.08] px-3 py-2 text-[12.5px]">
          <Icon.Warn size={14} className="text-warn" />
          <span className="font-medium">Connection lost.</span>
          <span className="text-fg-muted">Timers are paused. Waiting {left}s for your partner to come back.</span>
        </div>
      )}
      {notice && <NoticeBar />}
    </div>
  );
}

function NoticeBar() {
  const notice = useSession((s) => s.notice)!;
  const copy = PROBLEMS[notice];
  return (
    <div role="status" className="flex items-center gap-2 rounded-[10px] border border-line-strong bg-surface-2 px-3 py-2 text-[12.5px]">
      <Icon.Info size={14} className="text-fg-muted" />
      <span className="font-medium">{copy.title}.</span>
      <span className="truncate text-fg-muted">{copy.body}</span>
      {copy.action?.kind === 'mic-privacy' && (
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void api.openPrivacySettings('microphone')}>
          {copy.action.label}
        </Button>
      )}
      <IconButton label="Dismiss" className="ml-auto size-6" onClick={() => useSession.setState({ notice: null })}>
        <Icon.X />
      </IconButton>
    </div>
  );
}

/** 3, 2, 1 before Apart and Together begin. */
function PhaseCountdown() {
  const scheduled = useSession((s) => s.ctx.scheduled);
  const now = useNow(100);
  if (!scheduled || (scheduled.name !== 'apart' && scheduled.name !== 'together')) return null;
  const left = Math.ceil((scheduled.at - now) / 1000);
  if (left > 3 || left < 1) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-bg/55 backdrop-blur-[6px]">
      <div className="text-center">
        <div className="mb-2 text-[13px] font-medium tracking-[0.08em] text-fg-muted uppercase">{scheduled.name === 'apart' ? 'Apart begins' : 'Now, together'}</div>
        <div key={left} className="count tnum font-display text-[96px] leading-none font-semibold tracking-[-0.05em] text-duo">
          {left}
        </div>
        <div className="mt-3 text-[13px] text-fg-muted">Settle in. No talking until it’s over.</div>
      </div>
    </div>
  );
}

function SessionResults() {
  const result = useSession((s) => s.result);
  const analyzing = useSession((s) => s.analyzing);
  const ctx = useSession((s) => s.ctx);
  if (analyzing || (ctx.state === 'results' && !result)) {
    return (
      <div className="grid h-full place-items-center">
        <div className="text-center">
          <BrandMark size={52} />
          <div className="mt-4 text-[14px] font-medium">Comparing your breathing…</div>
          <div className="mt-1 text-[12.5px] text-fg-dim">Against 200 random pairings, on this laptop.</div>
        </div>
      </div>
    );
  }
  if (!result) return <EndedEarly />;
  return (
    <div className="scroll h-full">
      <Results record={result} live endedEarly={ctx.state === 'ended' && ctx.partial} reason={ctx.endReason} />
    </div>
  );
}

function EndedEarly() {
  const reason = useSession((s) => s.ctx.endReason);
  const text = reason === 'partner-ended' ? 'Your partner ended the session.' : reason === 'partner-lost' ? 'The connection didn’t come back within 20 seconds.' : 'You ended the session.';
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="pop w-[420px] rounded-[18px] bg-surface p-7 text-center shadow-panel" data-testid="ended">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-fg/[0.06]">
          <Icon.Leave size={22} className="text-fg-muted" />
        </div>
        <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Session ended</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">{text} The breathing part hadn’t started, so there are no results to keep. Camera and microphone are off.</p>
        <Button variant="primary" className="mt-6" onClick={() => Session.current?.dispose()}>
          Back to home
        </Button>
      </div>
    </div>
  );
}

function ProblemScreen() {
  const problem = useSession((s) => s.problem)!;
  const copy = PROBLEMS[problem];
  const go = useApp((s) => s.go);
  const leave = () => Session.current?.dispose();
  const act = () => {
    const k = copy.action?.kind;
    if (k === 'settings') {
      leave();
      go('settings');
    } else if (k === 'camera-privacy') void api.openPrivacySettings('camera');
    else if (k === 'mic-privacy') void api.openPrivacySettings('microphone');
    else if (k === 'presage-keys') void api.openExternal('presage-keys');
    else if (k === 'retry' && Session.current) {
      const { config, intent } = Session.current;
      leave();
      Session.begin(config, intent);
    } else leave();
  };
  return (
    <div className="fade absolute inset-0 z-40 grid place-items-center bg-bg/70 p-8 backdrop-blur-md">
      <div role="alertdialog" aria-label={copy.title} className="pop w-[440px] rounded-[18px] bg-overlay p-7 shadow-pop" data-testid={`problem-${problem}`}>
        <div className="mb-4 grid size-11 place-items-center rounded-[12px] bg-bad/12 text-bad">
          <Icon.Warn size={22} />
        </div>
        <h2 className="text-[17px] font-semibold tracking-[-0.015em]">{copy.title}</h2>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-muted">{copy.body}</p>
        <div className="mt-6 flex justify-end gap-2">
          {copy.action && copy.action.kind !== 'home' && <Button onClick={leave}>Back to home</Button>}
          <Button variant="primary" onClick={act}>
            {copy.action?.label ?? 'Back to home'}
          </Button>
        </div>
      </div>
    </div>
  );
}
