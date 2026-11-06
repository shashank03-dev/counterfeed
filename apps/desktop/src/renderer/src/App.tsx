import { useEffect } from 'react';
import { useApp } from './app/store';
import { Sidebar } from './app/Sidebar';
import { api } from './lib/api';
import { useSession } from './session/store';
import { Toasts } from './ui/kit';
import { BrandMark } from './ui/viz';
import { Diagnostics } from './ui/screens/Diagnostics';
import { History } from './ui/screens/History';
import { Home } from './ui/screens/Home';
import { Settings } from './ui/screens/Settings';
import { Stage } from './ui/screens/Stage';

export function App() {
  const config = useApp((s) => s.config);
  const route = useApp((s) => s.route);
  const inSession = useSession((s) => s.ctx.state !== 'idle');

  useEffect(() => {
    void api.getConfig().then((c) => useApp.getState().setConfig(c));
    void useApp.getState().refresh();
  }, []);

  // ⌘1-3 and ⌘, between sections (not during a session).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || useSession.getState().ctx.state !== 'idle') return;
      const map: Record<string, Parameters<ReturnType<typeof useApp.getState>['go']>[0]> = { '1': 'home', '2': 'history', '3': 'diagnostics', ',': 'settings' };
      const r = map[e.key];
      if (r) {
        e.preventDefault();
        useApp.getState().go(r);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!config) {
    return (
      <div className="drag grid h-full place-items-center">
        <BrandMark size={44} />
      </div>
    );
  }

  return (
    <>
      {inSession ? (
        <Stage />
      ) : (
        <div className="flex h-full gap-2.5 p-2.5">
          <Sidebar />
          <main className="relative min-w-0 flex-1 overflow-hidden rounded-[16px] bg-panel shadow-panel">
            <div className="drag absolute inset-x-0 top-0 z-10 h-10" />
            <div key={route} className="scroll fade h-full">
              {route === 'home' && <Home />}
              {route === 'history' && <History />}
              {route === 'diagnostics' && <Diagnostics />}
              {route === 'settings' && <Settings />}
            </div>
          </main>
        </div>
      )}
      <Toasts />
    </>
  );
}
