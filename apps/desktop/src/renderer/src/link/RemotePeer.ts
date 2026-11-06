import { parseMsg, type Msg } from '@together/shared';
import { Emitter } from '../lib/emitter';
import type { Peer } from './Peer';

/** Peer over the ordered "signals" data channel. Every incoming message is schema-checked. */
export class RemotePeer implements Peer {
  readonly kind = 'remote';
  private ev = new Emitter<{ msg: [Msg] }>();
  /** Messages rejected by the schema (Diagnostics). */
  rejected = 0;
  /** sig batches skipped because the channel was congested. */
  dropped = 0;

  constructor(private channel: RTCDataChannel) {
    this.attach(channel);
  }

  /** After an ICE restart the channel object can be replaced. */
  attach(channel: RTCDataChannel) {
    this.channel = channel;
    channel.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      const m = parseMsg(e.data);
      if (m) this.ev.emit('msg', m);
      else this.rejected++;
    };
  }

  send(msg: Msg) {
    if (this.channel.readyState !== 'open') return;
    // Live signal batches are worthless late: skip them if the channel is backed up (>256 KB queued).
    if (msg.type === 'sig' && this.channel.bufferedAmount > 256 * 1024) {
      this.dropped++;
      return;
    }
    this.channel.send(JSON.stringify(msg));
  }

  onMessage(cb: (msg: Msg) => void) {
    return this.ev.on('msg', cb);
  }

  close() {
    this.ev.clear();
  }
}
