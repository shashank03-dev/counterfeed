import type { Relay } from '@together/shared';
import { Emitter } from '../lib/emitter';
import type { SignalingClient } from './SignalingClient';

export type LinkState = 'new' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed';

export interface CallStats {
  rttMs: number | null;
  /** 'host' | 'srflx' | 'relay' - relay means traffic goes through TURN. */
  path: string | null;
  sendKbps: number | null;
  recvKbps: number | null;
  sendFps: number | null;
  sendSize: string | null;
}

type Events = {
  state: [LinkState];
  remoteStream: [MediaStream];
  channel: [RTCDataChannel];
  stats: [CallStats];
} & Record<string, unknown[]>;

/**
 * The call: one RTCPeerConnection, peer to peer, DTLS-SRTP encrypted.
 *  - Video is the SmartSpectra camera stream (the SDK feeds itself from a clone of the same track); audio is
 *    the microphone. Media is never recorded or saved.
 *  - The "signals" data channel is pre-negotiated (id 0, ordered) so both sides create it symmetrically and it
 *    survives renegotiation.
 *  - The host is always the offerer (including ICE restarts); the guest only answers. With a pre-negotiated
 *    data channel the guest would otherwise fire its own offer at start-up, and the two offers collide.
 *  - ICE restarts on failure; outgoing video is capped (~480p, 24 fps, 900 kbps) to leave CPU for measurement.
 */
export class PeerSession extends Emitter<Events> {
  readonly pc: RTCPeerConnection;
  readonly channel: RTCDataChannel;
  private video: RTCRtpTransceiver | null = null;
  private audio: RTCRtpTransceiver | null = null;
  private localVideo: MediaStreamTrack | null = null;
  private localAudio: MediaStreamTrack | null = null;
  private videoOn = true;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private lastBytes: { t: number; sent: number; recv: number } | null = null;
  private state: LinkState = 'new';
  private remote = new MediaStream();
  private unsub: () => void;

  constructor(
    private readonly signaling: SignalingClient,
    iceServers: RTCIceServer[],
    private readonly polite: boolean,
  ) {
    super();
    this.pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' });
    this.channel = this.pc.createDataChannel('signals', { negotiated: true, id: 0, ordered: true });
    this.channel.onopen = () => this.setState('connected');

    if (!polite) {
      // The host owns the media lines; the guest attaches its tracks to them when the offer arrives.
      this.video = this.pc.addTransceiver('video', { direction: 'sendrecv' });
      this.audio = this.pc.addTransceiver('audio', { direction: 'sendrecv' });
    }

    this.pc.onnegotiationneeded = async () => {
      if (this.polite) return; // the guest never offers
      try {
        await this.pc.setLocalDescription();
        this.signaling.send({ type: 'offer', sdp: this.pc.localDescription!.sdp });
      } catch {
        /* superseded by a newer negotiation */
      }
    };
    this.pc.onicecandidate = ({ candidate }) => {
      const c = candidate?.toJSON();
      this.signaling.send({ type: 'ice', candidate: c ? { candidate: c.candidate ?? '', sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null, usernameFragment: c.usernameFragment ?? null } : null });
    };
    this.pc.ontrack = (e) => {
      if (!this.remote.getTracks().includes(e.track)) this.remote.addTrack(e.track);
      this.emit('remoteStream', this.remote);
    };
    this.pc.onconnectionstatechange = () => this.onConnState();
    this.pc.oniceconnectionstatechange = () => this.onConnState();
    this.unsub = this.signaling.on('relay', (m) => void this.onRelay(m));
    this.statsTimer = setInterval(() => void this.pollStats(), 2000);
  }

  private setState(s: LinkState) {
    if (this.state === s || this.state === 'closed') return;
    this.state = s;
    this.emit('state', s);
  }

  private onConnState() {
    const cs = this.pc.connectionState;
    if (cs === 'connected' && this.channel.readyState === 'open') {
      if (this.restartTimer) clearTimeout(this.restartTimer);
      this.restartTimer = null;
      this.setState('connected');
    } else if (cs === 'connecting' && this.state === 'new') this.setState('connecting');
    else if (cs === 'disconnected') {
      this.setState('reconnecting');
      // Often recovers by itself; if not within 3 s, restart ICE.
      if (!this.restartTimer) this.restartTimer = setTimeout(() => this.restartIce(), 3000);
    } else if (cs === 'failed') {
      this.setState('reconnecting');
      this.restartIce();
    }
  }

  restartIce() {
    this.restartTimer = null;
    if (this.pc.connectionState === 'closed') return;
    if (!this.polite) this.pc.restartIce();
  }

  /** ICE never connected (e.g. strict NAT without TURN). */
  get failedForGood() {
    return this.pc.iceConnectionState === 'failed';
  }

