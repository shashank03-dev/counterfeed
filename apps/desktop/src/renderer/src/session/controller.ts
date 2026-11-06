import type { MoodWord, Msg, PhaseName, PhaseResult, SessionRecord, SignalFrame } from '@together/shared';
import type { AppConfig } from '../../../shared/ipc';
import { PeerSession } from '../call/PeerSession';
import { SignalingClient } from '../call/SignalingClient';
import { api } from '../lib/api';
import { useApp } from '../app/store';
import { Series } from '../lib/series';
import { median } from '../lib/stats';
import { nowUs } from '../lib/time';
import { ClockSync } from '../link/clock';
import type { Peer } from '../link/Peer';
import { parseRecording, type ParsedRecording } from '../link/recording';
import { RemotePeer } from '../link/RemotePeer';
import { ReplayPeer } from '../link/ReplayPeer';
import { MomentDetector } from '../moments/detect';
import { CameraSource } from '../sensing/CameraSource';
import { ReplaySource } from '../sensing/ReplaySource';
import { TestSource } from '../sensing/TestSource';
import type { SignalSource } from '../sensing/types';
import { analyzePhase, liveChance, liveSync, prepare, type PersonSignals, type SyncResult } from '../sync/analyze';
import { estimateRate } from '../sync/rate';
import { bandpassGappy } from '../sync/filter';
import { makeGrid, resample } from '../sync/resample';
import { elapsed, isPhase, ORDER, phaseDuration, reduce, remaining, type Event, type Intent, type State } from './machine';
import { blankSession, useSession, type Problem } from './store';

export const CAP = 30 * 60 * 32; // 30 min of 30 Hz samples per series (~1.8 MB each, preallocated)
const BATCH_MS = 100; // ~10 Hz signal batches
const TICK_MS = 250;
const nowMs = () => nowUs() / 1000;

/** One person's buffered signals. Timestamps are on that person's own clock. */
export class Buffers {
  trace = new Series(CAP);
  talk = new Series(CAP / 4);
  pulse = new Series(CAP / 8);
  lastFrameAt = 0;

  add(frames: SignalFrame[]) {
    for (const f of frames) {
      if (f.trace !== undefined) this.trace.push(f.t, f.trace, f.traceStable ? 1 : 0);
      if (f.talking !== undefined) this.talk.push(f.t, f.talking ? 1 : 0);
      if (f.pulse !== undefined) this.pulse.push(f.t, f.pulse, (f.pulseConf ?? 0) >= 40 ? 1 : 0);
    }
    if (frames.length) this.lastFrameAt = performance.now();
  }

  signals(from: number, to: number): PersonSignals {
    const tr = this.trace.slice(from, to);
    const tk = this.talk.slice(from - 2e6, to);
    return { t: tr.t, v: tr.v, talkT: tk.t, talk: tk.v };
  }

  talkingNow(at: number) {
    if (!this.talk.length) return false;
    const k = this.talk.length - 1;
    return this.talk.vAt(k) === 1 && at - this.talk.tAt(k) < 1.5e6;
  }

  lastStablePulse(): number | null {
    for (let k = this.pulse.length - 1; k >= 0 && k > this.pulse.length - 200; k--) if (this.pulse.fAt(k)) return this.pulse.vAt(k);
    return null;
  }
}

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The live session. Owns every moving part for one call and tears all of it down on end.
 * React reads `useSession` (published at 4 Hz); canvases read the buffers directly via `Session.current`.
 */
export class Session {
  static current: Session | null = null;

  readonly you = new Buffers();
  readonly partner = new Buffers();
  private source: SignalSource | null = null;
  private signaling: SignalingClient | null = null;
  private call: PeerSession | null = null;
  private peer: Peer | null = null;
  private clock: ClockSync | null = null;
  private mic: MediaStream | null = null;
  private outbox: SignalFrame[] = [];
  private recId: string | null = null;
  private recLines: string[] = [];
  private detector: MomentDetector | null = null;
  private spans: Partial<Record<'apart' | 'together', { start: number; end: number | null }>> = {};
  private timers: ReturnType<typeof setInterval>[] = [];
  private unsubs: (() => void)[] = [];
  private lastSyncAt = 0;
  private lastChanceAt = 0;
  private youRate: { value: number; conf: number } | null = null;
  private youPulse: { value: number; stable: boolean } | null = null;
  private startedAt = Date.now();
  private saved = false;
  private disposed = false;
  private clockTimer: ReturnType<typeof setInterval> | null = null;

