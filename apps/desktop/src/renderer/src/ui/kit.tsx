import { createPortal } from 'react-dom';
import { create } from 'zustand';
import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Icon } from './icons';

export function cx(...c: (string | false | null | undefined | 0)[]) {
  return c.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ buttons */

type Variant = 'primary' | 'you' | 'subtle' | 'ghost' | 'danger' | 'quiet-danger';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-fg text-inverse font-medium hover:bg-fg/90 shadow-[0_1px_0_0_rgb(255_255_255/0.18)_inset,0_6px_16px_-10px_rgb(0_0_0/0.6)] disabled:bg-fg/[0.1] disabled:text-fg-dim disabled:shadow-none',
  you: 'text-white font-medium bg-you-deep bg-g-you-button hover:brightness-[1.07] active:brightness-95 shadow-[0_1px_0_0_rgb(255_255_255/0.2)_inset,0_6px_18px_-10px_var(--you)] disabled:bg-none disabled:bg-fg/[0.1] disabled:text-fg-dim disabled:shadow-none disabled:brightness-100',
  subtle: 'bg-surface-2 text-fg border border-line-strong hover:bg-surface-3',
  ghost: 'text-fg-muted hover:text-fg hover:bg-fg/[0.06]',
  danger: 'bg-bad text-white font-medium hover:brightness-110 shadow-[0_1px_0_0_rgb(255_255_255/0.2)_inset]',
  'quiet-danger': 'text-bad bg-bad/10 border border-bad/25 hover:bg-bad/15',
};

export function Button({
  variant = 'subtle',
  size = 'md',
  icon,
  trailing,
  busy,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode; trailing?: ReactNode; busy?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      className={cx(
        'relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-[10px] transition-[background,color,filter,box-shadow,transform,opacity] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-60',
        size === 'sm' && 'h-7 px-2.5 text-[12px] [&_svg]:size-3.5',
        size === 'md' && 'h-8 px-3 text-[13px] [&_svg]:size-4',
        size === 'lg' && 'h-10 rounded-[12px] px-4 text-[14px] [&_svg]:size-[18px]',
        VARIANT[variant],
        className,
      )}
    >
      {busy && <span className="orbit-ring" />}
      {icon}
      {children}
      {trailing}
    </button>
  );
}

export function IconButton({ label, className, children, active, tone, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; tone?: 'danger' }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        {...rest}
        className={cx(
          'inline-flex size-8 shrink-0 items-center justify-center rounded-[9px] text-fg-muted transition-colors duration-150 hover:bg-fg/[0.07] hover:text-fg disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4',
          active && 'bg-fg/[0.08] text-fg',
          tone === 'danger' && 'text-bad hover:bg-bad/10 hover:text-bad',
          className,
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ tooltip (portal, delayed, never clipped) */

export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactElement<Record<string, unknown>>; side?: 'top' | 'bottom' }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const tip = useRef<HTMLDivElement>(null);
  const hide = () => {
    window.clearTimeout(timer.current);
    setAnchor(null);
    setPos(null);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!anchor || !tip.current) return;
    const t = tip.current.getBoundingClientRect();
    const left = Math.min(window.innerWidth - t.width - 8, Math.max(8, anchor.left + anchor.width / 2 - t.width / 2));
    const above = anchor.top - t.height - 8;
    const below = anchor.bottom + 8;
    setPos({ left, top: side === 'top' ? (above > 8 ? above : below) : below + t.height > window.innerHeight ? above : below });
  }, [anchor, side]);
  const p = children.props as Record<string, ((e: React.SyntheticEvent<HTMLElement>) => void) | undefined>;
  return (
    <>
      {cloneElement(children, {
        onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
          const el = e.currentTarget;
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setAnchor(el.getBoundingClientRect()), 420);
          p.onMouseEnter?.(e);
        },
        onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
          hide();
          p.onMouseLeave?.(e);
        },
        onFocus: (e: React.FocusEvent<HTMLElement>) => {
          if (e.currentTarget.matches(':focus-visible')) setAnchor(e.currentTarget.getBoundingClientRect());
          p.onFocus?.(e);
        },
        onBlur: (e: React.FocusEvent<HTMLElement>) => {
          hide();
          p.onBlur?.(e);
        },
        onClick: (e: React.MouseEvent<HTMLElement>) => {
          hide();
          p.onClick?.(e);
        },
      })}
      {anchor &&
        createPortal(
          <div
            ref={tip}
            role="tooltip"
            className="pointer-events-none fixed z-[90] whitespace-nowrap rounded-[7px] border border-line-strong bg-overlay px-2 py-1 text-[11.5px] text-fg shadow-pop"
            style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}

/* ------------------------------------------------------------------ inputs */

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      spellCheck={false}
      autoComplete="off"
      {...props}
      className={cx(
        'h-9 w-full rounded-[10px] border border-line-strong bg-surface-2 px-3 text-[13px] text-fg outline-none transition-[border,box-shadow] placeholder:text-fg-dim focus:border-fg-dim focus:shadow-[0_0_0_3px_var(--line)]',
        className,
      )}
    />
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className="text-[12px] font-medium text-fg">
        {label}
      </label>
      {children}
      {hint && <div className="text-[11.5px] leading-relaxed text-fg-dim">{hint}</div>}
    </div>
  );
}

