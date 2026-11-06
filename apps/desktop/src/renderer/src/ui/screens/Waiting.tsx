import { useSession } from '../../session/store';
import { Icon } from '../icons';
import { Button, Status, Sweep, useCopy } from '../kit';
import { BrandMark, VideoTile } from '../viz';

/** Connecting: the host shows the code to send; the guest waits to be seated. The camera warms up meanwhile. */
export function Waiting() {
  const code = useSession((s) => s.code);
  const intent = useSession((s) => s.ctx.intent);
  const role = useSession((s) => s.ctx.role);
  const local = useSession((s) => s.streams.local);
  const status = useSession((s) => s.live.you.status);
  const kind = useSession((s) => s.sourceKind);
  const { copy, done } = useCopy();
  const host = intent?.kind === 'create';

  return (
    <div className="grid h-full place-items-center p-8">
      <div className="w-full max-w-[560px] text-center">
        {host ? (
          code ? (
            <>
              <div className="rise text-[13px] font-medium text-fg-muted">Send this code to the person you’re breathing with</div>
              <button type="button" onClick={() => void copy(code)} className="group rise mx-auto mt-4 flex items-center gap-4 rounded-[20px] bg-surface px-7 py-5 shadow-panel transition-transform hover:-translate-y-0.5" data-testid="room-code" aria-label={`Room code ${code}. Click to copy.`} style={{ ['--i' as string]: 1 }}>
                <span className="font-mono text-[44px] leading-none font-semibold tracking-[0.12em]">
                  {code.split('').map((ch, i) => (
                    <span key={i} className="rise inline-block" style={{ ['--i' as string]: i + 2, color: ch === '-' ? 'var(--fg-dim)' : undefined }}>
                      {ch}
                    </span>
                  ))}
                </span>
                <span className="grid size-9 place-items-center rounded-[10px] bg-fg/[0.06] text-fg-muted transition-colors group-hover:text-fg">{done ? <Icon.Check className="text-ok" /> : <Icon.Copy />}</span>
              </button>
              <div className="rise mt-3 text-[12px] text-fg-dim" style={{ ['--i' as string]: 3 }}>
                {done ? 'Copied' : 'Click to copy'} · the room closes after 10 quiet minutes
              </div>
            </>
          ) : (
            <div className="text-[13px] text-fg-muted">Opening a room…</div>
          )
        ) : (
          <div className="rise">
            <div className="text-[13px] text-fg-muted">Joining</div>
            <div className="mt-2 font-mono text-[34px] font-semibold tracking-[0.1em]">{intent?.kind === 'join' ? intent.code : ''}</div>
          </div>
        )}

        <div className="rise mx-auto mt-10 flex max-w-[400px] items-center gap-4 rounded-[18px] bg-surface/70 p-3 text-left shadow-panel" style={{ ['--i' as string]: 4 }}>
          <VideoTile stream={local} mirrored className="size-[72px] shrink-0 rounded-[14px]" placeholder={<BrandMark size={30} />} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">{role === 'guest' || !host ? 'Connecting to them…' : 'Waiting for them to join'}</div>
            <div className="mt-1 text-[12px]">
              {kind === 'replay' ? (
                <Status kind="idle">No camera on this instance</Status>
              ) : status === 'running' ? (
                <Status kind="ok">Your camera is warming up</Status>
              ) : status === 'error' ? (
                <Status kind="bad">Camera unavailable</Status>
              ) : (
                <Status kind="busy">Starting your camera</Status>
              )}
            </div>
            <Sweep className="mt-3" />
          </div>
        </div>
        <p className="mt-6 text-[12px] text-fg-dim">Nothing is shared until they join and agree too.</p>
        {host && code && (
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => void copy(`Join me on Together: ${code}`)}>
            Copy an invite message
          </Button>
        )}
      </div>
    </div>
  );
}