  private async onRelay(m: Relay) {
    try {
      if (m.type === 'offer') {
        // Only the guest accepts offers. The host is the sole offerer, so there is no glare to resolve.
        if (!this.polite) return;
        await this.pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
        if (!this.video) this.adoptTransceivers();
        await this.pc.setLocalDescription();
        this.signaling.send({ type: 'answer', sdp: this.pc.localDescription!.sdp });
      } else if (m.type === 'answer') {
        if (this.polite || this.pc.signalingState !== 'have-local-offer') return;
        await this.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
      } else if (m.type === 'ice') {
        // Candidates from a superseded ICE generation (after a restart) are expected to fail: ignore them.
        await this.pc.addIceCandidate(m.candidate ?? undefined).catch(() => {});
      }
    } catch (err) {
      console.warn('[together] negotiation step failed', (err as Error).message);
    }
  }

  /** Guest: take the host's audio/video transceivers and send on them. */
  private adoptTransceivers() {
    for (const t of this.pc.getTransceivers()) {
      const kind = t.receiver.track.kind;
      if (kind === 'video' && !this.video) this.video = t;
      if (kind === 'audio' && !this.audio) this.audio = t;
      t.direction = 'sendrecv';
    }
    void this.applyTracks();
  }

  setLocalVideo(track: MediaStreamTrack | null) {
    this.localVideo = track;
    void this.applyTracks();
  }
  setLocalAudio(track: MediaStreamTrack | null) {
    this.localAudio = track;
    void this.applyTracks();
  }
  /** Stop/start sending video to the partner without touching the camera (the SDK still needs it). */
  setVideoEnabled(on: boolean) {
    this.videoOn = on;
    void this.applyTracks();
  }

  private async applyTracks() {
    try {
      if (this.video) {
        const want = this.videoOn ? this.localVideo : null;
        if (this.video.sender.track !== want) await this.video.sender.replaceTrack(want);
        await this.capVideo();
      }
      if (this.audio && this.audio.sender.track !== this.localAudio) await this.audio.sender.replaceTrack(this.localAudio);
    } catch (err) {
      console.warn('[together] could not attach media', (err as Error).message);
    }
  }

  /** Lighter outgoing video: the camera runs at 720p30 for measurement, the call doesn't need all of it. */
  private async capVideo() {
    const sender = this.video?.sender;
    if (!sender?.track) return;
    const params = sender.getParameters();
    if (!params.encodings?.length) return;
    const enc = params.encodings[0]!;
    if (enc.maxBitrate === 900_000) return;
    enc.maxBitrate = 900_000;
    enc.maxFramerate = 24;
    enc.scaleResolutionDownBy = (sender.track.getSettings().height ?? 720) > 480 ? (sender.track.getSettings().height ?? 720) / 480 : 1;
    params.degradationPreference = 'maintain-framerate';
    try {
      await sender.setParameters(params);
    } catch {
      /* some encoders reject the change before negotiation completes; retried on the next track change */
    }
  }

  private async pollStats() {
    if (this.pc.connectionState !== 'connected') return;
    const report = await this.pc.getStats();
    let rtt: number | null = null;
    let path: string | null = null;
    let sent = 0;
    let recv = 0;
    let fps: number | null = null;
    let size: string | null = null;
    const byId = new Map<string, RTCStats & Record<string, unknown>>();
    report.forEach((s) => byId.set(s.id, s as RTCStats & Record<string, unknown>));
    report.forEach((raw) => {
      const s = raw as RTCStats & Record<string, unknown>;
      if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') {
        rtt = typeof s.currentRoundTripTime === 'number' ? Math.round(s.currentRoundTripTime * 1000) : null;
        const local = byId.get(s.localCandidateId as string);
        path = (local?.candidateType as string) ?? null;
      }
      if (s.type === 'outbound-rtp') {
        sent += (s.bytesSent as number) ?? 0;
        if (s.kind === 'video') {
          fps = (s.framesPerSecond as number) ?? null;
          if (s.frameWidth) size = `${s.frameWidth}x${s.frameHeight}`;
        }
      }
      if (s.type === 'inbound-rtp') recv += (s.bytesReceived as number) ?? 0;
    });
    const now = performance.now();
    let sendKbps: number | null = null;
    let recvKbps: number | null = null;
    if (this.lastBytes) {
      const dt = (now - this.lastBytes.t) / 1000;
      sendKbps = Math.round(((sent - this.lastBytes.sent) * 8) / 1000 / dt);
      recvKbps = Math.round(((recv - this.lastBytes.recv) * 8) / 1000 / dt);
    }
    this.lastBytes = { t: now, sent, recv };
    this.emit('stats', { rttMs: rtt, path, sendKbps, recvKbps, sendFps: fps, sendSize: size });
  }

  close() {
    this.unsub();
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.setState('closed');
    try {
      this.channel.close();
    } catch {
      /* already closed */
    }
    this.pc.getSenders().forEach((s) => void s.replaceTrack(null).catch(() => {}));
    this.pc.close();
    this.remote.getTracks().forEach((t) => t.stop());
    this.clear();
  }
}
