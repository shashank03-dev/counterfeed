import type { ReactNode } from 'react';

export function Page({ title, subtitle, actions, children, width = 880 }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; width?: number }) {
  return (
    <div className="mx-auto px-10 pt-14 pb-16" style={{ maxWidth: width + 80 }}>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-[26px] leading-tight font-semibold tracking-[-0.03em]">{title}</h1>
          {subtitle && <p className="mt-1 max-w-[560px] text-[13.5px] leading-relaxed text-fg-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  );
}
