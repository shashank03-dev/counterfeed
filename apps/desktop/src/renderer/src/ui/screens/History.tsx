import { useMemo, useState } from 'react';
import type { Report } from '@counterfeed/shared';
import { useApp } from '../../app/store';
import { api } from '../../lib/api';
import { Icon } from '../icons';
import { focusTrend } from '../../analysis/focus';
import { Button, Confirm, Segmented, toast, Tooltip } from '../kit';
import { Page } from '../Page';
import { duration, formatDay, sourceLabel } from '../format';
import { ReportRow } from './Home';

export async function exportAll() {
  const r = await api.exportAll();
  if (r.saved) toast({ title: `Exported ${r.count} ${r.count === 1 ? 'report' : 'reports'}`, body: 'Numbers and your answers only. No pictures.' });
}

export async function openFile() {
  const r = await api.openReportFile();
  if (!r) return;
  if ('error' in r) return toast({ title: 'Couldn’t open that file', body: r.error, tone: 'warn' });
  useApp.setState({ imported: { name: r.name, reports: r.file.reports }, route: 'history' });
  toast({ title: `Opened ${r.file.reports.length} ${r.file.reports.length === 1 ? 'report' : 'reports'}`, body: 'Shown read-only. They aren’t added to your History.' });
}

/** Every report on this Mac, a per-feed comparison, and reports opened from a file. */
export function History() {
  const { reports, refresh, imported } = useApp();
  const [filter, setFilter] = useState<'all' | Report['mode']>('all');
  const [del, setDel] = useState<Report | null>(null);
  const [delAll, setDelAll] = useState(false);
  const list = (reports ?? []).filter((r) => filter === 'all' || r.mode === filter);

  return (
    <Page
      title="History"
      subtitle="Every report stays on this Mac until you delete it. Exports carry numbers and your answers, never pictures."
      actions={
        <>
          <Button size="sm" icon={<Icon.Open />} onClick={() => void openFile()} data-testid="open-file">
            Open a report file
          </Button>
          <Button size="sm" icon={<Icon.Download />} onClick={() => void exportAll()} disabled={!reports?.length} data-testid="export">
            Export
          </Button>
          <Button size="sm" variant="quiet-danger" icon={<Icon.Trash />} onClick={() => setDelAll(true)} disabled={!reports?.length} data-testid="delete-all">
            Delete all
          </Button>
        </>
      }
    >
      {imported && (
        <section className="mb-8" data-testid="imported">
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="text-[11px] font-semibold tracking-[0.07em] text-fg-dim uppercase">Opened from {imported.name}</h2>
            <Button size="sm" variant="ghost" icon={<Icon.X />} onClick={() => useApp.setState({ imported: null })}>
              Close
            </Button>
          </div>
          <div className="grid gap-2">
            {imported.reports.map((r) => (
              <ReportRow key={r.id} r={r} readOnly />
            ))}
          </div>
        </section>
      )}

      {(filter === 'all' || filter === 'feed') && <FeedCompare reports={reports ?? []} />}
      {(filter === 'all' || filter === 'focus') && <FocusTrendPanel reports={reports ?? []} />}

      <div className="mb-3 flex items-center justify-between gap-3">
        <Segmented
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'feed', label: 'Feed checks' },
            { value: 'review', label: 'Reviews' },
            { value: 'hooks', label: 'Hook tests' },
            { value: 'focus', label: 'Focus' },
          ]}
        />
        <span className="tnum text-[12px] text-fg-dim">{list.length} shown</span>
      </div>
      {list.length ? (
        <div className="grid gap-2" data-testid="history-list">
          {list.map((r) => (
            <ReportRow key={r.id} r={r} onDelete={() => setDel(r)} />
          ))}
        </div>
      ) : (
        <div className="rounded-[16px] border border-dashed border-line-strong px-5 py-10 text-center text-[13px] text-fg-muted" data-testid="history-empty">
          No reports yet. Start a feed check, a review, a hook test or a focus session from Home.
        </div>
      )}

      <Confirm
        open={!!del}
        title="Delete this report?"
        body="It’s removed from this Mac, with its pictures. This can’t be undone."
        confirmLabel="Delete"
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return;
          await api.deleteReport(del.id);
          await refresh();
          toast({ title: 'Report deleted' });
        }}
      />
      <Confirm
        open={delAll}
        title="Delete every report?"
        body="All reports and their pictures are removed from this Mac. This can’t be undone."
        confirmLabel="Delete all"
        onClose={() => setDelAll(false)}
        onConfirm={async () => {
          const r = await api.deleteAll();
          await refresh();
          toast({ title: `Deleted ${r.reports} ${r.reports === 1 ? 'report' : 'reports'}` });
        }}
      />
    </Page>
  );
}

