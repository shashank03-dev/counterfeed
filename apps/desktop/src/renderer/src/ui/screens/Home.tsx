import type { Report } from '@counterfeed/shared';
import { useApp } from '../../app/store';
import { api } from '../../lib/api';
import { session } from '../../session/controller';
import { Icon } from '../icons';
import { Button, Callout, cx } from '../kit';
import { formatDay, MODE_LABEL, sourceLabel } from '../format';

/** Four doors (feed check, review, hook test, focus session), what happens in three steps, and your latest reports. */
export function Home() {
  const { reports, config, go } = useApp();
  const recent = (reports ?? []).slice(0, 4);
  const blocked = !config?.apiKey && !config?.e2e;
  return (
    <div className="bg-glow min-h-full">
    <div className="mx-auto max-w-[1080px] px-10 pt-16 pb-16">
      <header className="rise" style={{ ['--i' as string]: 0 }}>
        <h1 className="font-display text-[40px] leading-[1.05] font-semibold tracking-[-0.04em]">
          <span className="text-g-ink">Your feed measures you.</span>
          <br />
          <span className="text-g-accent">Measure it back.</span>
        </h1>
        <p className="mt-3 max-w-[560px] text-[14.5px] leading-relaxed text-fg-muted">
          Counterfeed watches your breathing, blinking and gaze with your Mac’s camera while you scroll or review something, then shows you what it did to your attention. Everything stays on this Mac.
        </p>
      </header>

      {blocked && (
        <div className="rise mt-6" style={{ ['--i' as string]: 1 }}>
          <Callout tone="warn" title="Add your SmartSpectra access key to start" action={<Button size="sm" onClick={() => go('settings')}>Open Settings</Button>} testId="home-no-key">
            It’s free from Presage and takes a minute. Reports you already have still open without it.
          </Callout>
        </div>
      )}

      <div className="mt-8 grid gap-4 md:grid-cols-2" data-testid="doors">
        <ModeCard
          i={1}
          testId="start-feed"
          icon={<Icon.Phone size={22} />}
          tone="you"
          title="Check a feed"
          body="Scroll Instagram, TikTok, YouTube or anything else, as you normally would. See where it pulled you in, how often you stopped breathing, and one small thing to try."
          tags={['iPhone Mirroring', 'Any browser tab', '2–10 min']}
          cta="Start a feed check"
          disabled={blocked}
          onClick={() => session.begin('feed')}
        />
        <ModeCard
          i={2}
          testId="start-review"
          icon={<Icon.Review size={22} />}
          tone="feed"
          title="Review a project"
          body="For judges and reviewers. Watch a demo video or try an app, then see exactly where it held your attention and where it lost you, next to your own scores."
          tags={['Demo video', 'Any window', 'Your scores']}
          cta="Start a review"
          disabled={blocked}
          onClick={() => session.begin('review')}
        />
        <ModeCard
          i={3}
          testId="start-hooks"
          icon={<Icon.Clips size={22} />}
          tone="hook"
          title="Test your hooks"
          body="For creators. Drop in a few short clips and scroll them like a feed, swiping whenever you would. See which one grabbed you, the second it landed, and where you’d have swiped away."
          tags={['2–6 clips', 'Swipe like a feed', 'Ranked']}
          cta="Start a hook test"
          disabled={blocked}
          onClick={() => session.begin('hooks')}
        />
        <ModeCard
          i={4}
          testId="start-focus"
          icon={<Icon.Focus size={22} />}
          tone="focus"
          title="Focus on one thing"
          body="Set a timer and work. Counterfeed turns on Do Not Disturb, notices when your eyes leave the work, and shows how much of the time you were really focused, and in which apps."
          tags={['10–50 min', 'Do Not Disturb', 'Per app']}
          cta="Start a focus session"
          disabled={blocked}
          onClick={() => session.begin('focus')}
        />
      </div>

      <section className="rise mt-10" style={{ ['--i' as string]: 3 }}>
        <h2 className="mb-3 text-[11px] font-semibold tracking-[0.07em] text-fg-dim uppercase">How it works</h2>
        <ol className="grid gap-3 md:grid-cols-3">
          {[
            { icon: <Icon.Camera />, t: 'Find your normal', b: '40 seconds looking at a calm screen, so everything after is compared with you, not with anyone else.' },
            { icon: <Icon.Eye />, t: 'Watch as you usually do', b: 'Counterfeed shrinks to a small bar. It notices breathing pauses, long stares and looking away as they happen.' },
            { icon: <Icon.Sparkle />, t: 'Read one page', b: 'A score, one sentence, the moments that hooked you with a picture of what was on screen, and one small suggestion.' },
          ].map((s, i) => (
            <li key={s.t} className="rounded-[16px] bg-surface p-4 shadow-panel">
              <div className="flex items-center gap-2.5">
                <span className="grid size-7 place-items-center rounded-full bg-fg/[0.07] text-fg-muted [&_svg]:size-4">{s.icon}</span>
                <span className="tnum text-[11px] text-fg-dim">{i + 1}</span>
              </div>
              <div className="mt-2.5 text-[13.5px] font-semibold">{s.t}</div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">{s.b}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="rise mt-10" style={{ ['--i' as string]: 4 }}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold tracking-[0.07em] text-fg-dim uppercase">Recent reports</h2>
          {!!reports?.length && (
            <Button size="sm" variant="ghost" onClick={() => go('history')} trailing={<Icon.ChevronRight />}>
              All reports
            </Button>
          )}
        </div>
        {recent.length ? (
          <div className="grid gap-2" data-testid="recent">
            {recent.map((r) => (
              <ReportRow key={r.id} r={r} />
            ))}
          </div>
        ) : (
          <div className="rounded-[16px] border border-dashed border-line-strong px-5 py-6 text-center text-[13px] text-fg-muted">Your reports will appear here. Nothing is uploaded; they live on this Mac.</div>
        )}
      </section>
    </div>
    </div>
  );
}

const TONE = {
  you: { wash: 'bg-you', tile: 'bg-g-you' },
  feed: { wash: 'bg-feed', tile: 'bg-g-feed' },
  hook: { wash: 'bg-hook', tile: 'bg-g-hook' },
  focus: { wash: 'bg-focus', tile: 'bg-g-focus' },
} as const;

function ModeCard({ i, icon, tone, title, body, tags, cta, onClick, disabled, testId }: { i: number; icon: React.ReactNode; tone: keyof typeof TONE; title: string; body: string; tags: string[]; cta: string; onClick: () => void; disabled: boolean; testId: string }) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className="rise group relative flex flex-col overflow-hidden rounded-[20px] bg-surface p-6 text-left shadow-panel transition-transform duration-300 ease-soft enabled:hover:-translate-y-1 disabled:opacity-60"
      style={{ ['--i' as string]: i }}
    >
      {/* Light: a soft wash of the door's hue. Dark: a lit hairline along the top edge instead (a dim hue on near-black turns muddy). */}
      <span aria-hidden className={cx('pointer-events-none absolute -top-20 -right-20 size-56 rounded-full opacity-(--wash) blur-3xl transition-opacity duration-300 group-hover:opacity-(--wash-hover)', TONE[tone].wash)} />
      <span aria-hidden className="pointer-events-none absolute inset-x-5 top-0 h-px opacity-(--edge) transition-opacity duration-300 group-hover:opacity-(--edge-hover)" style={{ background: `linear-gradient(90deg, transparent, var(--${tone}-hi) 30%, transparent 80%)` }} />
      <span className={cx('relative grid size-11 place-items-center rounded-[13px] text-white', TONE[tone].tile)}>{icon}</span>
      <span className="relative mt-4 font-display text-[21px] font-semibold tracking-[-0.025em]">{title}</span>
      <span className="relative mt-1.5 text-[13px] leading-relaxed text-fg-muted">{body}</span>
      <span className="relative mt-4 flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span key={t} className="rounded-full bg-fg/[0.06] px-2.5 py-1 text-[11.5px] text-fg-muted">
            {t}
          </span>
        ))}
      </span>
      <span className="relative mt-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-fg">
        {cta}
        <Icon.ArrowRight size={15} className="transition-transform duration-200 group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}

