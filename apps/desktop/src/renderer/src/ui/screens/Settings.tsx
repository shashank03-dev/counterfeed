import { useState, type ReactNode } from 'react';
import { applyTheme, useApp, type Theme } from '../../app/store';
import { api } from '../../lib/api';
import { Icon } from '../icons';
import { Button, Callout, Confirm, Field, Segmented, Status, Switch, TextInput, toast, useCopy } from '../kit';
import { Page } from '../Page';

function Section({ title, description, children, id }: { title: string; description?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="grid grid-cols-[220px_1fr] gap-8 border-t border-line py-7 first:border-t-0 first:pt-0">
      <div>
        <h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">{title}</h2>
        {description && <p className="mt-1 text-[12.5px] leading-relaxed text-fg-dim">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function Settings() {
  const { config, setConfig, prefs, setPrefs, refresh, sessions, recordings } = useApp();
  const [key, setKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [signal, setSignal] = useState(config?.signalUrl ?? '');
  const [turn, setTurn] = useState({ url: '', user: '', pass: '' });
  const [wipe, setWipe] = useState(false);
  if (!config) return null;

  const saveKey = async (value: string | null) => {
    setSavingKey(true);
    try {
      setConfig(await api.setApiKey(value));
      setKey('');
      toast({ title: value ? 'Access key saved to your Keychain' : 'Access key removed' });
    } catch (err) {
      toast({ title: 'Couldn’t save the key', body: (err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''), tone: 'bad' });
    } finally {
      setSavingKey(false);
    }
  };
  const saveConnection = async () => {
    try {
      const patch: Record<string, string | null> = { signalUrl: signal.trim() || null };
      if (turn.url || turn.user || turn.pass) Object.assign(patch, { turnUrl: turn.url.trim() || null, turnUser: turn.user.trim() || null, turnPass: turn.pass || null });
      setConfig(await api.saveSettings(patch));
      setTurn({ url: '', user: '', pass: '' });
      toast({ title: 'Connection settings saved' });
    } catch (err) {
      toast({ title: 'Not saved', body: (err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''), tone: 'bad' });
    }
  };

  return (
    <Page title="Settings" subtitle="How Together looks, measures and connects, and what it keeps.">
      <Section title="Appearance">
        <Segmented<Theme>
          label="Theme"
          value={prefs.theme}
          onChange={(t) => {
            setPrefs({ theme: t });
            applyTheme(t);
          }}
          options={[
            { value: 'system', label: 'Match system', icon: <Icon.Monitor /> },
            { value: 'light', label: 'Light', icon: <Icon.Sun /> },
            { value: 'dark', label: 'Dark', icon: <Icon.Moon /> },
          ]}
        />
      </Section>

      <Section title="Measurement" description="Breathing and pulse are measured on this laptop by Presage SmartSpectra. The key is checked online when measurement starts.">
        <div className="grid gap-4">
          <div className="flex items-center gap-3 text-[13px]">
            {config.apiKey ? <Status kind="ok">{config.apiKeySource === 'keychain' ? 'Key saved in your Keychain' : 'Key loaded from .env'}</Status> : <Status kind="warn">No access key yet</Status>}
            {config.apiKeySource === 'keychain' && (
              <Button size="sm" variant="ghost" onClick={() => void saveKey(null)}>
                Remove
              </Button>
            )}
          </div>
          <Field label={config.apiKey ? 'Replace access key' : 'Access key'} htmlFor="key" hint={<>From your Presage developer dashboard. Stored encrypted in the macOS Keychain, never logged. <button type="button" className="text-fg underline decoration-line-strong underline-offset-2" onClick={() => void api.openExternal('presage-keys')}>Get a key</button></>}>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (key.trim()) void saveKey(key.trim());
              }}
            >
              <TextInput id="key" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your SmartSpectra key" data-testid="api-key" />
              <Button type="submit" variant="primary" busy={savingKey} disabled={!key.trim() || !config.keychainAvailable}>
                Save
              </Button>
            </form>
          </Field>
        </div>
      </Section>

      <Section title="Connection" description={<>A small relay matches the two of you by room code and passes connection details only. The call itself goes directly between laptops.</>}>
        <div className="grid gap-4">
          <HostStatus />
          <Field label="Connection server" htmlFor="signal" hint="Leave as ws://localhost:8787 on the Mac that hosts. On the other Mac, use the address shown there.">
            <div className="flex gap-2">
              <TextInput id="signal" value={signal} onChange={(e) => setSignal(e.target.value)} placeholder="ws://localhost:8787" data-testid="signal-url" />
              <Button variant="primary" onClick={() => void saveConnection()} disabled={signal.trim() === config.signalUrl && !turn.url && !turn.user && !turn.pass}>
                Save
              </Button>
            </div>
          </Field>
          <details className="group">
            <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-[12.5px] text-fg-muted select-none hover:text-fg">
              <Icon.ChevronRight size={14} className="transition-transform group-open:rotate-90" /> Advanced: TURN relay {config.turnConfigured && <span className="text-fg-dim">· configured</span>}
            </summary>
            <div className="mt-3 rounded-[12px] border border-line p-4">
              <p className="mb-3 text-[12px] leading-relaxed text-fg-dim">Only needed when a network (some offices and hotspots) blocks direct calls. A TURN relay carries the call then; it still can’t read it.</p>
              <div className="grid grid-cols-3 gap-2">
                <TextInput aria-label="TURN address" value={turn.url} onChange={(e) => setTurn({ ...turn, url: e.target.value })} placeholder="turn:turn.example.com:3478" />
                <TextInput aria-label="TURN username" value={turn.user} onChange={(e) => setTurn({ ...turn, user: e.target.value })} placeholder="Username" />
                <TextInput aria-label="TURN password" type="password" value={turn.pass} onChange={(e) => setTurn({ ...turn, pass: e.target.value })} placeholder="Password" />
              </div>
            </div>
          </details>
        </div>
      </Section>

      <Section title="Defaults" description="What the consent screen starts with. You still confirm each session.">
        <Switch checked={prefs.shareReactions} onChange={(v) => setPrefs({ shareReactions: v })} label="Let me share reactions" hint="Lets you send individual Moments to the other person. Never automatic." />
        <Switch checked={prefs.recordSignals} onChange={(v) => setPrefs({ recordSignals: v })} label="Record my signals" hint="Keeps your outgoing numbers on this laptop for Practice. No video or audio." />
      </Section>

      <Section title="Privacy and data" description="Together has no account and no server that stores anything about you.">
        <ul className="grid gap-2.5 text-[13px] leading-relaxed text-fg-muted">
          <li className="flex gap-2.5">
            <Icon.Lock size={15} className="mt-0.5 shrink-0 text-fg-dim" />
            Camera frames are analyzed on this laptop and never sent anywhere. The partner receives your video (live, encrypted) and a few numbers a second.
          </li>
          <li className="flex gap-2.5">
            <Icon.Lock size={15} className="mt-0.5 shrink-0 text-fg-dim" />
            SmartSpectra’s usage telemetry is switched off. With it on, it would send one anonymous summary per session (SDK version, device type, frame counts), never video or measurements.
          </li>
          <li className="flex gap-2.5">
            <Icon.Lock size={15} className="mt-0.5 shrink-0 text-fg-dim" />
            On this laptop: {sessions?.length ?? 0} sessions and {recordings?.length ?? 0} recordings.
          </li>
        </ul>
        <div className="mt-4 flex gap-2">
          <Button icon={<Icon.Download />} onClick={async () => void (await api.exportAll())}>
            Export everything
          </Button>
          <Button variant="quiet-danger" icon={<Icon.Trash />} onClick={() => setWipe(true)}>
            Delete everything
          </Button>
        </div>
      </Section>

      <Section title="About">
        <div className="grid gap-1.5 text-[13px] text-fg-muted">
          <div>Together {config.appVersion}</div>
          <div>
            Measurement by Presage SmartSpectra. For general wellness only; not a medical device.{' '}
            <button type="button" className="text-fg underline decoration-line-strong underline-offset-2" onClick={() => void api.openExternal('model-cards')}>
              Model cards and limitations
            </button>
          </div>
        </div>
      </Section>

      <Confirm
        open={wipe}
        onClose={() => setWipe(false)}
        title="Delete everything?"
        body="All sessions, Moments, moods and recordings are removed from this laptop. This can’t be undone."
        confirmLabel="Delete everything"
        onConfirm={async () => {
          await api.deleteAll();
          await refresh();
          toast({ title: 'Everything deleted' });
        }}
      />
    </Page>
  );
}

/** Whether this Mac hosts rooms, and the address a second Mac should use. */
function HostStatus() {
  const config = useApp((s) => s.config)!;
  const { copy, done } = useCopy();
  const h = config.signalHost;
  if (h.mode === 'off') return null;
  if (h.mode === 'remote') return <Status kind="idle">Using a hosted server</Status>;
  if (h.mode === 'failed')
    return (
      <Callout tone="warn" title={`Port ${h.port} is used by another app`} testId="host-failed">
        Quit that app, or set a different port below (for example ws://localhost:8788) on both Macs.
      </Callout>
    );
  const addr = h.lan[0] ? `ws://${h.lan[0]}:${h.port}` : null;
  return (
    <div className="rounded-[12px] border border-line p-4" data-testid="host-status">
      <Status kind="ok">{h.mode === 'embedded' ? 'This Mac hosts rooms' : 'Using the Together server already running on this Mac'}</Status>
      {addr ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="min-w-0 text-[12.5px] text-fg-muted">
            Second Mac on the same network? Set its connection server to <span className="font-mono text-fg" data-testid="host-lan">{addr}</span>
          </div>
          <Button size="sm" icon={done ? <Icon.Check /> : <Icon.Copy />} onClick={() => void copy(addr)}>
            {done ? 'Copied' : 'Copy'}
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-[12.5px] text-fg-muted">Join a network so a second Mac can reach this one.</p>
      )}
    </div>
  );
}
