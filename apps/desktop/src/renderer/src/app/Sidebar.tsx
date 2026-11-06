import { useLayoutEffect, useRef, useState } from 'react';
import { useApp, applyTheme, type Route, type Theme } from './store';
import { Icon } from '../ui/icons';
import { cx, Segmented, Status, Tooltip } from '../ui/kit';
import { BrandMark } from '../ui/viz';

const NAV: { id: Route; label: string; icon: (p: { size?: number }) => React.ReactElement; keys: string }[] = [
  { id: 'home', label: 'Home', icon: Icon.Home, keys: '⌘1' },
  { id: 'history', label: 'History', icon: Icon.History, keys: '⌘2' },
  { id: 'diagnostics', label: 'Camera check', icon: Icon.Pulse, keys: '⌘3' },
  { id: 'settings', label: 'Settings', icon: Icon.Settings, keys: '⌘,' },
];

/**
 * A floating card beside the page (after Vercelify's inset sidebar): brand on top, a nav whose active tile
 * slides between items, and at the bottom the theme switch (plus a nudge only when measurement can't run).
 */
export function Sidebar() {
  const { route, go, sessions, config, prefs, setPrefs } = useApp();
  const nav = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ y: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = nav.current?.querySelector<HTMLElement>(`[data-route="${route}"]`);
    if (el) setPill({ y: el.offsetTop, h: el.offsetHeight });
  }, [route]);

  const setTheme = (t: Theme) => {
    setPrefs({ theme: t });
    applyTheme(t);
  };

  return (
    <aside className="flex w-[232px] shrink-0 flex-col rounded-[16px] bg-panel shadow-panel">
      <div className="drag h-10 shrink-0" />
      <div className="drag flex items-center gap-2.5 px-4 pb-5">
        <BrandMark size={30} />
        <div className="min-w-0">
          <div className="text-[15px] leading-tight font-semibold tracking-[-0.02em]">Together</div>
          <div className="text-[11.5px] text-fg-dim">Breathe in step</div>
        </div>
      </div>

      <nav ref={nav} aria-label="Sections" className="relative grid gap-0.5 px-2.5">
        {pill && <span aria-hidden className="absolute right-2.5 left-2.5 rounded-[10px] bg-fg/[0.075] shadow-[0_0_0_0.5px_var(--line-strong)_inset] transition-[transform,height] duration-300 ease-soft" style={{ transform: `translateY(${pill.y}px)`, height: pill.h, top: 0 }} />}
        {NAV.map((n) => {
          const active = n.id === route;
          const count = n.id === 'history' && sessions?.length ? sessions.length : null;
          return (
            <Tooltip key={n.id} content={<span className="flex items-center gap-2">{n.label}<span className="text-fg-dim">{n.keys}</span></span>}>
              <button
                type="button"
                data-route={n.id}
                data-testid={`nav-${n.id}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => go(n.id)}
                className={cx('group relative z-[1] flex h-9 items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13px] transition-colors', active ? 'font-medium text-fg' : 'text-fg-muted hover:text-fg')}
              >
                <span className={cx('transition-colors', active ? 'text-you' : 'text-fg-dim group-hover:text-fg-muted')}>
                  <n.icon size={17} />
                </span>
                <span className="flex-1">{n.label}</span>
                {count !== null && <span className="tnum text-[11px] text-fg-dim">{count}</span>}
              </button>
            </Tooltip>
          );
        })}
      </nav>

      <div className="mt-auto grid gap-3 p-3">
        {config?.e2e ? (
          <div className="px-1"><Status kind="warn">Test signal (automated run)</Status></div>
        ) : config?.peer2 ? (
          <div className="px-1"><Status kind="idle">Replay instance, no camera</Status></div>
        ) : !config?.apiKey ? (
          <button type="button" onClick={() => go('settings')} className="rounded-[10px] px-1 py-1 text-left text-[12px] hover:bg-fg/[0.05]">
            <Status kind="warn">Add an access key</Status>
          </button>
        ) : null}
        <div className="flex justify-center">
          <Segmented<Theme>
            label="Appearance"
            size="sm"
            value={prefs.theme}
            onChange={setTheme}
            options={[
              { value: 'light', label: '', icon: <Icon.Sun /> },
              { value: 'system', label: 'Auto', icon: <Icon.Monitor /> },
              { value: 'dark', label: '', icon: <Icon.Moon /> },
            ]}
          />
        </div>
      </div>
    </aside>
  );
}
