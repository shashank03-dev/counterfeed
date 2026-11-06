import { useState } from 'react';
import { normalizeRoomCode } from '@together/shared';
import { useApp } from '../../app/store';
import { Session } from '../../session/controller';
import { Icon } from '../icons';
import { Button, Callout, cx, TextInput } from '../kit';
import { Sparkline } from '../viz';
import { formatDay, verdict } from '../format';

export function Home() {
  const { config, sessions, recordings, go } = useApp();
  const [code, setCode] = useState('');
  const [bad, setBad] = useState(false);
  const last = sessions?.[0];
  const rec = recordings?.[0];

  const start = (intent: Parameters<typeof Session.begin>[1]) => {
    if (config) Session.begin(config, intent);
  };
  const join = () => {
    const c = normalizeRoomCode(code);
    if (!c) {
      setBad(true);
      setTimeout(() => setBad(false), 400);
      return;
    }
    start({ kind: 'join', code: c });
  };
  const needsKey = !config?.apiKey && !config?.e2e && !config?.peer2;

  return (
    <div className="mx-auto flex min-h-full max-w-[960px] flex-col justify-center px-10 py-14">
      <header className="rise mb-10 max-w-[680px]">
        <h1 className="font-display text-[36px] leading-[1.1] font-semibold tracking-[-0.038em] text-balance">
          Breathe <span className="text-duo">in step</span> with someone, wherever they are.
        </h1>
        <p className="mt-3 max-w-[600px] text-[14px] leading-relaxed text-pretty text-fg-muted">
          Talk on a video call, then spend five quiet minutes breathing, first apart, then together. Each laptop measures its own person; you see both breaths and how closely they move.
        </p>
      </header>

      {needsKey && (
        <div className="rise mb-6" style={{ ['--i' as string]: 1 }}>
          <Callout tone="warn" title="Measurement needs an access key" action={<Button size="sm" onClick={() => go('settings')}>Add key</Button>} testId="home-no-key">
            Your camera measures breathing on this laptop with SmartSpectra; the key just unlocks it.
          </Callout>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <section className="rise flex flex-col rounded-[16px] bg-surface p-5 shadow-panel" style={{ ['--i' as string]: 2 }}>
          <span className="mb-4 grid size-9 place-items-center rounded-[11px] bg-g-you text-white shadow-[0_6px_16px_-8px_var(--you)]">
            <Icon.Plus size={18} strokeWidth={2} />
          </span>
          <h2 className="text-[16px] font-semibold tracking-[-0.015em]">Start a room</h2>
          <p className="mt-1 mb-5 text-[13px] leading-relaxed text-fg-muted">You’ll get a short code like <span className="font-mono text-fg">TIDE-42</span> to send to the other person.</p>
          <Button variant="you" size="lg" className="mt-auto self-start" onClick={() => start({ kind: 'create' })} trailing={<Icon.ArrowRight />} data-testid="start-room">
            Start a room
          </Button>
        </section>

        <section className="rise flex flex-col rounded-[16px] bg-surface p-5 shadow-panel" style={{ ['--i' as string]: 3 }}>
          <span className="mb-4 grid size-9 place-items-center rounded-[11px] bg-g-them text-white shadow-[0_6px_16px_-8px_var(--them)]">
            <Icon.ArrowRight size={18} strokeWidth={2} />
          </span>
          <h2 className="text-[16px] font-semibold tracking-[-0.015em]">Join with a code</h2>
          <p className="mt-1 mb-5 text-[13px] leading-relaxed text-fg-muted">Type the code you were sent. Rooms close after 10 quiet minutes.</p>
          <form
            className={cx('mt-auto flex gap-2', bad && 'shake')}
            onSubmit={(e) => {
              e.preventDefault();
              join();
            }}
          >
            <TextInput
              aria-label="Room code"
              data-testid="join-code"
              value={code}
              placeholder="TIDE-42"
              maxLength={12}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="h-10 font-mono text-[14px] tracking-[0.08em] uppercase"
            />
            <Button type="submit" variant="primary" size="lg" disabled={!code.trim()} data-testid="join-room">
              Join
            </Button>
          </form>
          {bad && <p className="mt-2 text-[12px] text-bad">Codes look like TIDE-42: a word and two digits.</p>}
        </section>
      </div>

      <ol className="rise mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-fg-dim" style={{ ['--i' as string]: 4 }} aria-label="How a session goes">
        {['Talk on video', 'Breathe apart · 2 min', 'Breathe together · 3 min', 'See how in step you were'].map((t, i) => (
          <li key={t} className="flex items-center gap-2">
            {i > 0 && <Icon.ChevronRight size={12} className="opacity-60" />}
            <span>{t}</span>
          </li>
        ))}
      </ol>

      {(last || rec) && (
        <div className="mt-4 grid grid-cols-2 gap-4">
          {last ? (
            <button type="button" onClick={() => go('history')} className="rise flex items-center gap-4 rounded-[16px] bg-surface p-4 text-left shadow-panel transition-colors hover:bg-surface-2" style={{ ['--i' as string]: 6 }}>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium tracking-[0.06em] text-fg-dim uppercase">Last session · {formatDay(last.startedAt)}</div>
                <div className="mt-1 truncate text-[14px] font-medium">{verdict(last.together).short}</div>
              </div>
              <Sparkline values={last.together?.series ?? []} width={110} height={30} />
              <Icon.ChevronRight className="text-fg-dim" />
            </button>
          ) : (
            <div />
          )}
          {rec && (
            <div className="rise flex items-center gap-4 rounded-[16px] bg-surface p-4 shadow-panel" style={{ ['--i' as string]: 7 }}>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium tracking-[0.06em] text-fg-dim uppercase">Practice</div>
                <div className="mt-1 text-[13px] text-fg-muted">Breathe with a replay of a session recorded {formatDay(rec.recordedAt)}. Clearly labelled, numbers only.</div>
              </div>
              <Button size="md" icon={<Icon.Play />} onClick={() => start({ kind: 'practice', recordingId: rec.id })} data-testid="practice">
                Practice
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