  private constructor(
    readonly config: AppConfig,
    readonly intent: Intent,
  ) {}

  /* ------------------------------------------------------------------ lifecycle */

  static begin(config: AppConfig, intent: Intent) {
    Session.current?.dispose();
    useSession.setState(blankSession());
    const s = new Session(config, intent);
    Session.current = s;
    // Automated test runs only: let the e2e harness inspect connection state.
    if (config.e2e) (window as unknown as { __together: unknown }).__together = { session: () => Session.current };
    s.dispatch({ type: 'BEGIN', intent, phaseScale: config.phaseScale });
    return s;
  }

  private get st() {
    return useSession.getState();
  }
  private set(p: Partial<ReturnType<typeof useSession.getState>>) {
    if (!this.disposed) useSession.setState(p);
  }
  private get offsetUs() {
    return this.clock?.estimate?.offsetUs ?? 0;
  }
  private get isHost() {
    return this.st.ctx.role === 'host' || this.st.ctx.role === 'practice';
  }

  private dispatch(e: Event) {
    const prev = this.st.ctx;
    const next = reduce(prev, e);
    if (next === prev) return;
    this.set({ ctx: next });
    if (next.state !== prev.state) this.onEnter(next.state, prev.state);
  }

  async consent(accepted: boolean, prefs: { shareReactions: boolean; record: boolean }) {
    this.dispatch({ type: 'CONSENT', accepted });
    if (!accepted) return this.dispose();
    this.set({ you: { ...this.st.you, shareReactions: prefs.shareReactions } });
    this.timers.push(setInterval(() => this.tick(), TICK_MS));
    this.timers.push(setInterval(() => this.flushOutbox(), BATCH_MS));
    try {
      await this.startSource();
      // A replayed source is never re-recorded (a recording of a recording would be passed off as new).
      if (prefs.record && this.source && this.source.kind !== 'replay') await this.startRecording();
      if (this.intent.kind === 'practice') await this.startPractice(this.intent.recordingId);
      else await this.startCall(this.intent);
    } catch (err) {
      console.warn('[together] could not start session', (err as Error).message);
    }
  }

  /* ------------------------------------------------------------------ your signals */

  private async startSource() {
    const cfg = this.config;
    let src: SignalSource;
    if (cfg.peer2) {
      const recs = await api.listRecordings();
      if (!recs[0]) {
        this.set({ problem: 'recording-missing' });
        throw new Error('no recording for peer 2');
      }
      const rs = new ReplaySource(parseRecording(await api.readRecording(recs[0].id)));
      this.set({ selfReplay: { recordedAt: rs.recordedAt } });
      src = rs;
    } else if (cfg.e2e) src = new TestSource(cfg.testSeed, true);
    else src = new CameraSource(cfg.apiKey ?? '');
    this.source = src;
    this.set({ sourceKind: src.kind, camera: src.kind !== 'replay' });

    this.unsubs.push(
      src.on('frames', (frames) => {
        this.you.add(frames);
        for (const f of frames) this.outbox.push(f);
        const tk = frames.findLast((f) => f.talking !== undefined);
        if (tk) this.detector?.setTalking('self', !!tk.talking, true);
      }),
      src.on('rate', (r) => (this.youRate = { value: r.value, conf: r.confidence })),
      src.on('pulse', (p) => {
        this.youPulse = { value: p.value, stable: p.stable };
        this.detector?.pushPulse(p.t, p.value, p.stable);
      }),
      src.on('talking', (t) => this.detector?.setTalking('self', t.detected, t.stable)),
      src.on('expressions', (list) => {
        if (this.st.ctx.state !== 'call' || !this.detector) return;
        for (const e of list) this.detector.pushExpression(e);
      }),
      src.on('quality', (q) => this.set({ live: { ...this.st.live, you: { ...this.st.live.you, quality: q } } })),
      src.on('status', (s) => this.set({ live: { ...this.st.live, you: { ...this.st.live.you, status: s } } })),
      src.on('stream', (stream) => {
        this.set({ streams: { ...this.st.streams, local: stream } });
        this.call?.setLocalVideo(stream?.getVideoTracks()[0] ?? null);
      }),
      src.on('problem', (p) => {
        if (p === 'low-frame-rate') this.set({ notice: 'low-frame-rate' });
        else this.set({ problem: p });
      }),
    );
    await src.start();
  }

