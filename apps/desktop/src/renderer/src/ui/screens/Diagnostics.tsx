import { useEffect, type ReactNode } from 'react';
import { PROBLEMS } from '../../app/problems';
import { useApp } from '../../app/store';
import { Probe, useProbe } from '../../diagnostics/probe';
import { Session } from '../../session/controller';
import { useSession } from '../../session/store';
import { Icon } from '../icons';
import { Button, Callout, Card, cx, IconButton, Status, useNow, type StatusKind } from '../kit';
import { Page } from '../Page';
import { VideoTile, Waves } from '../viz';

const fmt = (v: number | null | undefined, d = 1, unit = '') => (v === null || v === undefined || !Number.isFinite(v) ? '–' : `${v.toFixed(d)}${unit}`);

function Row({ k, v, tone }: { k: string; v: ReactNode; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-line py-[7px] first:border-t-0">
      <span className="text-[12px] text-fg-muted">{k}</span>
      <span className={cx('tnum truncate font-mono text-[12px]', tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : 'text-fg')}>{v}</span>
    </div>
  );
}

const probeFeed = () => Probe.current;

/**
 * Camera check: what the measurement sees, in plain words. A session uses exactly this measurement, so a good
 * check here means a good session. Raw SDK values and the lag test sit under "Technical details".
 */
export function Diagnostics() {
  const config = useApp((s) => s.config);
  const p = useProbe();
  useEffect(() => () => Probe.current?.stop(), []);
  if (!config) return null;
  const canMeasure = config.e2e || (!config.peer2 && !!config.apiKey);
  const q = p.quality;
  const settled = p.status === 'running' && q?.code === 0;
  const chk = (state: 'ok' | 'warn' | 'unknown' | undefined): StatusKind => (!p.running ? 'idle' : state === 'ok' ? 'ok' : state === 'warn' ? 'warn' : 'busy');

  return (
    <Page
      title="Camera check"
      subtitle="See what the measurement sees before a session. Nothing leaves this laptop."
      width={1000}
      actions={
        p.running ? (
          <Button onClick={() => Probe.current?.stop()} data-testid="probe-stop">
            Stop
          </Button>
        ) : (
          <Button variant="you" icon={<Icon.Play />} disabled={!canMeasure} onClick={() => void Probe.start(config)} data-testid="probe-start">
            Start camera check
          </Button>
        )
      }
    >
      {!canMeasure && (
        <div className="mb-5">
          <Callout tone="warn" title={config.peer2 ? 'This instance has no camera' : 'Add an access key first'}>
            {config.peer2 ? 'The second dev instance replays a recording instead of measuring.' : 'The camera check runs the same measurement as a session, so it needs your SmartSpectra key (Settings).'}
          </Callout>
        </div>
      )}
      {p.problem && (
        <div className="mb-5">
          <Callout tone="bad" title={PROBLEMS[p.problem.kind].title} testId="probe-problem">
            {PROBLEMS[p.problem.kind].body}
          </Callout>
        </div>
      )}

      <div className="grid grid-cols-[1.35fr_1fr] gap-4">
        <div className="grid content-start gap-4">
          <section className="relative overflow-hidden rounded-[14px] shadow-panel">
            <VideoTile stream={p.stream} mirrored className="aspect-video" placeholder={<span className="text-[12.5px] text-fg-dim">{p.running ? 'Starting camera…' : 'Camera off'}</span>} />
            {p.running && q?.hint && (
              <div className="pop absolute bottom-3 left-3 inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-[12.5px] text-white backdrop-blur" data-testid="probe-hint">
                <Icon.Info size={14} /> {q.hint}
              </div>
            )}
          </section>
          <Card title="Your breathing" description="The chest movement a session uses, live" flush>
            <div className="h-[140px]">{p.running ? <Waves show={['you']} seconds={15} feed={probeFeed} testId="waves" /> : <div className="grid h-full place-items-center text-[12.5px] text-fg-dim">Start the check to see your breathing.</div>}</div>
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card testId="probe-values">
            <div className="grid grid-cols-2 gap-4">
              <Readout label="Breathing" value={p.raw.rate !== null && p.raw.rateStable ? p.raw.rate.toFixed(0) : null} unit="/min" pending={p.running ? 'Settling, ~30 s' : '–'} />
              <Readout label="Heart rate" value={p.raw.pulse !== null && p.raw.pulseStable ? p.raw.pulse.toFixed(0) : null} unit="bpm" pending={p.running ? 'Settling, ~15 s' : '–'} />
            </div>
            <div className="mt-4 grid gap-2 border-t border-line pt-3.5 text-[12.5px]">
              <Status kind={chk(q?.light)}>Light</Status>
              <Status kind={chk(q?.framing)}>Face and upper chest in view</Status>
              <Status kind={chk(q?.stillness)}>Sitting still</Status>
              <Status kind={!p.running ? 'idle' : p.raw.trace !== null ? 'ok' : 'busy'}>Breathing signal</Status>
            </div>
            {p.running && (
              <p className="mt-3.5 text-[12px] text-fg-muted" data-testid="probe-verdict">
                {settled && p.raw.trace !== null ? 'Looks good. A session will measure just like this.' : 'Hold still for a moment while it settles.'}
              </p>
            )}
          </Card>

          <PracticeCard />
        </div>
      </div>

      <details className="group mt-6" data-testid="probe-details">
        <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-[12.5px] text-fg-muted select-none hover:text-fg">
          <Icon.ChevronRight size={14} className="transition-transform group-open:rotate-90" /> Technical details
        </summary>
        <div className="mt-3 grid grid-cols-[1fr_1.2fr] gap-4">
          <Card title="Raw values">
            <Row k="Processing" v={p.stats?.processing ?? '–'} />
            <Row k="Validation code" v={q ? String(q.code) : '–'} tone={q && q.code !== 0 ? 'warn' : undefined} />
            <Row k="Trace samples / s" v={fmt(p.stats?.tracePerSec)} tone={p.stats && p.stats.tracePerSec > 0 && p.stats.tracePerSec < 25 ? 'warn' : undefined} />
            <Row k="Measurement delay" v={p.raw.pipelineMs === null ? '–' : `${Math.max(0, p.raw.pipelineMs)} ms`} />
            <Row k="Breathing confidence" v={fmt(p.raw.rateConf, 0)} />
            <Row k="Pulse confidence" v={fmt(p.raw.pulseConf, 0)} />
            <Row k="Talking" v={p.raw.talking === null ? '–' : p.raw.talking ? 'yes' : 'no'} />
            {p.problem && <Row k="Last error" v={p.problem.detail} tone="bad" />}
          </Card>
          <LagTest />
        </div>
      </details>
    </Page>
  );
}

