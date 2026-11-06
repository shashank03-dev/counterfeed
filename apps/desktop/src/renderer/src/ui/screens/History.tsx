import { useState } from 'react';
import { useApp } from '../../app/store';
import { api } from '../../lib/api';
import { Icon } from '../icons';
import { Button, Confirm, cx, IconButton, toast } from '../kit';
import { Page } from '../Page';
import { Sparkline } from '../viz';
import { formatDate, verdict } from '../format';
import { Results } from './Results';

export function History() {
  const { sessions, recordings, refresh } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const [wipe, setWipe] = useState(false);
  const [busy, setBusy] = useState(false);
  const selected = sessions?.find((s) => s.id === open) ?? null;

  if (selected) {
    return (
      <div>
        <div className="sticky top-0 z-10 flex items-center gap-2 bg-panel/85 px-6 pt-12 pb-2 backdrop-blur">
          <Button variant="ghost" size="sm" onClick={() => setOpen(null)} icon={<Icon.ChevronRight className="rotate-180" />}>
            All sessions
          </Button>
        </div>
        <Results record={selected} />
      </div>
    );
  }

  const exportAll = async () => {
    setBusy(true);
    try {
      const r = await api.exportAll();
      if (r.saved) toast({ title: 'Exported', body: `${r.count} session${r.count === 1 ? '' : 's'} saved as JSON` });
    } catch {
      toast({ title: 'Export failed', tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };
  const deleteAll = async () => {
    const r = await api.deleteAll();
    await refresh();
    toast({ title: 'Everything deleted', body: `${r.sessions} sessions and ${r.recordings} recordings removed from this laptop` });
  };

  return (
    <Page
      title="History"
      subtitle="Every session you’ve finished, kept only on this laptop."
      actions={
        <>
          <Button icon={<Icon.Download />} onClick={() => void exportAll()} busy={busy} disabled={!sessions?.length} data-testid="export">
            Export JSON
          </Button>
          <Button variant="quiet-danger" icon={<Icon.Trash />} onClick={() => setWipe(true)} disabled={!sessions?.length && !recordings?.length} data-testid="delete-all">
            Delete all
          </Button>
        </>
      }
    >
      {!sessions ? null : sessions.length === 0 ? (
        <div className="rounded-[18px] border border-dashed border-line-strong px-6 py-16 text-center" data-testid="history-empty">
          <Icon.History size={26} className="mx-auto text-fg-dim" />
          <div className="mt-4 text-[15px] font-medium">No sessions yet</div>
          <p className="mx-auto mt-1 max-w-[340px] text-[13px] leading-relaxed text-fg-muted">When you finish a session, its results, the words you picked and your Moments land here. Nothing is uploaded.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[16px] bg-surface shadow-panel" role="list" data-testid="history-list">
          <div className="grid grid-cols-[1.4fr_1.2fr_130px_1fr_36px] gap-4 border-b border-line px-5 py-2.5 text-[11px] font-medium tracking-[0.06em] text-fg-dim uppercase">
            <span>When</span>
            <span>Together</span>
            <span>Over time</span>
            <span>You felt</span>
            <span />
          </div>
          {sessions.map((s, i) => {
            const v = verdict(s.together);
            return (
              <div key={s.id} role="listitem" className={cx('group grid grid-cols-[1.4fr_1.2fr_130px_1fr_36px] items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface-2', i > 0 && 'border-t border-line')}>
                <button type="button" onClick={() => setOpen(s.id)} className="min-w-0 text-left" data-testid="history-row">
                  <div className="truncate text-[13px] font-medium">{formatDate(s.startedAt)}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-fg-dim">
                    {s.replay ? 'Practice with a replay' : s.role === 'host' ? 'You started it' : 'You joined'}
                    {s.partial && <span className="rounded-[5px] bg-fg/[0.07] px-1.5 py-px">ended early</span>}
                  </div>
                </button>
                <div className={cx('text-[13px]', v.strong ? 'font-medium text-fg' : 'text-fg-muted')}>{v.short}</div>
                <Sparkline values={s.together?.series ?? s.apart?.series ?? []} width={120} height={26} />
                <div className="truncate text-[12.5px] text-fg-muted">
                  {s.moods.you.start ?? '–'} → {s.moods.you.end ?? '–'}
                </div>
                <IconButton
                  label="Delete this session"
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={async () => {
                    await api.deleteSession(s.id);
                    await refresh();
                  }}
                >
                  <Icon.Trash />
                </IconButton>
              </div>
            );
          })}
        </div>
      )}

      {!!recordings?.length && (
        <div className="mt-8">
          <h2 className="mb-2.5 text-[11px] font-semibold tracking-[0.07em] text-fg-dim uppercase">Recordings for replay</h2>
          <div className="overflow-hidden rounded-[16px] bg-surface shadow-panel">
            {recordings.map((r, i) => (
              <div key={r.id} className={cx('group flex items-center gap-4 px-5 py-3', i > 0 && 'border-t border-line')}>
                <Icon.Wave className="text-you" />
                <div className="flex-1 text-[13px]">{formatDate(r.recordedAt)}</div>
                <div className="tnum text-[12px] text-fg-dim">
                  {Math.round(r.durationMs / 60000)} min · {(r.bytes / 1024).toFixed(0)} KB · numbers only
                </div>
                <IconButton
                  label="Delete recording"
                  onClick={async () => {
                    await api.deleteRecording(r.id);
                    await refresh();
                  }}
                >
                  <Icon.Trash />
                </IconButton>
              </div>
            ))}
          </div>
        </div>
      )}

      <Confirm
        open={wipe}
        onClose={() => setWipe(false)}
        title="Delete everything?"
        body="All sessions, Moments, moods and recordings are removed from this laptop. This can’t be undone; export first if you want a copy."
        confirmLabel="Delete everything"
        onConfirm={() => void deleteAll()}
      />
    </Page>
  );
}
