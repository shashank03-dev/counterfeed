import { useSession } from '../../session/store';
import { Icon } from '../icons';
import { cx } from '../kit';

/** The live cue: what your body is doing right now, in a few words. */
export function Cue({ compact }: { compact?: boolean }) {
  const cue = useSession((s) => s.watch.cue);
  const tone = cue.kind === 'hold' ? 'text-ev-hold' : cue.kind === 'noblink' ? 'text-ev-stare' : cue.kind === 'face' ? 'text-warn' : cue.kind === 'focus' ? 'text-focus-ink' : 'text-fg-muted';
  return (
    <span className={cx('inline-flex min-w-0 items-center gap-1.5 font-medium', compact ? 'text-[12px]' : 'text-[13px]', tone)} data-testid="cue" role="status" aria-live="polite">
      {cue.kind === 'measuring' ? <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-ok" /> : cue.kind === 'face' ? <Icon.Warn size={13} /> : cue.kind === 'hold' ? <Icon.Wind size={13} /> : cue.kind === 'focus' ? <Icon.Focus size={13} /> : <Icon.Eye size={13} />}
      <span className="truncate">{cue.text}</span>
    </span>
  );
}
