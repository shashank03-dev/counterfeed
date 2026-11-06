import { useId, useMemo } from 'react';
import type { PhaseResult, SessionRecord } from '@together/shared';
import { describeMoment } from '../../moments/detect';
import type { EndReason } from '../../session/machine';
import { Icon } from '../icons';
import { Callout, cx } from '../kit';
import { CompareBars, DuoGradient } from '../viz';
import { formatDate, verdict } from '../format';

/** The outcome of one session. Used live at the end of a session and in History. */
export function Results({ record, live, endedEarly, reason }: { record: SessionRecord; live?: boolean; endedEarly?: boolean; reason?: EndReason | null }) {
  const v = verdict(record.together);
  const focus = record.together ?? record.apart;
  const early = endedEarly ?? record.partial;
  const pct = (x: number | undefined) => (x === undefined ? null : x);

  return (
    <div className="mx-auto max-w-[1040px] px-8 pt-4 pb-12" data-testid="results">
      <header className="rise mb-7 text-center">
        <div className="text-[12px] font-medium tracking-[0.07em] text-fg-dim uppercase">
          {record.replay ? 'Practice with a replay' : 'Breathing together'} · {formatDate(record.startedAt)}
        </div>
        <h1 className="mx-auto mt-3 max-w-[720px] font-display text-[36px] leading-[1.1] font-semibold tracking-[-0.04em]" data-testid="verdict">
          {v.strong ? (
            <>
              You breathed <span className="text-duo">{record.together!.ratio.toFixed(1)}×</span> more in step than chance
            </>
          ) : (
            v.headline
          )}
        </h1>
        <p className="mx-auto mt-2 max-w-[560px] text-[14px] leading-relaxed text-fg-muted">{v.detail}</p>
      </header>

      <div className="grid gap-2.5">
        {record.replay && (
          <div className="rise flex items-center gap-2 rounded-[12px] border border-them/30 bg-them/[0.07] px-3.5 py-2.5 text-[12.5px]" data-testid="results-replay">
            <Icon.Play size={14} className="text-them" /> <span className="font-medium">Replayed session.</span>
            <span className="text-fg-muted">The partner was a recording made {formatDate(record.replay.recordedAt / 1000)}, so this shows how in step you were with that recording.</span>
          </div>
        )}
        {early && (
          <div className="rise">
            <Callout tone="info" title="Ended early">
              {reason === 'partner-lost' ? 'The connection dropped and didn’t come back.' : reason === 'partner-ended' ? 'Your partner ended the session.' : 'The session was ended before it finished.'} These results cover what was measured until then.
            </Callout>
          </div>
        )}
      </div>

      <div className="mt-5 grid grid-cols-[1.1fr_1fr] gap-4">
        <section className="rise rounded-[18px] bg-surface p-5 shadow-panel" style={{ ['--i' as string]: 1 }}>
          <h2 className="text-[13px] font-semibold">Apart, then together</h2>
          <p className="mt-0.5 mb-5 text-[12px] text-fg-dim">How steadily your breathing kept the same rhythm. The mark on each bar is chance for that part.</p>
          <CompareBars
            rows={[
              { label: 'Apart · 2 min, waves hidden', value: pct(record.apart?.plv), chance: record.apart ? record.apart.chance.mean : null, hint: record.apart ? coverageHint(record.apart) : undefined, testId: 'bar-apart' },
              { label: 'Together · 3 min, waves shown', value: pct(record.together?.plv), chance: record.together ? record.together.chance.mean : null, hint: record.together ? coverageHint(record.together) : undefined, testId: 'bar-together' },
            ]}
          />
          {record.apart && record.together && (
            <p className="mt-5 border-t border-line pt-4 text-[12.5px] leading-relaxed text-fg-muted">{compare(record.apart, record.together)}</p>
          )}
        </section>

        <section className="rise rounded-[18px] bg-surface p-5 shadow-panel" style={{ ['--i' as string]: 2 }}>
          <h2 className="text-[13px] font-semibold">In step, minute by minute</h2>
          <p className="mt-0.5 mb-4 text-[12px] text-fg-dim">{record.together ? 'Together, in 30-second windows' : record.apart ? 'Apart, in 30-second windows' : 'No windows with enough signal'}</p>
          <Timeline result={focus} />
        </section>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4">
        <section className="rise rounded-[18px] bg-surface p-5 shadow-panel" style={{ ['--i' as string]: 3 }}>
          <h2 className="mb-4 text-[13px] font-semibold">Breathing and pulse</h2>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] tracking-[0.05em] text-fg-dim uppercase">
                <th className="pb-2 font-medium" />
                <th className="pb-2 font-medium">Breaths/min</th>
                <th className="pb-2 font-medium">Pulse</th>
              </tr>
            </thead>
            <tbody className="tnum">
              {(['you', 'partner'] as const).map((who) => (
                <tr key={who} className="border-t border-line">
                  <td className="py-2.5">
                    <span className="flex items-center gap-1.5 font-medium">
                      <span className={cx('size-2 rounded-full', who === 'you' ? 'bg-you' : 'bg-them')} />
                      {who === 'you' ? 'You' : 'Them'}
                    </span>
                  </td>
                  <td className="py-2.5">{record.breathingRate[who] ?? '–'}</td>
                  <td className="py-2.5">{record.pulse[who] !== null ? `${record.pulse[who]} bpm` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[11.5px] leading-relaxed text-fg-dim">Wellness information, not a medical measurement.</p>
        </section>

        <section className="rise rounded-[18px] bg-surface p-5 shadow-panel" style={{ ['--i' as string]: 4 }}>
          <h2 className="mb-4 text-[13px] font-semibold">How you felt</h2>
          <MoodLine name="You" who="you" start={record.moods.you.start} end={record.moods.you.end} />
          <div className="my-3 h-px bg-line" />
          {record.moods.partner.start || record.moods.partner.end ? (
            <MoodLine name="Them" who="them" start={record.moods.partner.start} end={record.moods.partner.end} />
          ) : (
            <div className="text-[12.5px] text-fg-dim">They kept their words to themselves.</div>
          )}
        </section>

        <section className="rise rounded-[18px] bg-surface p-5 shadow-panel" style={{ ['--i' as string]: 5 }}>
          <h2 className="mb-1 text-[13px] font-semibold">Your Moments</h2>
          <p className="mb-3 text-[11.5px] text-fg-dim">While they talked. Only on this laptop unless you shared.</p>
          {record.moments.length === 0 && record.sharedWithMe.length === 0 ? (
            <div className="text-[12.5px] text-fg-dim">None this time.</div>
          ) : (
            <ul className="grid gap-1.5 text-[12.5px]">
              {record.moments.map((m) => (
                <li key={m.id} className="flex gap-2">
                  <Icon.Sparkle size={14} className="mt-0.5 shrink-0 text-you" />
                  {describeMoment(m)}
                </li>
              ))}
              {record.sharedWithMe.map((m) => (
                <li key={m.id} className="flex gap-2 text-fg-muted">
                  <Icon.Sparkle size={14} className="mt-0.5 shrink-0 text-them" />
                  {describeMoment(m, 'they')}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <footer className="mt-6 flex items-center justify-center gap-2 text-[12px] text-fg-dim">
        <Icon.Lock size={13} /> {live ? 'Saved on this laptop. Camera and microphone are off.' : 'Stored on this laptop only.'}
      </footer>
    </div>
  );
}

function coverageHint(r: PhaseResult) {
  return `${Math.round(r.coverage * 100)}% of this part had clear, quiet signal from you both`;
}

function compare(a: PhaseResult, t: PhaseResult): string {
  const d = Math.round((t.plv - a.plv) * 100);
  if (Math.abs(d) < 5) return 'You were about as in step apart as together: seeing each other’s breath didn’t change much this time.';
  if (d > 0) return `Seeing each other’s breath, you were ${d} points more in step than apart.`;
  return `You were ${-d} points less in step together than apart. Trying hard to match often does that; it gets easier.`;
}

function MoodLine({ name, who, start, end }: { name: string; who: 'you' | 'them'; start: string | null; end: string | null }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] text-fg-muted">
        <span className={cx('size-2 rounded-full', who === 'you' ? 'bg-you' : 'bg-them')} />
        {name}
      </div>
      <div className="flex items-center gap-2 text-[14px] font-medium">
        <span className={start ? 'text-fg' : 'text-fg-dim'}>{start ?? '–'}</span>
        <Icon.ArrowRight size={14} className="text-fg-dim" />
        <span className={end ? 'text-fg' : 'text-fg-dim'}>{end ?? '–'}</span>
      </div>
    </div>
  );
}

/** Per-window sync over the phase, with the chance level as a dashed line. */
function Timeline({ result }: { result: PhaseResult | null }) {
  const id = useId();
  const W = 420;
  const H = 150;
  const pad = { l: 26, r: 6, t: 8, b: 20 };
  const pts = useMemo(() => {
    const s = result?.series ?? [];
    if (s.length < 2) return null;
    return s.map((v, i) => [pad.l + (i / (s.length - 1)) * (W - pad.l - pad.r), pad.t + (1 - v) * (H - pad.t - pad.b)] as const);
  }, [result, pad.l, pad.r, pad.t, pad.b]);
  if (!result || !pts) return <div className="grid h-[150px] place-items-center text-[12.5px] text-fg-dim">Not enough quiet signal to draw.</div>;
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const area = `${line}L${pts[pts.length - 1]![0]},${H - pad.b}L${pts[0]![0]},${H - pad.b}Z`;
  const cy = pad.t + (1 - result.chance.mean) * (H - pad.t - pad.b);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Sync over time">
      {[0, 0.5, 1].map((g) => (
        <g key={g}>
          <line x1={pad.l} x2={W - pad.r} y1={pad.t + (1 - g) * (H - pad.t - pad.b)} y2={pad.t + (1 - g) * (H - pad.t - pad.b)} stroke="var(--line)" />
          <text x={pad.l - 6} y={pad.t + (1 - g) * (H - pad.t - pad.b) + 3.5} textAnchor="end" fontSize="9.5" fill="var(--fg-dim)">
            {g * 100}
          </text>
        </g>
      ))}
      <defs>
        <DuoGradient id={`${id}-l`} />
        <linearGradient id={`${id}-a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--duo-3)" stopOpacity="0.22" />
          <stop offset="1" stopColor="var(--duo-3)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${CSS.escape(id)}-a)`} />
      <line x1={pad.l} x2={W - pad.r} y1={cy} y2={cy} stroke="var(--fg-muted)" strokeDasharray="3 4" />
      <text x={W - pad.r} y={cy < pad.t + 16 ? cy + 12 : cy - 5} textAnchor="end" fontSize="9.5" fill="var(--fg-muted)">
        chance
      </text>
      <path d={line} fill="none" stroke={`url(#${CSS.escape(id)}-l)`} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
      <text x={pad.l} y={H - 5} fontSize="9.5" fill="var(--fg-dim)">
        start
      </text>
      <text x={W - pad.r} y={H - 5} textAnchor="end" fontSize="9.5" fill="var(--fg-dim)">
        end
      </text>
    </svg>
  );
}