/** An on/off switch with a label and one line of explanation. */
export function Switch({ checked, onChange, label, hint, disabled, testId }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean; testId?: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cx('flex items-start justify-between gap-4 py-2', disabled && 'opacity-50')}>
      <span className="min-w-0">
        <span className="block text-[13px] text-fg">{label}</span>
        {hint && <span className="mt-0.5 block text-[12px] leading-relaxed text-fg-dim">{hint}</span>}
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        data-testid={testId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-[20px] w-[34px] shrink-0 rounded-full transition-colors duration-200',
          checked ? 'bg-g-you' : 'bg-fg/[0.14]',
        )}
      >
        <span className={cx('absolute top-[2px] left-[2px] size-4 rounded-full shadow-[0_1px_3px_rgb(0_0_0/0.3)] transition-transform duration-200 ease-soft', checked ? 'translate-x-[14px] bg-white' : 'bg-white')} />
      </button>
    </label>
  );
}

/** A consent line: the whole row is the hit target; the check draws in. */
export function CheckRow({ checked, onChange, title, children, testId }: { checked: boolean; onChange: (v: boolean) => void; title: ReactNode; children?: ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className={cx(
        'group flex w-full items-start gap-3 rounded-[12px] border px-3.5 py-3 text-left transition-colors duration-150',
        checked ? 'border-line-strong bg-surface' : 'border-line bg-surface hover:border-line-strong',
      )}
    >
      <span
        className={cx(
          'mt-[1px] grid size-[18px] shrink-0 place-items-center rounded-[6px] border transition-all duration-200',
          checked ? 'border-transparent bg-g-you text-white shadow-[0_2px_8px_-3px_var(--you)]' : 'border-line-strong bg-surface-2 text-transparent group-hover:border-fg-dim',
        )}
      >
        <Icon.Check size={12} strokeWidth={2.4} />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-fg">{title}</span>
        {children && <span className="mt-0.5 block text-[12.5px] leading-relaxed text-fg-muted">{children}</span>}
      </span>
    </button>
  );
}