  private async startMic() {
    if (this.config.peer2 && !this.config.e2e) return; // peer 2 shares the machine's mic with peer 1: keep it off
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (this.disposed) return mic.getTracks().forEach((t) => t.stop());
      this.mic = mic;
      // The mute switch is the source of truth: if it was pressed while the mic was still opening, honour it.
      const track = mic.getAudioTracks()[0] ?? null;
      if (track) track.enabled = this.st.mic;
      this.call?.setLocalAudio(track);
    } catch {
      this.set({ notice: 'mic-denied', mic: false });
    }
  }

  /* ------------------------------------------------------------------ the other person */

  private async startCall(intent: Intent) {
    const sig = new SignalingClient(this.config.signalUrl);
    this.signaling = sig;
    sig.on('error', (code) => {
      if (this.st.ctx.state === 'connecting' || code === 'unreachable' || code === 'expired') {
        const map: Record<string, Problem> = { unreachable: 'signal-unreachable', 'room-not-found': 'room-not-found', 'room-full': 'room-full', 'rate-limited': 'rate-limited', expired: 'expired' };
        if (map[code] && !isPhase(this.st.ctx.state)) this.set({ problem: map[code] });
      }
    });
    sig.on('room', ({ code, role }) => {
      this.set({ code });
      this.dispatch({ type: 'CONNECTED', role });
      // The guest builds its connection as soon as it is seated; the host waits for the guest (an offer to an
      // empty room would be dropped by the server).
      if (role === 'guest') this.buildCall(false);
    });
    sig.on('peer-joined', () => this.buildCall(true));
    sig.on('peer-away', () => this.peerLost());
    sig.on('peer-back', () => {
      // Signaling is back; media/data recover through ICE restart, handled by PeerSession.
      if (this.isHost) this.call?.restartIce();
    });
    sig.on('relay', (m) => {
      if (m.type === 'leave') this.onBye();
    });
    try {
      if (intent.kind === 'create') await sig.create();
      else if (intent.kind === 'join') await sig.join(intent.code);
    } catch {
      this.set({ problem: 'signal-unreachable' });
    }
  }

  private buildCall(host: boolean) {
    if (this.call) return;
    const call = new PeerSession(this.signaling!, this.config.iceServers, !host);
    this.call = call;
    const local = this.source?.stream?.getVideoTracks()[0] ?? null;
    call.setLocalVideo(local);
    void this.startMic();
    const peer = new RemotePeer(call.channel);
    this.attachPeer(peer);
    call.on('remoteStream', (stream) => this.set({ streams: { ...this.st.streams, remote: stream } }));
    call.on('stats', (s) => this.set({ live: { ...this.st.live, call: s } }));
    call.on('state', (s) => {
      this.set({ live: { ...this.st.live, link: s } });
      if (s === 'reconnecting') this.peerLost();
      if (s === 'failed' && !isPhase(this.st.ctx.state)) this.set({ problem: 'ice-failed' });
    });
    let everOpened = false;
    call.channel.addEventListener('open', () => {
      if (!everOpened) {
        everOpened = true;
        this.onPeerReady();
      } else this.peerBack();
    });
    call.channel.addEventListener('close', () => this.peerLost());
    // ICE that never connects (strict NAT, no TURN) is reported after 20 s.
    setTimeout(() => {
      if (!everOpened && !this.disposed && this.call === call) this.set({ problem: 'ice-failed' });
    }, 20_000);
  }

  private async startPractice(recordingId: string) {
    let rec: ParsedRecording;
    try {
      rec = parseRecording(await api.readRecording(recordingId));
    } catch {
      this.set({ problem: 'recording-missing' });
      return;
    }
    const peer = new ReplayPeer(rec);
    this.attachPeer(peer);
    this.dispatch({ type: 'CONNECTED', role: 'practice' });
    peer.start();
    this.onPeerReady();
  }

  private attachPeer(peer: Peer) {
    this.peer = peer;
    this.clock = new ClockSync((m) => peer.send(m));
    this.unsubs.push(peer.onMessage((m) => this.onMsg(m)));
  }

  private onPeerReady() {
    this.set({ partner: { ...this.st.partner, connected: true } });
    this.peer?.send({
      type: 'hello',
      appVersion: this.config.appVersion,
      sharing: { expressions: this.st.you.shareReactions },
      replay: this.st.selfReplay,
      video: !!this.source?.stream,
    });
    this.dispatch({ type: 'PEER_JOINED' });
    void this.clock?.measure();
    this.clockTimer = setInterval(() => void this.clock?.measure(6, 50), 60_000);
  }

  private peerLost() {
    if (!this.st.partner.connected || this.st.ctx.state === 'ended') return;
    this.set({ partner: { ...this.st.partner, connected: false } });
    this.dispatch({ type: 'PEER_LOST', now: nowMs() });
  }

  private peerBack() {
    if (this.st.partner.connected) return;
    this.set({ partner: { ...this.st.partner, connected: true } });
    this.dispatch({ type: 'PEER_BACK', now: nowMs() });
    void this.clock?.measure(6, 50);
    // The host resumes the paused phase where it left off.
    const c = this.st.ctx;
    if (this.isHost && isPhase(c.state)) this.schedule(c.state, 1500, Math.round(elapsed(c, nowMs())));
  }

  private onBye() {
    this.dispatch({ type: 'END', reason: 'partner-ended', now: nowMs() });
  }

  private onMsg(m: Msg) {
    switch (m.type) {
      case 'ping':
      case 'pong':
        this.clock?.handle(m);
        return;
      case 'hello':
        this.set({ partner: { ...this.st.partner, video: m.video !== false, replay: m.replay ?? null, sharesReactions: m.sharing.expressions } });
        return;
      case 'sig': {
        this.partner.add(m.frames);
        const tk = m.frames.findLast((f) => f.talking !== undefined);
        if (tk) this.detector?.setTalking('partner', !!tk.talking, true);
        return;
      }
      case 'phase': {
        if (this.isHost) return; // only the host decides phases
        const at = (m.startAt - this.offsetUs) / 1000;
        this.dispatch({ type: 'SCHEDULE', name: m.name, at, elapsedMs: m.elapsedMs, durationMs: m.durationMs });
        if (this.source instanceof ReplaySource) this.source.seek(m.name, at * 1000);
        return;
      }
      case 'ready':
        this.set({ partner: { ...this.st.partner, ready: { ...this.st.partner.ready, [m.phase]: m.ready } } });
        return;
      case 'mood':
        this.set({ partner: { ...this.st.partner, moods: { ...this.st.partner.moods, [m.when]: m.label } } });
        return;
      case 'moment':
        if (!this.st.sharedWithMe.some((x) => x.id === m.moment.id)) this.set({ sharedWithMe: [...this.st.sharedWithMe, m.moment] });
        return;
      case 'bye':
        this.onBye();
        return;
    }
  }

  /* ------------------------------------------------------------------ phases */

  /** Host only: switch both sides to `name` after `delayMs`. */
  private schedule(name: PhaseName, delayMs: number, elapsedMs = 0) {
    if (!this.isHost) return;
    const atUs = nowUs() + delayMs * 1000;
    const c = this.st.ctx;
    // The host's length decides; the guest gets the exact duration with the phase change.
    const durationMs = c.durations[name] ?? phaseDuration(name, c.phaseScale, c.length) ?? undefined;
    this.dispatch({ type: 'SCHEDULE', name, at: atUs / 1000, elapsedMs, durationMs });
    this.peer?.send({ type: 'phase', name, startAt: Math.round(atUs), ...(elapsedMs ? { elapsedMs } : {}), ...(durationMs ? { durationMs } : {}) });
    if (this.source instanceof ReplaySource) this.source.seek(name, atUs);
  }

  setReady(phase: PhaseName, ready = true) {
    this.set({ you: { ...this.st.you, ready: { ...this.st.you.ready, [phase]: ready } } });
    this.peer?.send({ type: 'ready', phase, ready });
  }

  /** Host: lobby -> call. */
  startTalking() {
    if (this.st.ctx.state === 'lobby') this.schedule('call', 300);
  }
  /** Host: call -> mood pick -> breathing. */
  beginBreathing() {
    if (this.st.ctx.state === 'call') this.schedule('moodStart', 300);
  }

  pickMood(when: 'start' | 'end', label: MoodWord, share: boolean) {
    this.set({ you: { ...this.st.you, moods: { ...this.st.you.moods, [when]: label }, shareMoods: share } });
    if (share) this.peer?.send({ type: 'mood', when, label });
    this.setReady(when === 'start' ? 'moodStart' : 'moodEnd', true);
  }

  private onEnter(state: State, prev: State) {
    const t = nowUs();
    if (prev === 'apart' || prev === 'together') {
      const span = this.spans[prev];
      if (span && span.end === null) span.end = t;
    }
    if (isPhase(state)) this.mark(state, t);
    switch (state) {
      case 'call':
        this.set({ callStartedAt: t / 1000 });
        this.detector = new MomentDetector(
          t,
          (d) => this.set({ moments: [...this.st.moments, { moment: null, pending: { id: d.id, kind: d.kind, atMs: Math.round((d.t - t) / 1000), peak: d.peak }, shared: false }] }),
          (m) => this.set({ moments: this.st.moments.map((x) => (x.pending?.id === m.id ? { moment: m, pending: null, shared: false } : x)) }),
        );
        for (let k = Math.max(0, this.partner.talk.length - 1); k < this.partner.talk.length; k++) this.detector.setTalking('partner', this.partner.talk.vAt(k) === 1);
        break;
      case 'apart':
      case 'together':
        // Resuming after a reconnect keeps the original start; the gap simply has no partner data.
        this.spans[state] ??= { start: t, end: null };
        this.spans[state]!.end = null;
        break;
      case 'results':
        void this.finish(false);
        break;
      case 'ended':
        void this.finish(true);
        break;
    }
  }

  private tick() {
    const c = this.st.ctx;
    const now = nowMs();
    this.dispatch({ type: 'TICK', now });
    this.detector?.tick(nowUs());

    // Host advances timed and gated phases.
    if (this.isHost && !c.scheduled && c.state !== 'ended') {
      const bothReady = (p: PhaseName) => !!this.st.you.ready[p] && !!this.st.partner.ready[p];
      if (c.state === 'moodStart' && bothReady('moodStart')) this.schedule('apart', 3500);
      else if (c.state === 'apart' && remaining(c, now) === 0) this.schedule('together', 3000);
      else if (c.state === 'together' && remaining(c, now) === 0) this.schedule('moodEnd', 300);
      else if (c.state === 'moodEnd' && bothReady('moodEnd')) this.schedule('results', 300);
    }
    this.publishLive();
  }

  /* ------------------------------------------------------------------ live numbers (4 Hz) */

  private publishLive() {
    const s = this.st;
    const t = nowUs();
    let sync = s.live.sync;
    let chance = s.live.chance;
    if (s.ctx.state === 'together' && performance.now() - this.lastSyncAt > 1000) {
      this.lastSyncAt = performance.now();
      const v = liveSync(this.you.signals(t - 65e6, t), this.partner.signals(t - 65e6 + this.offsetUs, t + this.offsetUs), t, this.offsetUs);
      sync = Number.isFinite(v) ? v : null;
      // Chance moves slowly (it depends on each person's own rhythm), so every 5 s is plenty.
      if (performance.now() - this.lastChanceAt > 5000) {
        this.lastChanceAt = performance.now();
        const ch = liveChance(this.you.signals(t - 95e6, t), this.partner.signals(t - 95e6 + this.offsetUs, t + this.offsetUs), t, this.offsetUs);
        chance = Number.isFinite(ch) ? ch : chance;
      }
    } else if (s.ctx.state !== 'together') {
      sync = null;
      chance = null;
    }
    const pPulse = this.partner.pulse.length ? this.partner.pulse.vAt(this.partner.pulse.length - 1) : null;
    const pStable = this.partner.pulse.length ? this.partner.pulse.fAt(this.partner.pulse.length - 1) === 1 : false;
    const stats = this.source?.stats();
    this.set({
      live: {
        ...s.live,
        sync,
        chance,
        clock: this.clock?.estimate ?? null,
        you: {
          ...s.live.you,
          pulse: this.youPulse?.value ?? null,
          pulseStable: !!this.youPulse?.stable,
          rate: this.youRate?.value ?? null,
          rateConf: this.youRate?.conf ?? 0,
          talking: this.you.talkingNow(t),
          ageMs: stats?.lastMetricAgeMs ?? null,
          breathingReady: (this.youRate?.conf ?? 0) > 0 && !!this.youPulse?.stable,
        },
        partner: {
          pulse: pPulse,
          pulseStable: pStable,
          rate: null,
          rateConf: 0,
          talking: this.partner.talkingNow(t + this.offsetUs),
          ageMs: this.partner.lastFrameAt ? performance.now() - this.partner.lastFrameAt : null,
        },
      },
    });
  }

  sourceStats() {
    return this.source?.stats() ?? null;
  }
  peerStats() {
    return this.peer instanceof RemotePeer ? { rejected: this.peer.rejected, dropped: this.peer.dropped } : null;
  }

  /* ------------------------------------------------------------------ outgoing */

  private flushOutbox() {
    if (!this.outbox.length) return;
    const frames = this.outbox.splice(0, 240);
    if (this.st.partner.connected) this.peer?.send({ type: 'sig', frames });
    if (this.recId) {
      this.recLines.push(JSON.stringify({ k: 'sig', frames }));
      if (this.recLines.length >= 20) void this.flushRecording();
    }
  }

  private async startRecording() {
    try {
      this.recId = await api.recordingStart();
      this.set({ recording: true });
    } catch {
      this.recId = null;
    }
  }

  private mark(name: PhaseName, t: number) {
    if (this.recId) this.recLines.push(JSON.stringify({ k: 'phase', name, t: Math.round(t) }));
  }

  private async flushRecording() {
    if (!this.recId || !this.recLines.length) return;
    const lines = this.recLines.splice(0);
    try {
      await api.recordingAppend(this.recId, lines);
    } catch {
      /* disk full or recording too large: stop recording, keep the call */
      this.recId = null;
      this.set({ recording: false });
    }
  }

  /* ------------------------------------------------------------------ controls */

  toggleMic() {
    if (this.st.notice === 'mic-denied') return;
    const on = !this.st.mic;
    const track = this.mic?.getAudioTracks()[0];
    if (track) track.enabled = on;
    this.set({ mic: on });
  }

  toggleCamera() {
    const on = !this.st.camera;
    this.call?.setVideoEnabled(on);
    this.set({ camera: on });
  }

  shareMoment(id: string) {
    const item = this.st.moments.find((m) => m.moment?.id === id);
    if (!item?.moment || item.shared) return;
    this.peer?.send({ type: 'moment', moment: item.moment });
    this.set({ moments: this.st.moments.map((m) => (m.moment?.id === id ? { ...m, shared: true } : m)) });
  }

  end() {
    this.peer?.send({ type: 'bye', reason: 'ended' });
    this.dispatch({ type: 'END', reason: 'you-ended', now: nowMs() });
    if (this.st.ctx.state === 'idle') this.dispose();
  }

  /* ------------------------------------------------------------------ results */

  private analyze(name: 'apart' | 'together'): { res: SyncResult | null; span: { start: number; end: number } | null } {
    const span = this.spans[name];
    if (!span) return { res: null, span: null };
    const end = span.end ?? nowUs();
    const off = this.offsetUs;
    const res = analyzePhase(this.you.signals(span.start - 5e6, end + 5e6), this.partner.signals(span.start - 5e6 + off, end + 5e6 + off), {
      start: span.start,
      end,
      offsetUs: off,
      surrogates: 200,
      seed: Math.round(span.start / 1e6) % 100_000,
    });
    return { res, span: { start: span.start, end } };
  }

  private rate(who: Buffers, offset: number): number | null {
    const span = this.spans.together ?? this.spans.apart;
    if (!span) return null;
    const end = span.end ?? nowUs();
    const s = who.signals(span.start + offset, end + offset);
    const g = makeGrid(span.start, end, 10);
    const x = resample(s.t, s.v, g, 500_000, offset);
    const r = estimateRate(bandpassGappy(x, 10), 10);
    return Number.isFinite(r) ? Math.round(r * 10) / 10 : null;
  }

  private async finish(ended: boolean) {
    if (this.saved) return;
    this.saved = true;
    const c = this.st.ctx;
    const ranBreathing = c.reached.includes('apart') || c.reached.includes('together');
    for (const k of ['apart', 'together'] as const) if (this.spans[k] && this.spans[k]!.end === null) this.spans[k]!.end = nowUs();
    if (ended) await this.teardown();
    if (!ranBreathing) {
      if (ended && !this.st.result) this.set({ result: null });
      return;
    }
    this.set({ analyzing: true });
    // Let the UI paint the transition before the (short) analysis runs.
    await new Promise((r) => setTimeout(r, 30));
    const toResult = (r: SyncResult | null): PhaseResult | null =>
      r && Number.isFinite(r.plv)
        ? {
            plv: clamp01(r.plv),
            windows: r.windows,
            coverage: clamp01(r.coverage),
            chance: { mean: clamp01(r.chance.mean || 0), p95: clamp01(r.chance.p95 || 0), n: r.chance.n },
            ratio: Number.isFinite(r.ratio) ? Math.max(0, r.ratio) : 0,
            percentile: Number.isFinite(r.percentile) ? Math.max(0, Math.min(100, r.percentile)) : 0,
            series: r.series.map(clamp01),
          }
        : null;
    const apart = toResult(this.analyze('apart').res);
    const together = toResult(this.analyze('together').res);
    const partnerPulses: number[] = [];
    for (let k = 0; k < this.partner.pulse.length; k++) if (this.partner.pulse.fAt(k)) partnerPulses.push(this.partner.pulse.vAt(k));
    const youPulses: number[] = [];
    for (let k = 0; k < this.you.pulse.length; k++) if (this.you.pulse.fAt(k)) youPulses.push(this.you.pulse.vAt(k));
    const s = this.st;
    const record: SessionRecord = {
      id: newId('s'),
      version: 1,
      startedAt: this.startedAt,
      endedAt: Date.now(),
      role: c.role ?? 'host',
      replay: s.partner.replay,
      partial: c.state === 'ended' ? c.partial : false,
      lengths: { ...(c.durations.apart ? { apart: c.durations.apart } : {}), ...(c.durations.together ? { together: c.durations.together } : {}) },
      apart,
      together,
      breathingRate: { you: this.rate(this.you, 0), partner: this.rate(this.partner, this.offsetUs) },
      pulse: { you: roundOrNull(median(youPulses)), partner: roundOrNull(median(partnerPulses)) },
      moods: { you: s.you.moods, partner: s.partner.moods },
      moments: s.moments.flatMap((m) => (m.moment ? [m.moment] : [])),
      sharedWithMe: s.sharedWithMe,
    };
    this.set({ result: record, analyzing: false });
    try {
      await api.saveSession(record);
      void useApp.getState().refresh();
    } catch (err) {
      console.warn('[together] could not save session', (err as Error).message);
    }
  }

  /** Stop sensing and every media track; close the link. Safe to call twice. */
  private async teardown() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.flushOutbox();
    await this.flushRecording();
    if (this.recId) {
      const id = this.recId;
      this.recId = null;
      await api.recordingFinish(id).catch(() => null);
      void useApp.getState().refresh();
    }
    this.call?.close();
    this.call = null;
    this.signaling?.close();
    this.signaling = null;
    this.peer?.close();
    this.peer = null;
    this.clock?.dispose();
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    await this.source?.stop().catch(() => {});
    this.source?.destroy();
    this.source = null;
    for (const u of this.unsubs.splice(0)) u();
    this.set({ streams: { local: null, remote: null }, recording: false, partner: { ...this.st.partner, connected: false } });
  }

  /** Leave the session entirely (back to Home). */
  dispose() {
    if (this.disposed) return;
    void this.teardown();
    this.disposed = true;
    if (Session.current === this) Session.current = null;
    useSession.setState(blankSession());
    void useApp.getState().refresh();
  }

  /** For the live waves: the local clock and the partner's offset from it. */
  window() {
    return { now: nowUs(), offsetUs: this.offsetUs };
  }

  static readonly phases = ORDER;
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
const roundOrNull = (x: number) => (Number.isFinite(x) ? Math.round(x) : null);

// Prepare is exported for Diagnostics' raw view.
export { prepare };