function Readout({ label, value, unit, pending }: { label: string; value: string | null; unit: string; pending: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium tracking-[0.06em] text-fg-dim uppercase">{label}</div>
      {value !== null ? (
        <div className="mt-1 flex items-baseline gap-1">
          <span className="tnum font-display text-[30px] leading-none font-semibold tracking-[-0.03em]">{value}</span>
          <span className="text-[12px] text-fg-muted">{unit}</span>
        </div>
      ) : (
        <div className="mt-2 text-[13px] text-fg-muted">{pending}</div>
      )}
    </div>
  );
}

/** Keep a minute of your own measured breathing as a partner to practise with (no second person needed). */
function PracticeCard() {
  const p = useProbe();
  const go = useApp((s) => s.go);
  const enough = p.recordedMs >= p.practiceMinMs;
  const pct = Math.min(1, p.recordedMs / p.practiceMinMs);
  return (
    <Card testId="practice-card">
      <div className="text-[13px] font-semibold">Practice partner</div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">Breathe naturally for a minute, then keep it. Home will offer a practice session that breathes alongside this replay, clearly labelled as one.</p>
      {p.save === 'saved' ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <Status kind="ok">Saved</Status>
          <Button size="sm" onClick={() => go('home')} trailing={<Icon.ArrowRight />}>
            Go to practice
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-fg/[0.08]">
            <div className="h-full rounded-full bg-g-duo transition-[width] duration-500" style={{ width: `${pct * 100}%` }} />
          </div>
          <Button size="sm" variant="primary" disabled={!p.running || !enough || p.save === 'saving'} onClick={() => void Probe.current?.saveAsPractice()} data-testid="practice-save">
            {p.save === 'saving' ? 'Saving…' : enough ? 'Keep as partner' : `${Math.floor(p.recordedMs / 1000)} / ${Math.round(p.practiceMinMs / 1000)} s`}
          </Button>
        </div>
      )}
      {p.save === 'failed' && <p className="mt-2 text-[12px] text-bad">Couldn’t save that. Try again.</p>}
    </Card>
  );
}