export function ScoreChip({ r }: { r: Report }) {
  return (
    <span className="grid size-11 shrink-0 place-items-center rounded-full bg-fg/[0.06]">
      <span className="tnum text-[14px] font-semibold">{r.pull.score ?? '–'}</span>
    </span>
  );
}

export function ReportRow({ r, onDelete, readOnly }: { r: Report; onDelete?: () => void; readOnly?: boolean }) {
  const open = async () => {
    const thumbs = readOnly ? {} : await api.readThumbs(r.id).catch(() => ({}));
    useApp.getState().openReport({ report: r, thumbs, from: readOnly ? 'file' : 'history', fileName: readOnly ? useApp.getState().imported?.name : undefined });
  };
  return (
    <div className="group flex items-center gap-3 rounded-[14px] bg-surface px-3 py-2.5 shadow-panel" data-testid="report-row">
      <button type="button" onClick={() => void open()} className="flex min-w-0 flex-1 items-center gap-3 text-left" data-testid="open-report">
        <ScoreChip r={r} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium">{sourceLabel(r)}</span>
          <span className="block truncate text-[12px] text-fg-dim">
            {MODE_LABEL[r.mode]} · {formatDay(r.startedAt)}
            {r.signal === 'test' && ' · test signal'}
          </span>
        </span>
        <span className="hidden max-w-[300px] truncate text-[12px] text-fg-muted lg:block">{r.summary}</span>
        <Icon.ChevronRight size={15} className="shrink-0 text-fg-dim" />
      </button>
      {onDelete && (
        <button type="button" aria-label="Delete report" onClick={onDelete} data-testid="delete-report" className="grid size-8 place-items-center rounded-[9px] text-fg-dim opacity-0 transition-opacity group-hover:opacity-100 hover:bg-bad/10 hover:text-bad focus-visible:opacity-100">
          <Icon.Trash size={15} />
        </button>
      )}
    </div>
  );
}
