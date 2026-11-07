import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { shortcutsBin } from '../../src/main/config';
import { Dnd, FOCUS_SHORTCUTS, missingShortcuts, parseAsn, parseFrontApp, scriptedFrontApp } from '../../src/main/mac';

describe('front app (lsappinfo)', () => {
  it('accepts only an ASN from `lsappinfo front`', () => {
    expect(parseAsn('ASN:0x0-0x57c07bb:\n')).toBe('ASN:0x0-0x57c07bb:');
    expect(parseAsn('')).toBeNull();
    expect(parseAsn('ASN:0x0-0x1:; rm -rf ~')).toBeNull();
    expect(parseAsn('[ NULL ]')).toBeNull();
  });
  it('reads the name and pid from `lsappinfo info -only name -only pid`', () => {
    const out = '"Zen" ASN:0x0-0x57c07bb: (in front) \n    bundleID=[ NULL ] \n    pid = 56426 !cgsConnection !signalled\n';
    expect(parseFrontApp(out)).toEqual({ name: 'Zen', pid: 56426 });
    expect(parseFrontApp('"Visual Studio Code" ASN:0x0-0x1:\n')).toEqual({ name: 'Visual Studio Code', pid: null });
    expect(parseFrontApp('"My \\"App\\"" ASN:0x0-0x1:\n pid = 7')).toEqual({ name: 'My "App"', pid: 7 });
    expect(parseFrontApp('[ NULL ]  [ NULL ]\n')).toBeNull();
    expect(parseFrontApp('')).toBeNull();
    expect(parseFrontApp(`"${'x'.repeat(200)}"`)!.name).toHaveLength(80);
  });
  it('automated runs get a fixed 20-second cycle of apps', () => {
    expect([0, 10_000, 13_000, 19_000, 21_000].map((t) => scriptedFrontApp(t).name)).toEqual(['Code', 'Safari', 'Code', 'Slack', 'Code']);
  });
});

describe('Do Not Disturb through Shortcuts', () => {
  it('finds the two shortcuts by exact name', () => {
    expect(missingShortcuts('Counterfeed Focus On\nCounterfeed Focus Off\nOther\n')).toEqual([]);
    expect(missingShortcuts('Counterfeed Focus On\n')).toEqual([FOCUS_SHORTCUTS.off]);
    expect(missingShortcuts('counterfeed focus on\nCounterfeed Focus Offline\n')).toEqual([FOCUS_SHORTCUTS.on, FOCUS_SHORTCUTS.off]);
  });
  it('automated runs never use the real Shortcuts tool, and a packaged app always does (on a Mac)', () => {
    const base = { e2e: false, packaged: false, platform: 'darwin', env: {} };
    expect(shortcutsBin(base)).toBe('/usr/bin/shortcuts');
    expect(shortcutsBin({ ...base, packaged: true, env: { COUNTERFEED_SHORTCUTS_BIN: '/tmp/x' } })).toBe('/usr/bin/shortcuts');
    expect(shortcutsBin({ ...base, e2e: true })).toBeNull();
    expect(shortcutsBin({ ...base, e2e: true, env: { COUNTERFEED_SHORTCUTS_BIN: '/tmp/fake' } })).toBe('/tmp/fake');
    expect(shortcutsBin({ ...base, platform: 'win32' })).toBeNull();
  });

  let dir: string;
  let log: string;
  /** A stand-in for /usr/bin/shortcuts: lists the names it's given, logs every run, fails on request. */
  const fake = async (names: string[], failRun = false) => {
    const bin = join(dir, 'shortcuts');
    await writeFile(
      bin,
      `#!/bin/sh\nif [ "$1" = list ]; then printf '${names.join('\\n')}\\n'; exit 0; fi\nif [ "$1" = run ]; then echo "$2" >> '${log}'; exit ${failRun ? 1 : 0}; fi\nexit 2\n`,
    );
    await chmod(bin, 0o755);
    return bin;
  };
  const runs = async () => (existsSync(log) ? (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean) : []);
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'counterfeed-dnd-'));
    log = join(dir, 'runs.log');
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('on, then off, once each; off without on runs nothing', async () => {
    const d = new Dnd(await fake([FOCUS_SHORTCUTS.on, FOCUS_SHORTCUTS.off]), dir);
    expect(await d.check()).toEqual({ ready: true, missing: [] });
    expect(await d.set(false)).toBe(true);
    expect(await runs()).toEqual([]);
    expect(await d.set(true)).toBe(true);
    expect(existsSync(join(dir, 'focus-dnd-on'))).toBe(true);
    expect(await d.set(false)).toBe(true);
    expect(await d.set(false)).toBe(true);
    expect(await runs()).toEqual([FOCUS_SHORTCUTS.on, FOCUS_SHORTCUTS.off]);
    expect(existsSync(join(dir, 'focus-dnd-on'))).toBe(false);
  });
  it('a failed On is reported and never followed by an Off', async () => {
    const d = new Dnd(await fake([FOCUS_SHORTCUTS.on, FOCUS_SHORTCUTS.off], true), dir);
    expect(await d.set(true)).toBe(false);
    await d.set(false);
    d.offSync();
    expect(await runs()).toEqual([FOCUS_SHORTCUTS.on]);
  });
  it('quitting turns it off; a crash is put right at the next launch', async () => {
    const bin = await fake([FOCUS_SHORTCUTS.on, FOCUS_SHORTCUTS.off]);
    const d = new Dnd(bin, dir);
    await d.set(true);
    d.offSync();
    expect(await runs()).toEqual([FOCUS_SHORTCUTS.on, FOCUS_SHORTCUTS.off]);
    expect(existsSync(join(dir, 'focus-dnd-on'))).toBe(false);

    await new Dnd(bin, dir).set(true); // ...and then the app crashed
    expect(existsSync(join(dir, 'focus-dnd-on'))).toBe(true);
    await new Dnd(bin, dir).recover();
    expect(await runs()).toEqual([FOCUS_SHORTCUTS.on, FOCUS_SHORTCUTS.off, FOCUS_SHORTCUTS.on, FOCUS_SHORTCUTS.off]);
    expect(existsSync(join(dir, 'focus-dnd-on'))).toBe(false);
    await new Dnd(bin, dir).recover(); // nothing left to put right
    expect(await runs()).toHaveLength(4);
  });
  it('missing shortcuts, or no tool at all: not ready, and nothing runs', async () => {
    const d = new Dnd(await fake([FOCUS_SHORTCUTS.on]), dir);
    expect(await d.check()).toEqual({ ready: false, missing: [FOCUS_SHORTCUTS.off] });
    const none = new Dnd(null, dir);
    expect((await none.check()).ready).toBe(false);
    expect(await none.set(true)).toBe(false);
    none.offSync();
    await none.recover();
    expect(await runs()).toEqual([]);
  });
});
