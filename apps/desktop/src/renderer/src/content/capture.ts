import { Emitter } from '../lib/emitter';
import { nowUs } from '../lib/time';

/**
 * Samples what's on screen while you watch: twice a second a 32x20 greyscale copy (to count big on-screen changes
 * such as swipes, scrolls and cuts) and once a second a small picture, kept in memory so the report can show what
 * was on screen at its moments. Only the pictures the report uses are saved, on this Mac. Nothing is uploaded.
 * The screen picture never goes near the SmartSpectra SDK: the SDK only ever sees the camera.
 */

export type ContentTarget =
  | { kind: 'window' | 'screen'; id: string }
  | { kind: 'test' }
  | { kind: 'video'; el: HTMLVideoElement }
  | { kind: 'none' };

export interface Frame {
  t: number;
  key: string;
  url: string;
}

const MAX_FRAMES = 1900; // a little over 30 minutes at 1 per second
const THUMB_W = 256;

export class ContentCapture {
  private ev = new Emitter<{ ended: [] }>();
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private test: TestContent | null = null;
  private timers: number[] = [];
  private small = document.createElement('canvas');
  private thumb = document.createElement('canvas');
  private prev: Float32Array | null = null;
  private seq = 0;
  readonly diffs: { t: number; d: number }[] = [];
  readonly frames: Frame[] = [];
  private _live = false;

  constructor(private readonly target: ContentTarget) {
    this.small.width = 32;
    this.small.height = 20;
  }

  get live() {
    return this._live;
  }
  on(event: 'ended', fn: () => void) {
    return this.ev.on(event, fn);
  }

  /** Starts sampling. Resolves false when the window can't be captured (the session continues without pictures). */
  async start(): Promise<boolean> {
    const t = this.target;
    try {
      if (t.kind === 'none') return false;
      if (t.kind === 'video') this.video = t.el;
      else {
        this.stream =
          t.kind === 'test'
            ? (this.test = new TestContent()).stream
            : await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: t.id, maxWidth: 1280, maxHeight: 900, maxFrameRate: 4 } } as unknown as MediaTrackConstraints,
              });
        const v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.srcObject = this.stream;
        await v.play();
        this.video = v;
        this.stream.getVideoTracks()[0]?.addEventListener('ended', () => this.end());
      }
    } catch {
      this.stop();
      return false;
    }
    this._live = true;
    this.timers.push(window.setInterval(() => this.sampleDiff(), 500));
    this.timers.push(window.setInterval(() => this.sampleThumb(), 1000));
    this.sampleThumb();
    return true;
  }

  private ready(): HTMLVideoElement | null {
    const v = this.video;
    if (!v || v.readyState < 2 || !v.videoWidth) return null;
    if (this.target.kind === 'video' && (v.paused || v.ended)) return null;
    return v;
  }

  private sampleDiff() {
    const v = this.ready();
    if (!v) return;
    const ctx = this.small.getContext('2d', { willReadFrequently: true })!;
    try {
      ctx.drawImage(v, 0, 0, 32, 20);
      const d = ctx.getImageData(0, 0, 32, 20).data;
      const g = new Float32Array(640);
      for (let i = 0; i < 640; i++) g[i] = (0.299 * d[i * 4]! + 0.587 * d[i * 4 + 1]! + 0.114 * d[i * 4 + 2]!) / 255;
      if (this.prev) {
        let s = 0;
        for (let i = 0; i < 640; i++) s += Math.abs(g[i]! - this.prev[i]!);
        this.diffs.push({ t: nowUs(), d: s / 640 });
        if (this.diffs.length > MAX_FRAMES * 2) this.diffs.shift();
      }
      this.prev = g;
    } catch {
      /* a tainted or not-yet-ready frame: skip */
    }
  }

  private sampleThumb() {
    const v = this.ready();
    if (!v) return;
    const w = THUMB_W;
    const h = Math.max(1, Math.round((v.videoHeight / v.videoWidth) * w));
    this.thumb.width = w;
    this.thumb.height = h;
    try {
      this.thumb.getContext('2d')!.drawImage(v, 0, 0, w, h);
      const url = this.thumb.toDataURL('image/jpeg', 0.62);
      if (!url.startsWith('data:image/jpeg;base64,')) return;
      this.frames.push({ t: nowUs(), key: `t${this.seq++ % 10000}`, url });
      if (this.frames.length > MAX_FRAMES) this.frames.shift();
    } catch {
      /* skip */
    }
  }

  /** The window was closed or sharing stopped: sampling ends, the session goes on. */
  private end() {
    if (!this._live) return;
    this.stop();
    this.ev.emit('ended');
  }

  stop() {
    this._live = false;
    this.timers.forEach((id) => window.clearInterval(id));
    this.timers = [];
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.test?.stop();
    this.test = null;
    if (this.target.kind !== 'video' && this.video) {
      this.video.srcObject = null;
    }
    this.video = null;
  }
}

/**
 * AUTOMATED TESTS ONLY: a stand-in "feed" drawn by the app (cards that swipe every 3 s), labelled as test content.
 * It only exercises the screen-sampling path; it is never shown to the SDK.
 */
class TestContent {
  readonly stream: MediaStream;
  private canvas = document.createElement('canvas');
  private timer: number;
  private n = 0;
  constructor() {
    this.canvas.width = 480;
    this.canvas.height = 300;
    this.draw();
    this.stream = this.canvas.captureStream(8);
    this.timer = window.setInterval(() => {
      this.n++;
      this.draw();
    }, 3000);
  }
  private draw() {
    const c = this.canvas.getContext('2d')!;
    const hue = (this.n * 67) % 360;
    c.fillStyle = `hsl(${hue} 55% 42%)`;
    c.fillRect(0, 0, 480, 300);
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.font = '600 28px system-ui';
    c.fillText(`Test post ${this.n + 1}`, 28, 160);
  }
  stop() {
    window.clearInterval(this.timer);
    this.stream.getTracks().forEach((t) => t.stop());
  }
}
