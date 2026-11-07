import { execFile, execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FrontApp } from '../shared/ipc';

/*
 * Focus sessions talk to macOS in two small ways, both without extra permissions:
 *  - Which app is in front, once a second, from LaunchServices (`lsappinfo`). Names only, never window contents.
 *  - Do Not Disturb. macOS gives apps no public switch for Focus, so Counterfeed runs two Shortcuts the person makes
 *    once ("Counterfeed Focus On" / "Off", each one Set Focus action) with the `shortcuts` command line tool.
 * Automated runs never touch either: they get a scripted app sequence and, if the test names one, a stand-in
 * Shortcuts tool (see config.shortcutsBin).
 */

export const FOCUS_SHORTCUTS = { on: 'Counterfeed Focus On', off: 'Counterfeed Focus Off' } as const;

const LSAPPINFO = '/usr/bin/lsappinfo';

/** A minimal environment for the tools (never the app's own, which can hold the access key). */
const toolEnv = () => ({ HOME: process.env.HOME ?? '', PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: process.env.LANG ?? 'en_US.UTF-8' });

function run(bin: string, args: string[], timeout: number): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, maxBuffer: 256 * 1024, env: toolEnv() }, (err, stdout) => resolve({ ok: !err, out: String(stdout ?? '') }));
  });
}

/** `lsappinfo front` prints the front app's ASN ("ASN:0x0-0x57c07bb:"). Anything else is rejected. */
export function parseAsn(out: string): string | null {
  const asn = out.trim();
  return /^ASN:0x[0-9a-f]+-0x[0-9a-f]+:$/i.test(asn) ? asn : null;
}

/** `lsappinfo info -only name -only pid <asn>` -> the app's display name and process id. */
export function parseFrontApp(out: string): { name: string; pid: number | null } | null {
  const first = out.split('\n').find((l) => l.trim());
  const name = first ? /^\s*"((?:[^"\\]|\\.)*)"/.exec(first)?.[1]?.replace(/\\(.)/g, '$1').trim() : undefined;
  if (!name) return null;
  const pid = /\bpid = (\d+)/.exec(out)?.[1];
  return { name: name.slice(0, 80), pid: pid ? Number(pid) : null };
}

/** The app in front right now, or null if it can't be read. `self` marks Counterfeed's own window (the bar). */
export async function frontApp(selfPid: number): Promise<FrontApp | null> {
  if (process.platform !== 'darwin') return null;
  const a = await run(LSAPPINFO, ['front'], 1500);
  const asn = a.ok ? parseAsn(a.out) : null;
  if (!asn) return null;
  const b = await run(LSAPPINFO, ['info', '-only', 'name', '-only', 'pid', asn], 1500);
  const app = b.ok ? parseFrontApp(b.out) : null;
  return app ? { name: app.name, self: app.pid === selfPid } : null;
}

/**
 * Automated runs only: a fixed 20-second cycle of front apps (Code 9 s, Safari 3 s, Code 6 s, Slack 2 s), from the
 * first time a session asks. Deterministic enough to check the per-app table and the switch count.
 */
export function scriptedFrontApp(elapsedMs: number): FrontApp {
  const s = (elapsedMs / 1000) % 20;
  const name = s < 9 ? 'Code' : s < 12 ? 'Safari' : s < 18 ? 'Code' : 'Slack';
  return { name, self: false };
}

/** Which of the two Focus shortcuts are missing, from `shortcuts list` output (one name per line). */
export function missingShortcuts(listOut: string): string[] {
  const names = new Set(listOut.split('\n').map((l) => l.trim()));
  return [FOCUS_SHORTCUTS.on, FOCUS_SHORTCUTS.off].filter((n) => !names.has(n));
}

/**
 * Do Not Disturb through the person's two shortcuts. Remembers when it's on (also in a small file, so a crash or a
 * forced quit is put right at the next launch) and always turns it off again: at the end of a session, on cancel,
 * on any problem, and when Counterfeed quits.
 */
export class Dnd {
  private on = false;
  private readonly marker: string;

  constructor(
    private readonly bin: string | null,
    userData: string,
  ) {
    this.marker = join(userData, 'focus-dnd-on');
  }

  async check(): Promise<{ ready: boolean; missing: string[] }> {
    if (!this.bin) return { ready: false, missing: [FOCUS_SHORTCUTS.on, FOCUS_SHORTCUTS.off] };
    const r = await run(this.bin, ['list'], 8000);
    const missing = r.ok ? missingShortcuts(r.out) : [FOCUS_SHORTCUTS.on, FOCUS_SHORTCUTS.off];
    return { ready: missing.length === 0, missing };
  }

  async set(on: boolean): Promise<boolean> {
    if (!this.bin) return false;
    if (!on) {
      if (!this.on) return true;
      // No longer ours from this moment, so quitting while the shortcut runs doesn't run it twice. The marker stays
      // until it has run: if the app is gone before that, the next launch turns it off.
      this.on = false;
      const off = await run(this.bin, ['run', FOCUS_SHORTCUTS.off], 15_000);
      await rm(this.marker, { force: true }).catch(() => {});
      return off.ok;
    }
    const r = await run(this.bin, ['run', FOCUS_SHORTCUTS.on], 15_000);
    if (r.ok) {
      this.on = true;
      await writeFile(this.marker, String(Date.now()), { mode: 0o600 }).catch(() => {});
    }
    return r.ok;
  }

  /** On quit: turn it off before the process ends (blocking, a few seconds at most). */
  offSync() {
    if (!this.bin || !this.on) return;
    try {
      execFileSync(this.bin, ['run', FOCUS_SHORTCUTS.off], { timeout: 5000, env: toolEnv(), stdio: 'ignore' });
    } catch {
      // Nothing more to do while quitting; the marker stays, so the next launch tries again.
      return;
    }
    this.on = false;
    rmSync(this.marker, { force: true });
  }

  /** At launch: a session that ended without turning Do Not Disturb off (crash, force quit) is put right. */
  async recover() {
    if (!this.bin || !existsSync(this.marker)) return;
    this.on = true;
    await this.set(false);
  }
}
