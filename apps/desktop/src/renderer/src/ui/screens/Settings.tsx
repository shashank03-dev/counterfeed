import { useState } from 'react';
import { applyTheme, useApp, type Theme } from '../../app/store';
import { api } from '../../lib/api';
import { Icon } from '../icons';
import { Button, Card, Confirm, Field, Segmented, Status, TextInput, toast } from '../kit';
import { Page } from '../Page';
import { exportAll } from './History';

export function Settings() {
  const { config, setConfig, prefs, setPrefs, refresh, reports } = useApp();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [delAll, setDelAll] = useState(false);

  const save = async (value: string | null) => {
    setBusy(true);
    setErr(null);
    try {
      setConfig(await api.setApiKey(value));
      setKey('');
      toast({ title: value ? 'Access key saved' : 'Access key removed', body: value ? 'Stored encrypted in your Keychain.' : undefined });
    } catch (e) {
      setErr((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="Settings" width={720}>
      <div className="grid gap-4">
        <Card title="SmartSpectra access key" description="Measuring runs on this Mac; the key is only checked online.">
          <div className="grid gap-3">
            <div className="text-[13px]" data-testid="key-status">
              {config?.apiKey ? <Status kind="ok">Key set{config.apiKeySource === 'env' ? ' from .env' : ' (Keychain)'}</Status> : <Status kind="warn">No key yet</Status>}
            </div>
            <Field label={config?.apiKey ? 'Replace key' : 'Paste your key'} hint={<>Free from Presage. <button type="button" className="underline underline-offset-2 hover:text-fg" onClick={() => void api.openExternal('presage-keys')}>Get a key</button>. It’s never shown again or logged.</>} htmlFor="key">
              <div className="flex gap-2">
                <TextInput id="key" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Access key" data-testid="key-input" />
                <Button variant="primary" busy={busy} disabled={!key.trim()} onClick={() => void save(key.trim())}>
                  Save
                </Button>
              </div>
            </Field>
            {err && <div className="text-[12.5px] text-bad">{err}</div>}
            {config?.apiKeySource === 'keychain' && (
              <div>
                <Button size="sm" variant="ghost" onClick={() => void save(null)}>
                  Remove saved key
                </Button>
              </div>
            )}
          </div>
        </Card>

        <Card title="Appearance">
          <Segmented<Theme>
            label="Theme"
            value={prefs.theme}
            onChange={(t) => {
              setPrefs({ theme: t });
              applyTheme(t);
            }}
            options={[
              { value: 'light', label: 'Light', icon: <Icon.Sun /> },
              { value: 'system', label: 'Auto', icon: <Icon.Monitor /> },
              { value: 'dark', label: 'Dark', icon: <Icon.Moon /> },
            ]}
          />
        </Card>

        <Card title="Your data" description="Everything lives in ~/Library/Application Support/Counterfeed, readable only by you.">
          <ul className="grid gap-1.5 text-[12.5px] text-fg-muted">
            <li className="flex gap-2"><Icon.Check size={14} className="mt-px shrink-0 text-ok" />Stored: your reports (numbers, your answers, and in focus sessions the names of the apps you used) and small pictures at report moments.</li>
            <li className="flex gap-2"><Icon.X size={14} className="mt-px shrink-0 text-fg-dim" />Never stored or sent: camera video, audio, face data, or a recording of your screen.</li>
            <li className="flex gap-2"><Icon.X size={14} className="mt-px shrink-0 text-fg-dim" />No accounts, no analytics, no AI services. SmartSpectra telemetry is off.</li>
          </ul>
          <div className="mt-4 flex gap-2">
            <Button size="sm" icon={<Icon.Download />} disabled={!reports?.length} onClick={() => void exportAll()}>
              Export reports
            </Button>
            <Button size="sm" variant="quiet-danger" icon={<Icon.Trash />} disabled={!reports?.length} onClick={() => setDelAll(true)} data-testid="settings-delete-all">
              Delete all
            </Button>
          </div>
        </Card>

        <Card title="About">
          <div className="grid gap-2 text-[12.5px] text-fg-muted">
            <p>Counterfeed {config?.appVersion}. Measurement by the Presage SmartSpectra SDK, on this Mac.</p>
            <p>Wellness information, not a medical measurement. Camera-based measurement can work differently across skin tones and lighting; Presage’s model cards describe the validation and limits.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => void api.openExternal('model-cards')}>
                Model cards
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void api.openExternal('presage-docs')}>
                Getting a good measurement
              </Button>
            </div>
          </div>
        </Card>
      </div>
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
