import { Session } from '../../session/controller';
import { useSession } from '../../session/store';
import { Icon } from '../icons';
import { Button, cx, Status, type StatusKind } from '../kit';
import { BrandMark, Heart, VideoTile } from '../viz';

/** See yourself, fix the light and framing, and say you're ready. The host starts the call when both are. */
export function Lobby() {
  const s = useSession();
  const q = s.live.you.quality;
  const host = s.ctx.role === 'host' || s.ctx.role === 'practice';
  const youReady = !!s.you.ready.lobby;
  const theyReady = !!s.partner.ready.lobby;
  const row = (state: 'ok' | 'warn' | 'unknown' | undefined): StatusKind => (state === 'ok' ? 'ok' : state === 'warn' ? 'warn' : 'busy');
  const breathing = s.live.you.breathingReady;

  return (
    <div className="mx-auto grid h-full max-w-[1120px] grid-cols-[1fr_320px] gap-5 px-6 pt-2 pb-6">
      <section className="relative min-h-0 overflow-hidden rounded-[22px] shadow-panel">
        <VideoTile stream={s.streams.local} mirrored className="absolute inset-0" testId="self-preview" placeholder={<div className="text-center"><BrandMark size={44} /><div className="mt-3 text-[13px] text-fg-muted">{s.sourceKind === 'replay' ? 'No camera on this instance' : 'Starting your camera…'}</div></div>} />
        {/* Framing guide: where face and chest should sit. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-[28%] top-[12%] bottom-[-6%] rounded-t-[999px] border border-dashed border-white/25" />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent p-4 pt-16">
          {q?.hint && (
            <div className="pop mb-3 inline-flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-[13px] text-white backdrop-blur" data-testid="quality-hint">
              <Icon.Info size={14} /> {q.hint}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5 text-[12px] text-white/90">
            {[
              { label: 'Light', st: row(q?.light) },
              { label: 'Face & chest in view', st: row(q?.framing) },
              { label: 'Still', st: row(q?.stillness) },
              { label: breathing ? 'Breathing measured' : 'Measuring breathing', st: (breathing ? 'ok' : 'busy') as StatusKind },
            ].map((c) => (
              <span key={c.label} className="flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 backdrop-blur [&_span]:text-white/90">
                <Status kind={c.st}>{c.label}</Status>
              </span>
            ))}
          </div>
        </div>
      </section>

      <aside className="flex min-h-0 flex-col gap-3">
        <div className="rounded-[18px] bg-surface p-4 shadow-panel">
          <div className="mb-3 text-[11px] font-medium tracking-[0.07em] text-fg-dim uppercase">Them</div>
          <VideoTile stream={s.streams.remote} className="aspect-video rounded-[12px]" placeholder={<span className="text-[12px] text-fg-dim">{s.partner.replay ? 'Recording: no video' : s.partner.video ? 'Video connecting…' : 'Camera off'}</span>} />
          <div className="mt-3 flex items-center justify-between">
            <Status kind={s.partner.connected ? 'ok' : 'busy'}>{s.partner.connected ? (s.partner.replay ? 'Replay loaded' : 'Connected') : 'Connecting'}</Status>
            <span className={cx('text-[12px]', theyReady ? 'text-ok' : 'text-fg-dim')} data-testid="partner-ready">
              {theyReady ? 'Ready' : 'Getting ready'}
            </span>
          </div>
        </div>

        <div className="rounded-[18px] bg-surface p-4 shadow-panel">
          <div className="mb-3 text-[11px] font-medium tracking-[0.07em] text-fg-dim uppercase">You</div>
          <div className="flex items-center justify-between">
            <Heart bpm={s.live.you.pulse} stable={s.live.you.pulseStable} who="you" label="Your pulse" />
            <span className="text-[12px] text-fg-dim">{s.live.you.pulseStable ? 'steady reading' : 'settling (about 12 s)'}</span>
          </div>
          <ul className="mt-4 grid gap-2 text-[12.5px] text-fg-muted">
            <li className="flex gap-2"><span className="text-fg-dim">·</span>Laptop on a table, not your lap</li>
            <li className="flex gap-2"><span className="text-fg-dim">·</span>Soft, even light on your face; nothing bright behind you</li>
            <li className="flex gap-2"><span className="text-fg-dim">·</span>Sit back so your upper chest is in view</li>
          </ul>
        </div>

        <div className="mt-auto grid gap-2">
          <Button variant={youReady ? 'subtle' : 'you'} size="lg" onClick={() => Session.current?.setReady('lobby', !youReady)} data-testid="ready" icon={youReady ? <Icon.Check /> : undefined}>
            {youReady ? 'You’re ready' : 'I’m ready'}
          </Button>
          {host ? (
            <Button variant="primary" size="lg" disabled={!youReady || !theyReady} onClick={() => Session.current?.startTalking()} data-testid="start-call">
              {youReady && theyReady ? 'Start the call' : 'Start when you’re both ready'}
            </Button>
          ) : (
            <div className="py-2 text-center text-[12.5px] text-fg-dim">{youReady && theyReady ? 'They’ll start the call' : 'The call starts when you’re both ready'}</div>
          )}
        </div>
      </aside>
    </div>
  );
}
