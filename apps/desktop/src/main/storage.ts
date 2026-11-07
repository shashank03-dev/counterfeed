import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ExportSchema, ReportSchema, ThumbsSchema, type ExportFile, type Report, type Thumbs } from '@counterfeed/shared';

/**
 * Local storage under app.getPath('userData'):
 *   reports/<id>.json         one finished report (numbers and short labels only)
 *   reports/<id>.thumbs.json  small pictures of the screen at the report's moments (never exported)
 * Nothing here leaves the device unless the person exports it. Pure Node (no Electron import), unit-tested.
 */

const ID_RE = /^[a-z0-9-]{8,64}$/;

export class StorageError extends Error {}

function assertId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new StorageError('invalid id');
}

async function atomicWrite(file: string, text: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, text, { mode: 0o600 });
  await rename(tmp, file); // a crash never leaves half a file
}

export class Storage {
  private readonly dir: string;

  constructor(root: string) {
    this.dir = join(root, 'reports');
  }

  async init() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
  }

  async saveReport(input: unknown, thumbsIn: unknown): Promise<void> {
    const rec = ReportSchema.parse(input);
    const thumbs = ThumbsSchema.parse(thumbsIn ?? {});
    // Only thumbnails the report points at are kept.
    const used = new Set([...rec.events.map((e) => e.thumb), ...(rec.clips ?? []).map((c) => c.thumb)].filter(Boolean));
    const kept = Object.fromEntries(Object.entries(thumbs).filter(([k]) => used.has(k)));
    await atomicWrite(join(this.dir, `${rec.id}.thumbs.json`), JSON.stringify(kept));
    await atomicWrite(join(this.dir, `${rec.id}.json`), JSON.stringify(rec));
  }

  async listReports(): Promise<Report[]> {
    const names = (await readdir(this.dir)).filter((n) => n.endsWith('.json') && !n.endsWith('.thumbs.json'));
    const out: Report[] = [];
    for (const n of names) {
      try {
        const r = ReportSchema.safeParse(JSON.parse(await readFile(join(this.dir, n), 'utf8')));
        if (r.success) out.push(r.data);
      } catch {
        /* unreadable file: skip it rather than break History */
      }
    }
    return out.sort((a, b) => b.startedAt - a.startedAt);
  }

  async readThumbs(id: unknown): Promise<Thumbs> {
    assertId(id);
    try {
      const r = ThumbsSchema.safeParse(JSON.parse(await readFile(join(this.dir, `${id}.thumbs.json`), 'utf8')));
      return r.success ? r.data : {};
    } catch {
      return {};
    }
  }

  async deleteReport(id: unknown) {
    assertId(id);
    await rm(join(this.dir, `${id}.json`), { force: true });
    await rm(join(this.dir, `${id}.thumbs.json`), { force: true });
  }

  async deleteAll() {
    const reports = (await readdir(this.dir)).filter((n) => n.endsWith('.json') && !n.endsWith('.thumbs.json')).length;
    await rm(this.dir, { recursive: true, force: true });
    await this.init();
    return { reports };
  }

  /** Everything stored, as one JSON document (what "Export" writes). No pictures. */
  async exportAll(now = new Date()): Promise<ExportFile> {
    return {
      kind: 'counterfeed-export',
      version: 1,
      exportedAt: now.toISOString(),
      note: 'Counterfeed reports: numbers measured on this Mac and your own answers. No video, audio, face data or screen pictures.',
      reports: await this.listReports(),
    };
  }
}

/** Parse an export file someone opened. Returns a reason in plain words when it can't be used. */
export function parseExport(text: string): { file: ExportFile } | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { error: 'That file isn’t a Counterfeed report.' };
  }
  const r = ExportSchema.safeParse(json);
  if (!r.success) return { error: 'That file isn’t a Counterfeed report, or it was changed after export.' };
  if (!r.data.reports.length) return { error: 'That file has no reports in it.' };
  return { file: r.data };
}
