import { useState } from 'react';
import { describeMoment } from '../../moments/detect';
import { Session } from '../../session/controller';
import { useSession, type OwnMoment } from '../../session/store';
import { mmss } from '../../lib/time';
import { Icon } from '../icons';
import { Button, cx, IconButton, useNow } from '../kit';
import { BrandMark, Heart, VideoTile } from '../viz';

/** Talk freely. Moments (listener reactions) are noticed here, privately. */
export function Call() {
  const s = useSession();
  const [panel, setPanel] = useState(false);
  const now = useNow(1000);
  const host = s.ctx.role === 'host' || s.ctx.role === 'practice';
  const fresh = s.moments.filter((m) => !m.shared).length + s.sharedWithMe.length;

  return (
    <div className="flex h-full gap-3 px-4 pb-4">
      <div className="relative min-w-0 flex-1">
        <VideoTile
          stream={s.streams.remote}
          muted={false}
          className="absolute inset-0 rounded-[22px] shadow-panel"
          testId="partner-video"
          placeholder={
            <div className="text-center">
              <BrandMark size={56} />
              <div className="mt-4 text-[13px] text-fg-muted">{s.partner.replay ? 'A replayed partner has no video. Their breathing is still here.' : s.partner.connected ? 'Their camera is off' : 'Reconnecting…'}</div>
            </div>
          }
        >
          <div className="absolute top-4 left-4 flex items-center gap-2 rounded-full bg-black/45 px-3 py-1.5 text-white backdrop-blur">
            <Heart bpm={s.live.partner.pulse} stable={s.live.partner.pulseStable} who="them" size="sm" label="Their pulse" testId="partner-heart" onMedia />
            {s.live.partner.talking && <span className="text-[11.5px] text-white/75">talking</span>}
          </div>
          <div className="tnum absolute top-4 right-4 rounded-full bg-black/45 px-3 py-1.5 text-[12px] text-white/85 backdrop-blur">{s.callStartedAt ? mmss(now - s.callStartedAt) : '00:00'}</div>
        </VideoTile>

        <VideoTile stream={s.streams.local} mirrored className="absolute right-4 bottom-20 aspect-video w-[220px] rounded-[16px] shadow-pop ring-1 ring-white/10" testId="self-video" placeholder={<span className="text-[11.5px] text-fg-dim">You</span>}>
          <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-black/45 px-2 py-1 text-white backdrop-blur">
            <Heart bpm={s.live.you.pulse} stable={s.live.you.pulseStable} who="you" size="sm" label="Your pulse" onMedia />
          </div>
          {!s.camera && <div className="absolute inset-0 grid place-items-center bg-black/55 text-[11.5px] text-white/80">They can’t see you</div>}
        </VideoTile>

        <div className="absolute inset-x-0 bottom-4 flex justify-center">
          <div className="flex items-center gap-1 rounded-[16px] bg-overlay/90 p-1.5 shadow-pop backdrop-blur-xl">
            <IconButton label={s.mic ? 'Mute microphone' : 'Unmute microphone'} onClick={() => Session.current?.toggleMic()} active={!s.mic} className={cx('size-10', !s.mic && 'text-bad')} data-testid="toggle-mic">
              {s.mic ? <Icon.Mic /> : <Icon.MicOff />}
            </IconButton>
            {s.sourceKind !== 'replay' && (
              <IconButton label={s.camera ? 'Hide my video from them' : 'Show my video to them'} onClick={() => Session.current?.toggleCamera()} active={!s.camera} className={cx('size-10', !s.camera && 'text-bad')} data-testid="toggle-camera">
                {s.camera ? <Icon.Video /> : <Icon.VideoOff />}
              </IconButton>
            )}
            <IconButton label="Moments" onClick={() => setPanel((p) => !p)} active={panel} className="relative size-10" data-testid="toggle-moments">
              <Icon.Sparkle />
              {fresh > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-you" />}
            </IconButton>
            <span className="mx-1.5 h-6 w-px bg-line-strong" />
            {host ? (
              <Button variant="you" size="lg" onClick={() => Session.current?.beginBreathing()} data-testid="begin-breathing" icon={<Icon.Wave />}>
                Begin breathing together
              </Button>
            ) : (
              <span className="px-3 text-[12.5px] text-fg-muted">They’ll start the breathing part when you’re both ready</span>
            )}
          </div>
        </div>
      </div>

      {panel && <MomentsPanel onClose={() => setPanel(false)} />}
    </div>
  );
}

function MomentsPanel({ onClose }: { onClose: () => void }) {
  const moments = useSession((s) => s.moments);
  const shared = useSession((s) => s.sharedWithMe);
  const canShare = useSession((s) => s.you.shareReactions);
  return (
    <aside className="pop flex w-[320px] shrink-0 flex-col overflow-hidden rounded-[22px] bg-surface shadow-panel" aria-label="Moments" data-testid="moments-panel">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <div className="text-[13px] font-semibold">Moments</div>
          <div className="text-[11.5px] text-fg-dim">Only you see these</div>
        </div>
        <IconButton label="Close" onClick={onClose}>
          <Icon.X />
        </IconButton>
      </header>
      <div className="scroll flex-1 p-3">
        {moments.length === 0 && shared.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <Icon.Sparkle size={22} className="mx-auto text-fg-dim" />
            <p className="mt-3 text-[12.5px] leading-relaxed text-fg-muted">When they’re talking and your face lights up (a smile, a surprise), it shows here with what your pulse did next.</p>
            <p className="mt-2 text-[11.5px] text-fg-dim">Based on facial-expression probabilities. It never reads feelings.</p>
          </div>
        ) : (
          <ul className="grid gap-2">
            {moments.map((m, i) => (
              <MomentRow key={m.moment?.id ?? m.pending?.id ?? i} item={m} canShare={canShare} />
            ))}
            {shared.map((m) => (
              <li key={m.id} className="rounded-[12px] border border-them/25 bg-them/[0.06] p-3 text-[12.5px]">
                <div className="mb-1 text-[11px] font-medium text-them">They shared</div>
                {describeMoment(m, 'they')}
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function MomentRow({ item, canShare }: { item: OwnMoment; canShare: boolean }) {
  if (item.pending) {
    const p = item.pending;
    return (
      <li className="rounded-[12px] border border-line bg-surface-2 p-3 text-[12.5px]">
        <div className="flex items-center gap-2">
          <span className="text-you">{p.kind === 'smile' ? '◡' : '!'}</span>
          <span>
            at {mmss(p.atMs)} you {p.kind === 'smile' ? 'smiled' : 'looked surprised'} ({p.peak}%)
          </span>
        </div>
        <div className="mt-1 text-[11.5px] text-fg-dim">Checking your pulse over the next 15 s…</div>
      </li>
    );
  }
  const m = item.moment!;
  return (
    <li className="rounded-[12px] border border-line bg-surface-2 p-3 text-[12.5px]" data-testid="moment">
      <div>{describeMoment(m)}</div>
      <div className="mt-2 flex justify-end">
        {item.shared ? (
          <span className="flex items-center gap-1 text-[11.5px] text-fg-dim">
            <Icon.Check size={12} /> Shared
          </span>
        ) : canShare ? (
          <Button size="sm" variant="ghost" icon={<Icon.Share />} onClick={() => Session.current?.shareMoment(m.id)}>
            Share with them
          </Button>
        ) : (
          <span className="text-[11.5px] text-fg-dim">Sharing is off for this session</span>
        )}
      </div>
    </li>
  );
}
