import type { Msg } from '@together/shared';
import { Emitter } from '../lib/emitter';
import { nowUs } from '../lib/time';
import type { Peer } from './Peer';
import { RecordingPlayer, type ParsedRecording } from './recording';

/**
 * A partner played back from a recorded session (demo / practice mode), through the same Peer interface
 * as a live partner. It is always labelled as a replay: hello carries `replay.recordedAt`, and the UI shows
 * a permanent "Replayed session" banner. It answers pings on the local clock (offset 0), follows the
 * session's phases by seeking to the matching marks (a recording without marks, such as one saved from the
 * camera check, just plays on), loops when it runs out, and is ready whenever asked.
 */
export class ReplayPeer implements Peer {
  readonly kind = 'replay';
  private ev = new Emitter<{ msg: [Msg] }>();
  private player: RecordingPlayer;
  private closed = false;

  constructor(
    rec: ParsedRecording,
    private readonly now: () => number = nowUs,
  ) {
    this.player = new RecordingPlayer(rec, now, (frames) => this.deliver({ type: 'sig', frames }));
    this.player.loop = true;
  }

  get recordedAt() {
    return this.player.rec.header.recordedAt;
  }
  get ended() {
    return this.player.ended;
  }

  /** Begin playback and introduce itself (async, like a real channel). */
  start() {
    queueMicrotask(() => this.deliver({ type: 'hello', appVersion: this.player.rec.header.appVersion, sharing: { expressions: false }, replay: { recordedAt: this.recordedAt }, video: false }));
    this.player.start();
  }

  private deliver(m: Msg) {
    if (!this.closed) this.ev.emit('msg', m);
  }

  send(msg: Msg) {
    if (this.closed) return;
    switch (msg.type) {
      case 'ping': {
        const t = this.now();
        setTimeout(() => this.deliver({ type: 'pong', id: msg.id, t0: msg.t0, t1: t, t2: t }), 0);
        return;
      }
      case 'phase': {
        // startAt is in the sender's (local) clock, which is also ours.
        this.player.seek(msg.name, msg.startAt + (msg.elapsedMs ?? 0) * 1000);
        if (msg.name === 'moodStart' || msg.name === 'moodEnd' || msg.name === 'lobby') {
          setTimeout(() => this.deliver({ type: 'ready', phase: msg.name, ready: true }), 400);
        }
        return;
      }
      case 'ready':
        if (msg.ready) setTimeout(() => this.deliver({ type: 'ready', phase: msg.phase, ready: true }), 300);
        return;
      default:
        return;
    }
  }

  onMessage(cb: (msg: Msg) => void) {
    return this.ev.on('msg', cb);
  }

  close() {
    this.closed = true;
    this.player.stop();
    this.ev.clear();
  }
}
