import type { Msg } from '@together/shared';

/** The other person, however they reach us: live over WebRTC, or replayed from a recording. */
export interface Peer {
  readonly kind: 'remote' | 'replay';
  send(msg: Msg): void;
  onMessage(cb: (msg: Msg) => void): () => void;
  close(): void;
}
