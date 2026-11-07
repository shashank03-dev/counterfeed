// Builds the Hook test demo pack: five short vertical clips, generated procedurally by ffmpeg (no stock footage,
// no AI generation, nothing to license). They're only ever shown on screen; the SmartSpectra SDK only sees the
// camera. Each has a different kind of opening, so a hook test has something to rank:
//   Fractal dive  - moving from the first frame          Life          - busy, changing pattern
//   Slow reveal   - black for 4 s, then fades in          Color drift   - calm, slow gradient
//   Test card     - static bars and a clock
//
//   node scripts/make-demo-pack.mjs        (needs ffmpeg; output is committed in resources/demo-pack)
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'demo-pack');
mkdirSync(out, { recursive: true });
const W = 540;
const H = 960;
const enc = (crf) => ['-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-movflags', '+faststart', '-an'];

const clips = [
  // Rendered at half size and scaled up: fractal detail barely compresses. end_pts is in frames.
  { file: 'Fractal dive.mp4', crf: 36, args: ['-f', 'lavfi', '-i', `mandelbrot=size=${W / 2}x${H / 2}:rate=24:maxiter=192:start_scale=3:end_scale=0.02:end_pts=240:inner=mincol,scale=${W}x${H}:flags=bicubic,gblur=sigma=0.7`, '-t', '10'] },
  { file: 'Life.mp4', crf: 34, args: ['-f', 'lavfi', '-i', `life=size=${W / 4}x${H / 4}:rate=15:ratio=0.18:mold=12:life_color=#ffd166:death_color=#ef476f:mold_color=#073b4c,scale=${W}x${H}:flags=neighbor,fps=30`, '-t', '10'] },
  { file: 'Slow reveal.mp4', args: ['-f', 'lavfi', '-i', `gradients=size=${W}x${H}:rate=30:c0=#ff6b35:c1=#1a1a2e:c2=#f7c59f:nb_colors=3:speed=0.02:type=radial,fade=t=in:st=4:d=3`, '-t', '11'] },
  { file: 'Color drift.mp4', args: ['-f', 'lavfi', '-i', `gradients=size=${W}x${H}:rate=30:c0=#2d6a4f:c1=#95d5b2:nb_colors=2:speed=0.008`, '-t', '10'] },
  { file: 'Test card.mp4', args: ['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=30`, '-t', '9'] },
];

for (const c of clips) {
  const dest = join(out, c.file);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...c.args, ...enc(c.crf ?? 30), dest]);
  console.log(`${c.file}  ${(statSync(dest).size / 1024).toFixed(0)} KB`);
}
