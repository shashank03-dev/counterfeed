import { useState } from 'react';
import { MOOD_WORDS, type MoodWord } from '@together/shared';
import { Session } from '../../session/controller';
import { useSession } from '../../session/store';
import { Icon } from '../icons';
import { Button, cx, Switch } from '../kit';

/** Self-report, one word. Nothing about mood is ever inferred from the camera. */
export function Mood({ when }: { when: 'start' | 'end' }) {
  const mine = useSession((s) => s.you.moods[when]);
  const shareDefault = useSession((s) => s.you.shareMoods);
  const partnerReady = useSession((s) => !!s.partner.ready[when === 'start' ? 'moodStart' : 'moodEnd']);
  const before = useSession((s) => s.you.moods.start);
  const [pick, setPick] = useState<MoodWord | null>(mine);
  const [share, setShare] = useState(shareDefault);

  if (mine) {
    return (
      <div className="grid h-full place-items-center">
        <div className="pop text-center" data-testid="mood-waiting">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-ok/15 text-ok">
            <Icon.Check size={22} strokeWidth={2.2} />
          </div>
          <div className="text-[16px] font-semibold">You picked “{mine}”</div>
          <div className="mt-1 text-[13px] text-fg-muted">{partnerReady ? 'They’re done too. Starting…' : 'Waiting for them to pick theirs…'}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full place-items-center p-8">
      <div className="w-full max-w-[520px]">
        <h1 className="rise text-center font-display text-[26px] font-semibold tracking-[-0.03em]">{when === 'start' ? 'How do you feel right now?' : 'And how do you feel now?'}</h1>
        <p className="rise mt-1.5 text-center text-[13.5px] text-fg-muted" style={{ ['--i' as string]: 1 }}>
          {when === 'start' ? 'One word, just for you. You’ll pick again at the end.' : before ? `You started out “${before}”.` : 'One word.'}
        </p>
        <div role="radiogroup" aria-label="Mood" className="rise mt-7 grid grid-cols-3 gap-2" style={{ ['--i' as string]: 2 }}>
          {MOOD_WORDS.map((w) => (
            <button
              key={w}
              type="button"
              role="radio"
              aria-checked={pick === w}
              onClick={() => setPick(w)}
              data-testid={`mood-${w}`}
              className={cx(
                'h-12 rounded-[12px] border text-[14px] font-medium transition-all duration-200',
                pick === w ? 'border-transparent bg-g-you text-white shadow-[0_8px_22px_-10px_var(--you)]' : 'border-line bg-surface text-fg hover:border-line-strong hover:bg-surface-2',
              )}
            >
              {w}
            </button>
          ))}
        </div>
        <div className="rise mt-5 rounded-[14px] bg-surface px-4 py-1 shadow-panel" style={{ ['--i' as string]: 3 }}>
          <Switch checked={share} onChange={setShare} label="Show my word to them" hint="Off keeps it on this laptop only." testId="mood-share" />
        </div>
        <Button variant="primary" size="lg" className="rise mt-5 w-full" disabled={!pick} onClick={() => pick && Session.current?.pickMood(when, pick, share)} data-testid="mood-continue" style={{ ['--i' as string]: 4 }}>
          Continue
        </Button>
      </div>
    </div>
  );
}
