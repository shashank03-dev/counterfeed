import { useState } from 'react';
import { useApp } from '../../app/store';
import { Session } from '../../session/controller';
import { useSession } from '../../session/store';
import { Icon } from '../icons';
import { Button, CheckRow, Switch } from '../kit';

const ITEMS = [
  {
    id: 'media',
    title: 'Your video and voice go to the other person',
    body: 'Live, directly between your two laptops, encrypted. Never recorded or saved by Together.',
  },
  {
    id: 'signals',
    title: 'Your breathing wave and pulse go to them as numbers',
    body: 'About ten times a second: the wave’s height, your pulse and whether you’re talking. Never camera frames.',
  },
  {
    id: 'local',
    title: 'Your camera is analyzed on this laptop only',
    body: 'SmartSpectra measures you here. Facial-expression readings stay here too; a Moment is sent only if you tap Share on it.',
  },
  {
    id: 'stored',
    title: 'Results stay on this laptop',
    body: 'Sync scores, the moods you pick and your Moments are saved here. Export or delete them any time in History.',
  },
  {
    id: 'telemetry',
    title: 'No telemetry, no AI services',
    body: 'The measurement SDK’s usage telemetry is switched off, and nothing is sent to any analytics or AI service.',
  },
  {
    id: 'end',
    title: 'Either of you can end it at any moment',
    body: 'Press End or close the window: camera, microphone and sharing stop on both sides.',
  },
] as const;

/** Each person agrees, line by line, before anything turns on. Nothing streams until this is accepted. */
export function Consent() {
  const prefs = useApp((s) => s.prefs);
  const intent = useSession((s) => s.ctx.intent);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [shareReactions, setShareReactions] = useState(prefs.shareReactions);
  const [record, setRecord] = useState(prefs.recordSignals);
  const all = ITEMS.every((i) => checked[i.id]);
  const practice = intent?.kind === 'practice';

  const agreed = ITEMS.filter((i) => checked[i.id]).length;

  // Everything fits on one screen: the six promises on the left, choices and Continue on the right.
  return (
    <div className="scroll h-full">
      <div className="mx-auto max-w-[1040px] px-8 pt-4 pb-10">
        <div className="rise mb-5">
          <div>
            <h1 className="font-display text-[26px] font-semibold tracking-[-0.03em]">Before anything turns on</h1>
            <p className="mt-1.5 max-w-[620px] text-[13.5px] leading-relaxed text-fg-muted">
              {practice ? 'In practice your partner is a recording, but your camera still measures you the same way.' : 'The other person reads the same list. The call starts only when you have both agreed.'} Tick each line to continue.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_300px] items-start gap-5">
          <div className="grid grid-cols-2 gap-2">
            {ITEMS.map((item, i) => (
              <div key={item.id} className="rise grid" style={{ ['--i' as string]: i + 1 }}>
                <CheckRow testId={`consent-${item.id}`} checked={!!checked[item.id]} onChange={(v) => setChecked((c) => ({ ...c, [item.id]: v }))} title={item.title}>
                  {item.body}
                </CheckRow>
              </div>
            ))}
          </div>

          <aside className="rise sticky top-0 grid gap-4 rounded-[16px] bg-surface p-4 shadow-panel" style={{ ['--i' as string]: 7 }}>
            <div>
              <Switch checked={shareReactions} onChange={setShareReactions} label="Let me share my reactions" hint="You choose each Moment to send. Nothing is sent automatically." testId="pref-share" />
              <div className="h-px bg-line" />
              <Switch checked={record} onChange={setRecord} label="Record my signals" hint="Only your numbers, kept here for Practice. No video or audio." testId="pref-record" />
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-fg/[0.07]" aria-hidden>
              <div className="h-full rounded-full bg-g-duo transition-[width] duration-500 ease-soft" style={{ width: `${(agreed / ITEMS.length) * 100}%` }} />
            </div>
            <Button
              variant="you"
              size="lg"
              className="w-full justify-center"
              disabled={!all}
              onClick={() => {
                useApp.getState().setPrefs({ shareReactions, recordSignals: record });
                void Session.current?.consent(true, { shareReactions, record });
              }}
              data-testid="consent-accept"
              trailing={<Icon.ArrowRight />}
            >
              {all ? 'I agree, continue' : `${agreed} of ${ITEMS.length} agreed`}
            </Button>
            <Button variant="ghost" className="w-full justify-center" onClick={() => void Session.current?.consent(false, { shareReactions: false, record: false })} data-testid="consent-decline">
              Not now
            </Button>
          </aside>
        </div>
      </div>
    </div>
  );
}