/** Segmented control; the thumb slides between options (measured, CSS-transitioned). */
export function Segmented<T extends string>({ value, onChange, options, label, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; icon?: ReactNode }[]; label: string; size?: 'sm' | 'md' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(value)}"]`);
    if (el) setThumb({ x: el.offsetLeft, w: el.offsetWidth });
  }, [value, options.length]);
  return (
    <div ref={ref} role="radiogroup" aria-label={label} className="relative inline-flex rounded-[10px] bg-fg/[0.06] p-[3px]">
      {thumb && (
        <span
          aria-hidden
          className="absolute top-[3px] bottom-[3px] rounded-[8px] bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.18),0_0_0_0.5px_var(--line-strong)] transition-[transform,width] duration-300 ease-soft"
          style={{ transform: `translateX(${thumb.x - 3}px)`, width: thumb.w }}
        />
      )}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          data-value={o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'relative z-[1] inline-flex items-center gap-1.5 rounded-[8px] font-medium transition-colors [&_svg]:size-3.5',
            size === 'sm' ? 'h-6 px-2.5 text-[11.5px]' : 'h-7 px-3 text-[12.5px]',
            o.value === value ? 'text-fg' : 'text-fg-muted hover:text-fg',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ surfaces */

export function Card({ title, description, actions, children, className, flush, testId }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean; testId?: string }) {
  return (
    <section data-testid={testId} className={cx('overflow-hidden rounded-[14px] bg-surface shadow-panel', className)}>
      {(title || actions) && (
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold tracking-[-0.005em] text-fg">{title}</h2>
            {description && <p className="mt-0.5 text-[12px] text-fg-dim">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={flush ? undefined : 'p-4'}>{children}</div>
    </section>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-3">
      <h3 className="text-[11px] font-semibold tracking-[0.07em] text-fg-dim uppercase">{children}</h3>
      {right}
    </div>
  );
}

export type StatusKind = 'ok' | 'warn' | 'bad' | 'busy' | 'idle';

/** A state as a glyph and words. Success stays quiet; colour is kept for what needs attention. */
export function Status({ kind, children, className }: { kind: StatusKind; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex min-w-0 items-center gap-1.5', kind === 'warn' ? 'text-warn' : kind === 'bad' ? 'text-bad' : kind === 'idle' ? 'text-fg-dim' : 'text-fg-muted', className)}>
      {kind === 'ok' && <Icon.Check size={14} strokeWidth={2.2} className="shrink-0 text-ok" />}
      {kind === 'warn' && <Icon.Warn size={14} className="shrink-0" />}
      {kind === 'bad' && <Icon.X size={14} strokeWidth={2} className="shrink-0" />}
      {kind === 'busy' && <Spinner className="size-3.5" />}
      {kind === 'idle' && <span className="mx-[4px] size-1.5 shrink-0 rounded-full bg-fg-dim" />}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={cx('animate-spin', className ?? 'size-4')} aria-hidden>
      <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
      <path d="M10 2.5a7.5 7.5 0 0 1 7.5 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Indeterminate progress: a soft light sweeping a hairline track. */
export function Sweep({ className }: { className?: string }) {
  return (
    <div className={cx('relative h-[2px] overflow-hidden rounded-full bg-fg/[0.08]', className)}>
      <span className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-fg-muted" style={{ animation: 'sweep 1.6s var(--ease) infinite' }} />
    </div>
  );
}

export function Callout({ tone = 'warn', title, children, action, testId }: { tone?: 'warn' | 'bad' | 'info'; title: ReactNode; children?: ReactNode; action?: ReactNode; testId?: string }) {
  return (
    <div
      data-testid={testId}
      role={tone === 'bad' ? 'alert' : 'status'}
      className={cx(
        'flex items-start gap-3 rounded-[12px] border px-3.5 py-3',
        tone === 'warn' && 'border-warn/25 bg-warn/[0.07]',
        tone === 'bad' && 'border-bad/30 bg-bad/[0.08]',
        tone === 'info' && 'border-line bg-surface-2',
      )}
    >
      <span className={cx('mt-px shrink-0', tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : 'text-fg-muted')}>{tone === 'info' ? <Icon.Info /> : <Icon.Warn />}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-fg">{title}</div>
        {children && <div className="mt-0.5 text-[12.5px] leading-relaxed text-fg-muted">{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ dialog */

export function Dialog({ open, onClose, label, children, width = 460 }: { open: boolean; onClose: () => void; label: string; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('button:not([disabled]),input,[tabindex]:not([tabindex="-1"])')];
        if (!f.length) return;
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[autofocus],[data-autofocus],button')?.focus());
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fade fixed inset-0 z-[70] grid place-items-center p-6">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[3px]" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={label} style={{ width }} className="pop relative max-h-[calc(100vh-48px)] max-w-full overflow-auto rounded-[16px] bg-overlay shadow-pop">
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Confirm({ open, title, body, confirmLabel, onConfirm, onClose, danger = true }: { open: boolean; title: string; body: ReactNode; confirmLabel: string; onConfirm: () => void; onClose: () => void; danger?: boolean }) {
  return (
    <Dialog open={open} onClose={onClose} label={title} width={400}>
      <div className="p-5">
        <div className="text-[15px] font-semibold tracking-[-0.01em]">{title}</div>
        <div className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">{body}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            data-autofocus
            variant={danger ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ toasts */

interface Toast {
  id: number;
  title: string;
  body?: string;
  tone?: 'ok' | 'warn' | 'bad';
}
const useToasts = create<{ items: Toast[] }>(() => ({ items: [] }));
let toastSeq = 0;
export function toast(t: Omit<Toast, 'id'>) {
  const id = ++toastSeq;
  useToasts.setState((s) => ({ items: [...s.items.slice(-2), { ...t, id }] }));
  setTimeout(() => useToasts.setState((s) => ({ items: s.items.filter((x) => x.id !== id) })), 3200);
}

export function Toasts() {
  const items = useToasts((s) => s.items);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[80] grid gap-2" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="pop pointer-events-auto flex min-w-[260px] max-w-[360px] items-start gap-2.5 rounded-[12px] bg-overlay px-3.5 py-3 shadow-pop">
          <span className={cx('mt-px', t.tone === 'warn' ? 'text-warn' : t.tone === 'bad' ? 'text-bad' : 'text-ok')}>{t.tone === 'warn' || t.tone === 'bad' ? <Icon.Warn size={15} /> : <Icon.Check size={15} strokeWidth={2.2} />}</span>
          <div>
            <div className="text-[12.5px] font-medium text-fg">{t.title}</div>
            {t.body && <div className="mt-0.5 text-[12px] text-fg-muted">{t.body}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ hooks */

/** Re-render on an interval (for clocks). Paused while the window is hidden. */
export function useNow(ms = 250) {
  const [now, setNow] = useState(() => performance.timeOrigin + performance.now());
  useEffect(() => {
    let id = 0;
    const start = () => {
      window.clearInterval(id);
      id = window.setInterval(() => setNow(performance.timeOrigin + performance.now()), ms);
    };
    const vis = () => (document.hidden ? window.clearInterval(id) : start());
    start();
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [ms]);
  return now;
}

export function useCopy() {
  const [done, setDone] = useState(false);
  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1400);
    } catch {
      toast({ title: 'Could not copy', tone: 'warn' });
    }
  }, []);
  return { copy, done };
}
