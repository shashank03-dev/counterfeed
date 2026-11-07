import { useApp } from '../../app/store';
import { Icon } from '../icons';
import { Button } from '../kit';
import { Report } from '../Report';

/** A saved report (History), or one opened from a file (read-only, labelled). */
export function ReportView() {
  const { open, go } = useApp();
  if (!open) return null;
  return (
    <div className="mx-auto max-w-[1040px] px-10 pt-14 pb-16">
      <div className="mb-4">
        <Button size="sm" variant="ghost" icon={<Icon.ChevronRight className="rotate-180" />} onClick={() => go('history')} data-testid="back">
          History
        </Button>
      </div>
      <Report
        report={open.report}
        thumbs={open.thumbs}
        banner={
          open.from === 'file' ? (
            <div className="rounded-[12px] border border-line bg-surface-2 px-4 py-2.5 text-[12.5px] text-fg-muted" data-testid="file-banner">
              Opened from {open.fileName ?? 'a file'}. Read-only, and without pictures (exports never include them).
            </div>
          ) : undefined
        }
      />
    </div>
  );
}