function LagTest() {
  const p = useProbe();
  const lag = p.lag;
  const running = lag.phase !== 'idle' && lag.phase !== 'done';
  const instruction = lag.phase === 'hold' ? 'Breathe out, then hold still…' : lag.phase === 'beep' ? 'Breathe in now' : lag.phase === 'rest' ? 'Breathe normally' : null;
  return (
    <Card
      title="Lag test"
      description="How long from a tone to your wave moving on screen (your reaction + camera + measurement). Five tries, median."
      testId="lag-test"
      actions={
        running ? (
          <Button size="sm" onClick={() => Probe.current?.cancelLag()}>
            Cancel
          </Button>
        ) : (
          <Button size="sm" variant="primary" disabled={!p.running || p.status !== 'running'} onClick={() => void Probe.current?.lagTest()} data-testid="lag-start">
            {lag.phase === 'done' ? 'Run again' : 'Run lag test'}
          </Button>
        )
      }
    >
      <div className="grid gap-4">
        <div className="min-h-[52px]">
          {running ? (
            <>
              <div className="text-[11px] font-medium tracking-[0.06em] text-fg-dim uppercase">Try {lag.trial} of 5</div>
              <div className={cx('mt-1 text-[16px] font-semibold', lag.phase === 'beep' && 'text-you')}>{instruction}</div>
            </>
          ) : lag.phase === 'done' ? (
            <>
              <div className="text-[11px] font-medium tracking-[0.06em] text-fg-dim uppercase">Median delay</div>
              <div className="tnum mt-1 font-display text-[30px] font-semibold tracking-[-0.03em]" data-testid="lag-median">
                {lag.median === null ? 'No rise seen' : `${lag.median} ms`}
              </div>
            </>
          ) : (
            <div className="text-[12.5px] text-fg-muted">{p.running ? 'Sit still and press Run. Keep breathing quietly between tones.' : 'Start the camera check first.'}</div>
          )}
        </div>
        <div className="flex flex-1 gap-2">
          {[0, 1, 2, 3, 4].map((i) => {
            const r = lag.results[i];
            return (
              <div key={i} className={cx('flex-1 rounded-[10px] border px-3 py-2.5 text-center', i === lag.trial - 1 && running ? 'border-you/50 bg-you/[0.06]' : 'border-line bg-surface-2')}>
                <div className="text-[10.5px] text-fg-dim">#{i + 1}</div>
                <div className="tnum mt-0.5 text-[13px] font-medium">{r === undefined ? '–' : r === null ? 'missed' : `${r} ms`}</div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

/** Session details drawer (during a call): connection, clock and measurement numbers. */
export function LiveDiagnostics({ onClose }: { onClose: () => void }) {
  const live = useSession((s) => s.live);
  const partner = useSession((s) => s.partner);
  useNow(1000);
  const src = Session.current?.sourceStats();
  const peer = Session.current?.peerStats();
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="text-[13px] font-semibold">Session details</div>
        <IconButton label="Close" onClick={onClose}>
          <Icon.X />
        </IconButton>
      </header>
      <div className="scroll flex-1 px-4 py-2">
        <div className="mt-2 mb-1 text-[11px] font-medium tracking-[0.06em] text-fg-dim uppercase">Connection</div>
        <Row k="State" v={live.link} />
        <Row k="Path" v={live.call?.path === 'relay' ? 'via TURN relay' : live.call?.path ? `direct (${live.call.path})` : partner.replay ? 'replay (local)' : '–'} />
        <Row k="Round trip" v={fmt(live.call?.rttMs, 0, ' ms')} />
        <Row k="Video out" v={live.call?.sendSize ? `${live.call.sendSize} @ ${fmt(live.call.sendFps, 0)} fps` : '–'} />
        <Row k="Send / receive" v={`${fmt(live.call?.sendKbps, 0)} / ${fmt(live.call?.recvKbps, 0)} kbps`} />
        <Row k="Clock offset" v={live.clock ? `${(live.clock.offsetUs / 1000).toFixed(1)} ms` : '–'} />
        <Row k="Clock round trip" v={live.clock ? `${(live.clock.rttUs / 1000).toFixed(1)} ms (${live.clock.samples} pings)` : '–'} />
        <Row k="Rejected / dropped msgs" v={peer ? `${peer.rejected} / ${peer.dropped}` : '–'} tone={peer && peer.rejected > 0 ? 'warn' : undefined} />
        <div className="mt-4 mb-1 text-[11px] font-medium tracking-[0.06em] text-fg-dim uppercase">Your measurement</div>
        <Row k="Processing" v={src?.processing ?? '–'} />
        <Row k="Trace samples / s" v={fmt(src?.tracePerSec)} tone={src && src.tracePerSec > 0 && src.tracePerSec < 25 ? 'warn' : undefined} />
        <Row k="Breathing" v={`${fmt(live.you.rate, 1, ' /min')} · conf ${fmt(live.you.rateConf, 0)}`} />
        <Row k="Pulse" v={`${fmt(live.you.pulse, 0, ' bpm')}${live.you.pulseStable ? '' : ' · settling'}`} />
        <Row k="Validation" v={live.you.quality ? String(live.you.quality.code) : '–'} />
        <div className="mt-4 mb-1 text-[11px] font-medium tracking-[0.06em] text-fg-dim uppercase">Their signal</div>
        <Row k="Last frame" v={live.partner.ageMs === null ? '–' : `${Math.round(live.partner.ageMs)} ms ago`} tone={live.partner.ageMs !== null && live.partner.ageMs > 2000 ? 'warn' : undefined} />
        <Row k="Pulse" v={`${fmt(live.partner.pulse, 0, ' bpm')}${live.partner.pulseStable ? '' : ' · settling'}`} />
        <Row k="Live sync (PLV)" v={fmt(live.sync, 3)} />
      </div>
    </div>
  );
}
