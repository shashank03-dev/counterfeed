import { useCallback, useEffect, useRef, useState } from 'react';
import { session } from '../../session/controller';
import { useSession } from '../../session/store';
import { Icon } from '../icons';
import { Button, cx } from '../kit';
import { clock } from '../format';
import { LiveWave } from '../viz';
import { Cue } from './Cue';

/** After a swipe (or a new clip), ignore further swipes this long: trackpad momentum must not skip two clips. */
const SKIP_COOLDOWN_MS = 700;
/** Scroll distance that counts as one swipe. */
const WHEEL_SWIPE = 60;

/**
 * Hook test player: one clip at a time, like a feed. Each clip plays once and the next one starts when it ends;
 * you swipe on (↓, →, scroll, or Next) whenever you would in a real feed. No pause, no seeking, no clip names
 * while watching, so nothing but the clip decides how long you stay. Mounted (hidden) during settle to preload
 * the first clip.
 */
export function ClipFeed() {
  const step = useSession((s) => s.step);
  const plan = useSession((s) => s.plan);
  const clip = useSession((s) => s.clip);
  const elapsed = useSession((s) => s.watch.elapsedMs);
  const ref = useRef<HTMLVideoElement>(null);
  const [pos, setPos] = useState({ t: 0, d: 0 });
  const [muted, setMuted] = useState(false);
  const lastSkip = useRef(0);
  const wheel = useRef({ sum: 0, at: 0 });
  const live = step === 'watch';
  const clips = plan?.clips ?? [];
  const current = clips[clip];

  useEffect(() => {
    session.attachVideo(ref.current);
    return () => session.attachVideo(null);
  }, []);

  // A new clip, or watching starts: play it. (Changing `src` loads it; play() waits for it.)
  const url = current?.url;
  const durMs = current?.durationMs ?? 0;
  useEffect(() => {
    setPos({ t: 0, d: durMs / 1000 });
    if (!live || !url) return;
    lastSkip.current = performance.now();
    void ref.current?.play().catch(() => {});
  }, [live, url, durMs]);

  // Position marks four times a second while playing (the analysis maps every moment to the clip's own time).
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => {
      const v = ref.current;
      if (v && !v.paused && !v.ended && v.readyState >= 3) session.mark(true, v.currentTime * 1000);
    }, 250);
    return () => window.clearInterval(id);
  }, [live]);

  const next = useCallback(() => {
    if (!live) return;
    const now = performance.now();
    if (now - lastSkip.current < SKIP_COOLDOWN_MS) return;
    lastSkip.current = now;
    session.clipEnd('skip');
  }, [live]);

  useEffect(() => {
    if (!live) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === 'j') {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [live, next]);

  const onWheel = (e: React.WheelEvent) => {
    if (!live || e.deltaY <= 0) return;
    const w = wheel.current;
    const now = performance.now();
    if (now - w.at > 300) w.sum = 0;
    w.at = now;
    w.sum += e.deltaY;
    if (w.sum >= WHEEL_SWIPE) {
      w.sum = 0;
      next();
    }
  };

  const markNow = (playing: boolean) => {
    const v = ref.current;
    if (v) session.mark(playing, v.currentTime * 1000);
  };

  return (
    <div className={cx('absolute inset-0 flex', !live && 'pointer-events-none invisible')} data-testid="clip-feed" aria-hidden={!live} onWheel={onWheel}>
      <div className="flex min-h-0 flex-1 items-stretch justify-center gap-8 px-8 pt-3 pb-6">
        {/* The column takes its width from its height (9:16), so the frame never spills over the side panel. */}
        <div className="flex aspect-[9/16] min-h-0 max-w-[calc(100%-282px)] shrink-0 flex-col" data-testid="clip-frame">
          <div className="mb-2.5 flex w-full gap-1" aria-hidden data-testid="clip-progress">
            {clips.map((c, i) => (
              <span key={c.url} className="h-[3px] flex-1 overflow-hidden rounded-full bg-fg/[0.14]">
                <span className="block h-full rounded-full bg-fg/80" style={{ width: `${i < clip ? 100 : i > clip ? 0 : pos.d ? Math.min(100, (pos.t / pos.d) * 100) : 0}%` }} />
              </span>
            ))}
          </div>
          <div className="relative min-h-0 w-full flex-1 overflow-hidden rounded-[22px] bg-black shadow-pop">
            <video
              ref={ref}
              src={current?.url}
              crossOrigin="anonymous"
              playsInline
              preload="auto"
              muted={muted}
              className="h-full w-full object-contain"
              onPlaying={() => {
                session.clipStart(clip);
                markNow(true);
              }}
              onPause={() => markNow(false)}
              onWaiting={() => markNow(false)}
              onSeeked={() => markNow(!ref.current?.paused)}
              onTimeUpdate={() => {
                const v = ref.current;
                if (v) setPos({ t: v.currentTime, d: Number.isFinite(v.duration) ? v.duration : (current?.durationMs ?? 0) / 1000 });
              }}
              onEnded={() => {
                markNow(false);
                session.clipEnd('end');
              }}
              onError={() => session.clipFailed(clip)}
              data-testid="clip-video"
            />
          </div>
        </div>

        <aside className="flex w-[250px] shrink-0 flex-col justify-center gap-4" data-testid="clip-aside">
          <div>
            <div className="text-[11px] font-semibold tracking-[0.07em] text-fg-dim uppercase">Hook test</div>
            <div className="tnum mt-1 font-display text-[22px] font-semibold tracking-[-0.02em]" data-testid="clip-counter">
              Clip {Math.min(clip + 1, clips.length)} of {clips.length}
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">Swipe on whenever you would in a real feed. Each clip plays once.</p>
          </div>
          <Button variant="primary" size="lg" icon={<Icon.Next />} onClick={next} data-testid="next-clip">
            Next clip
          </Button>
          <div className="-mt-2 text-center text-[11.5px] text-fg-dim">or press ↓, or scroll</div>
          <div className="grid gap-2 rounded-[14px] bg-surface p-3 shadow-panel">
            <div className="h-[30px]">
              <LiveWave seconds={12} />
            </div>
            <Cue compact />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button size="sm" variant="ghost" icon={<Icon.Volume />} onClick={() => setMuted((m) => !m)} aria-pressed={muted} data-testid="mute">
              {muted ? 'Sound off' : 'Sound on'}
            </Button>
            <span className="tnum text-[12px] text-fg-dim">{clock(elapsed)}</span>
          </div>
          <Button variant="subtle" icon={<Icon.Stop />} onClick={() => void session.stopWatch('user')} data-testid="stop">
            Finish now
          </Button>
        </aside>
      </div>
    </div>
  );
}