/** Your feeds side by side: the average Pull for each thing you've checked at least once. */
function FeedCompare({ reports }: { reports: Report[] }) {
  const rows = useMemo(() => {
    const by = new Map<string, Report[]>();
    for (const r of reports) {
      if (r.mode !== 'feed' || r.pull.score === null) continue;
      const k = sourceLabel(r);
      by.set(k, [...(by.get(k) ?? []), r]);
    }
    return [...by]
      .map(([name, rs]) => {
        // Pauses per minute only over sessions where breathing could be read.
        const read = rs.filter((r) => r.metrics.holds !== null);
        return {
          name,
          n: rs.length,
          pull: Math.round(rs.reduce((s, r) => s + r.pull.score!, 0) / rs.length),
          holds: read.length ? read.reduce((s, r) => s + r.metrics.holds!, 0) / Math.max(1, read.reduce((s, r) => s + r.watchMs, 0) / 60_000) : null,
        };
      })
      .sort((a, b) => b.pull - a.pull);
  }, [reports]);
  if (rows.length < 2) return null;
  return (
    <section className="mb-8 rounded-[18px] bg-surface p-5 shadow-panel" data-testid="feed-compare">
      <h2 className="text-[14px] font-semibold">Your feeds, side by side</h2>
      <p className="mt-0.5 mb-4 text-[12.5px] text-fg-muted">Average Pull for each thing you’ve checked. Only you, against your own normal.</p>
      <div className="grid gap-3">
        {rows.map((r) => (
          <div key={r.name} className="grid items-center gap-x-4 sm:grid-cols-[200px_1fr_150px]">
            <div className="truncate text-[13px] font-medium">{r.name}</div>
            <div className="h-2.5 overflow-hidden rounded-full bg-fg/[0.07]">
              <div className="h-full rounded-full bg-g-meter" style={{ width: `${Math.max(2, r.pull)}%` }} />
            </div>
            <div className="tnum text-right text-[12px] text-fg-muted">
              Pull {r.pull} · {r.holds === null ? '–' : r.holds.toFixed(1)} pauses/min · {r.n}×
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Focus sessions over time: one bar per session (share of the time focused), averages, and your best apps. */
function FocusTrendPanel({ reports }: { reports: Report[] }) {
  const t = useMemo(() => focusTrend(reports), [reports]);
  if (!t) return null;
  const pct = (v: number) => Math.round(v * 100);
  const open = async (id: string) => {
    const report = reports.find((r) => r.id === id);
    if (!report) return;
    const thumbs = await api.readThumbs(id).catch(() => ({}));
    useApp.getState().openReport({ report, thumbs, from: 'history' });
  };
  return (
    <section className="mb-8 rounded-[18px] bg-surface p-5 shadow-panel" data-testid="focus-trend">
      <h2 className="text-[14px] font-semibold">Your focus over time</h2>
      <p className="mt-0.5 mb-4 text-[12.5px] text-fg-muted" data-testid="focus-trend-line">
        Bars: % of each session focused. Last {t.sessions.length} sessions: {pct(t.avgShare)}% focused on average, Focus score {t.avgScore}, longest stretch {duration(t.longestMs)}.
        {t.bestApps.length > 0 && ` You focus best in ${t.bestApps.map((a) => `${a.name} (${pct(a.share)}%)`).join(', ')}.`}
      </p>
      <div className="flex h-[110px] items-end gap-1.5 border-b border-line" role="list" aria-label="Share of each session focused, oldest first">
        {t.sessions.map((s) => (
          <Tooltip key={s.id} content={`${formatDay(s.startedAt)} · ${s.title} · ${pct(s.share)}% focused`}>
            <button
              type="button"
              role="listitem"
              onClick={() => void open(s.id)}
              aria-label={`${formatDay(s.startedAt)}, ${s.title}: ${pct(s.share)}% focused`}
              data-testid="focus-trend-bar"
              className="meter-focus group flex h-full min-w-0 max-w-[44px] flex-1 flex-col justify-end"
            >
              <span className="tnum mb-1 text-center text-[10.5px] text-fg-muted">{pct(s.share)}</span>
              <span className="block w-full rounded-t-[4px] bg-g-meter transition-opacity group-hover:opacity-80" style={{ height: `${Math.max(3, pct(s.share) * 0.8)}%` }} />
            </button>
          </Tooltip>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-fg-dim">
        <span>{formatDay(t.sessions[0]!.startedAt)}</span>
        <span>{formatDay(t.sessions[t.sessions.length - 1]!.startedAt)}</span>
      </div>
    </section>
  );
}
