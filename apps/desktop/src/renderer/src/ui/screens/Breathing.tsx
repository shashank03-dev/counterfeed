import { remaining } from '../../session/machine';
import { useSession } from '../../session/store';
import { Icon } from '../icons';
import { cx, useNow } from '../kit';
import { CountdownRing, Heart, SyncMeter, Waves } from '../viz';

const COPY = {
  apart: { title: 'Apart', line: 'Breathe the way you normally do. Their wave is hidden for now; they’re doing the same.' },
  together: { title: 'Together', line: 'Watch both waves. Don’t force it; let your breathing drift toward theirs.' },
} as const;

/** The two silent phases. Apart: only your wave. Together: both waves overlaid and a live "in step" meter. */
export function Breathing({ phase }: { phase: 'apart' | 'together' }) {
  const s = useSession();
  const now = useNow(250);
  const left = remaining(s.ctx, now) ?? 0;
  const total = s.ctx.timer?.durationMs ?? 0;
  const paused = s.ctx.timer?.pausedAt !== null && s.ctx.timer?.pausedAt !== undefined;
  const together = phase === 'together';
  const youTalking = s.live.you.talking;
  const themTalking = s.live.partner.talking;

  return (
    <div className="mx-auto flex h-full max-w-[1160px] flex-col px-6 pb-6">
      <header className="rise flex items-end justify-between pt-3 pb-5">
        <div>
          <h1 className="font-display text-[30px] leading-none font-semibold tracking-[-0.035em]" data-testid={`phase-${phase}`}>
            {together ? <span className="text-duo">{COPY.together.title}</span> : COPY.apart.title}
          </h1>
          <p className="mt-2 max-w-[520px] text-[13.5px] leading-relaxed text-fg-muted">{COPY[phase].line}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[11px] font-medium tracking-[0.07em] text-fg-dim uppercase">{paused ? 'Paused' : 'Left'}</div>
            <div className="text-[12px] text-fg-muted">{together ? '3 min' : '2 min'} · silent</div>
          </div>
          <CountdownRing remainingMs={left} totalMs={total} size={60} who={together ? 'duo' : 'you'} />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_236px] gap-4">
        <section className="relative flex min-h-0 flex-col overflow-hidden rounded-[22px] bg-surface/70 shadow-panel backdrop-blur" aria-label="Breathing">
          <div className="flex items-center gap-4 px-5 pt-4 text-[12px] text-fg-muted">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-you" /> You
            </span>
            {together ? (
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-them" /> Them
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-fg-dim">
                <span className="size-2 rounded-full border border-dashed border-them/70" /> Them, hidden until Together
              </span>
            )}
            <span className="ml-auto text-fg-dim">last 20 seconds</span>
          </div>
          <div className="relative min-h-0 flex-1 px-2 pb-2">
            <Waves show={together ? ['you', 'them'] : ['you']} seconds={20} testId="waves" />
          </div>
          {(youTalking || themTalking) && (
            <div role="status" className="pop absolute inset-x-0 bottom-5 mx-auto flex w-fit items-center gap-2 rounded-full bg-overlay px-4 py-2 text-[13px] shadow-pop" data-testid="silent-warning">
              <Icon.Volume size={15} className="text-warn" />
              {youTalking ? 'This part is silent. Breathe without talking; this bit won’t count.' : 'They’re talking. This bit won’t count.'}
            </div>
          )}
          {s.live.you.quality?.hint && !youTalking && (
            <div className="absolute bottom-5 left-5 flex items-center gap-1.5 text-[12px] text-fg-muted">
              <Icon.Info size={13} /> {s.live.you.quality.hint}
            </div>
          )}
        </section>

        <aside className="flex min-h-0 flex-col gap-3">
          {together && (
            <div className="grid place-items-center rounded-[22px] bg-surface/70 px-3 pt-5 pb-3 shadow-panel backdrop-blur">
              <SyncMeter value={s.live.sync} testId="sync-meter" />
              <p className="mt-1 text-center text-[11.5px] leading-relaxed text-fg-dim">{s.live.sync === null ? 'Needs about 30 seconds of quiet breathing from you both.' : 'How steadily your breaths keep the same rhythm, last 30 s.'}</p>
            </div>
          )}
          <div className="grid gap-3 rounded-[22px] bg-surface/70 p-4 shadow-panel backdrop-blur">
            <Person who="you" name="You" bpm={s.live.you.pulse} stable={s.live.you.pulseStable} talking={youTalking} />
            <div className="h-px bg-line" />
            <Person who="them" name="Them" bpm={s.live.partner.pulse} stable={s.live.partner.pulseStable} talking={themTalking} present={s.partner.connected} hiddenWave={!together} />
          </div>
          {!together && (
            <p className="px-2 text-[12px] leading-relaxed text-fg-dim">These two minutes also let the measurement settle before you see each other’s breath.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function Person({ who, name, bpm, stable, talking, present = true, hiddenWave }: { who: 'you' | 'them'; name: string; bpm: number | null; stable: boolean; talking: boolean; present?: boolean; hiddenWave?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[13px] font-medium">
          <span className={cx('size-2 rounded-full', who === 'you' ? 'bg-you' : 'bg-them')} />
          {name}
        </div>
        <div className="mt-0.5 text-[11.5px] text-fg-dim">{!present ? 'reconnecting…' : talking ? 'talking' : hiddenWave ? 'breathing too' : 'breathing'}</div>
      </div>
      <Heart bpm={bpm} stable={stable} who={who} label={`${name} pulse`} />
    </div>
  );
}
