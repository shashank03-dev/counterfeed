import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/store';
import { PROBLEMS } from '../../app/problems';
import { blinkTimes } from '../../analysis/detect';
import { api } from '../../lib/api';
import { median } from '../../lib/stats';
import { nowUs } from '../../lib/time';
import { CameraSource } from '../../sensing/CameraSource';
import type { Detection, TraceSample } from '../../sensing/normalize';
import { TestSource } from '../../sensing/TestSource';
import type { Quality, SensingProblem, SignalSource } from '../../sensing/types';
import { Icon } from '../icons';
import { Button, Callout, Card, Status } from '../kit';
import { Page } from '../Page';
import { Disclosure } from '../Report';
import { CameraPreview, LiveWave } from '../viz';

interface Readings {
  breathing: number | null;
  pulse: number | null;
  blinks: number;
  smile: number | null;
  hrv: number | null;
  pose: { yaw: number; pitch: number } | null;
}

/** Check the camera before a session (or a demo): framing, light, and live readings. Uses SmartSpectra credits. */
export function CameraCheck() {
  const config = useApp((s) => s.config);
  const [running, setRunning] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [quality, setQuality] = useState<Quality | null>(null);
  const [problem, setProblem] = useState<SensingProblem | null>(null);
  const [read, setRead] = useState<Readings>({ breathing: null, pulse: null, blinks: 0, smile: null, hrv: null, pose: null });
  const [stats, setStats] = useState<ReturnType<SignalSource['stats']> | null>(null);
  const src = useRef<SignalSource | null>(null);
  const trace = useRef<TraceSample[]>([]);
  const blinks = useRef<Detection[]>([]);
  const pulses = useRef<number[]>([]);
  const traceFeed = useCallback(() => trace.current, []);

  const stop = useCallback(async () => {
    const s = src.current;
    src.current = null;
    if (s) {
      await s.stop().catch(() => {});
      s.destroy();
    }
    setRunning(false);
    setStream(null);
  }, []);
  useEffect(() => () => void stop(), [stop]);

  const start = async () => {
    setProblem(null);
    trace.current = [];
    blinks.current = [];
    pulses.current = [];
    setRead({ breathing: null, pulse: null, blinks: 0, smile: null, hrv: null, pose: null });
    if (!config?.e2e) {
      if (!config?.apiKey) return setProblem('no-key');
      let a = await api.mediaAccess('camera');
      if (a === 'not-determined') a = (await api.askCameraAccess()) ? 'granted' : 'denied';
      if (a === 'denied' || a === 'restricted') return setProblem('camera-denied');
    }
    const s: SignalSource = config?.e2e ? new TestSource(3, config.testScenario) : new CameraSource(config!.apiKey!, config!.recordRaw);
    src.current = s;
    s.on('stream', setStream);
    s.on('quality', (q) => setQuality(q));
    s.on('problem', (p) => {
      if (p === 'low-frame-rate') return;
      setProblem(p);
      void stop();
    });
    s.on('metrics', (n) => {
      trace.current.push(...n.trace);
      const cut = nowUs() - 25e6;
      while (trace.current.length && trace.current[0]!.t < cut) trace.current.shift();
      blinks.current.push(...n.blink);
      for (const p of n.pulse) if (p.stable && p.confidence >= 40) pulses.current.push(p.value);
      if (pulses.current.length > 30) pulses.current.splice(0, pulses.current.length - 30);
      setRead((r) => ({
        breathing: n.rate.filter((x) => x.stable).at(-1)?.value ?? r.breathing,
        pulse: pulses.current.length >= 3 ? median(pulses.current) : r.pulse,
        blinks: blinkTimes(blinks.current).length,
        smile: n.expressions.at(-1)?.smile ?? r.smile,
        hrv: n.hrv.filter((h) => h.stable).at(-1)?.rmssd ?? r.hrv,
        pose: n.pose.at(-1) ?? r.pose,
      }));
      setStats(s.stats());
    });
    setRunning(true);
    await s.start();
  };

  const rows = [
    { label: 'Light', v: quality?.light },
    { label: 'In view, facing the screen', v: quality?.framing },
    { label: 'Sitting still', v: quality?.stillness },
    { label: 'Chest in view (for breathing, optional)', v: quality?.breathing },
  ];

  return (
    <Page title="Camera check" subtitle="Make sure the camera can see you well before a session or a demo. This uses SmartSpectra credits while it runs (1 credit per 30 seconds)." width={880}>
      {problem && (
        <div className="mb-4">
          <Callout tone="warn" title={PROBLEMS[problem].title}>
            {PROBLEMS[problem].body}
          </Callout>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-[320px_1fr]">
        <Card flush>
          <CameraPreview stream={stream} className="aspect-[4/3] w-full">
            {config?.e2e && running && !stream && <div className="absolute inset-0 grid place-items-center text-[12px] text-fg-dim">Test signal, no camera</div>}
          </CameraPreview>
          <div className="grid gap-2 p-4 text-[13px]">
            {running ? rows.map((r) => <Status key={r.label} kind={r.v === 'ok' ? 'ok' : r.v === 'warn' ? 'warn' : 'busy'}>{r.label}</Status>) : <Status kind="idle">Camera off</Status>}
            {quality && quality.code !== 0 && <p className="text-[12.5px] text-warn">{quality.hint}</p>}
            <Button className="mt-2" variant={running ? 'subtle' : 'you'} icon={running ? <Icon.Stop /> : <Icon.Camera />} onClick={() => void (running ? stop() : start())} data-testid="camera-toggle">
              {running ? 'Stop camera check' : 'Start camera check'}
            </Button>
          </div>
        </Card>
        <div className="grid content-start gap-4">
          <Card title="Breathing wave" description="Breathe normally; the line should rise and fall. Holding your breath makes it go flat.">
            <div className="h-[90px]">
              <LiveWave seconds={14} source={traceFeed} testId="check-wave" />
            </div>
          </Card>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Reading label="Breathing" value={read.breathing} unit="/ min" note="after ~30 s" />
            <Reading label="Pulse" value={read.pulse} unit="bpm" note="after ~12 s" />
            <Reading label="Blinks" value={running ? read.blinks : null} unit="seen" note="since start" />
            <Reading label="Smile" value={read.smile} unit="%" note="probability" />
          </div>
          <Disclosure title="Technical details">
            <dl className="grid gap-1.5 text-[12.5px]">
              <div className="flex justify-between"><dt className="text-fg-muted">Processing</dt><dd>{stats?.processing ?? '–'}</dd></div>
              <div className="flex justify-between"><dt className="text-fg-muted">Metric updates</dt><dd className="tnum">{stats ? `${stats.metricsPerSec.toFixed(1)} / s` : '–'}</dd></div>
              <div className="flex justify-between"><dt className="text-fg-muted">Head pose (turn / tilt)</dt><dd className="tnum" data-testid="check-pose">{read.pose ? `${read.pose.yaw.toFixed(2)} / ${read.pose.pitch.toFixed(2)}` : '–'}</dd></div>
              <div className="flex justify-between"><dt className="text-fg-muted">Validation code</dt><dd className="tnum">{quality?.code ?? '–'}</dd></div>
              <div className="flex justify-between"><dt className="text-fg-muted">HRV (RMSSD)</dt><dd className="tnum">{read.hrv === null ? 'after ~60 s' : `${read.hrv.toFixed(0)} ms`}</dd></div>
              <div className="flex justify-between"><dt className="text-fg-muted">Telemetry</dt><dd>Off</dd></div>
            </dl>
          </Disclosure>
        </div>
      </div>
    </Page>
  );
}

function Reading({ label, value, unit, note }: { label: string; value: number | null; unit: string; note: string }) {
  return (
    <div className="rounded-[14px] bg-surface px-4 py-3 shadow-panel">
      <div className="text-[12px] text-fg-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="tnum font-display text-[22px] font-semibold tracking-[-0.02em]">{value === null ? '–' : Math.round(value)}</span>
        <span className="text-[11.5px] text-fg-dim">{unit}</span>
      </div>
      <div className="text-[11px] text-fg-dim">{note}</div>
    </div>
  );
}
