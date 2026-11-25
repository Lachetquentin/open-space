// A PM's Inbox, above its message field next to PendingStrip: the questions of its plan waiting for the user (their
// answers as buttons, the recommended one marked; a field when it proposes none), the tasks they block, what its last
// turn finished; the snoozed and settled questions in two drawers. Shown while the server sends the PM's summary (the PM
// setting on), drawn from the plan it sends (usePmDetail) and nothing else: an answer taken leaves when the plan comes back.
import { use, useEffect, useState } from 'react';
import { fullAskTag, itemTag, type PmAsk, type PmItem } from '../../shared/pm.ts';
import type { PmDetail, SessionInfo } from '../../shared/protocol.ts';
import { MAX_TIMER_MS } from '../../shared/timers.ts';
import { t } from '../i18n/index.ts';
import { resetLabel } from '../lib/format.ts';
import { blockingAsks, inAnHour, type InboxRow, pmInbox, tomorrowMorning } from '../state/pm-inbox.ts';
import { pmAskAction, usePmDetail } from '../state/usePmDetail.ts';
import { useSessions } from '../state/sessions.ts';
import { CheckIcon, ChevronDownIcon, ClockIcon, CloseIcon, CopyIcon, InboxIcon, StarIcon, SunriseIcon } from './Icons.tsx';
import { ActionMenu } from './ModWindows.tsx';
import { WindowCompactContext } from './useWindowDrag.ts';
import { usePhone } from '../lib/phone.ts';

export function PmInbox({ session }: { session: SessionInfo }) {
  const detail = usePmDetail(session.pmSummary ? session.id : null);
  // folded from the start in a small window or on a phone, where the thread needs the room
  const small = use(WindowCompactContext);
  const phone = usePhone();
  const [folded, setFolded] = useState(small || phone);
  const [drawer, setDrawer] = useState<'snoozed' | 'settled' | null>(null);
  // read at each render: the server sends the plan again when a snooze ends, and this page's own timer below covers a
  // clock a little behind the server's
  const inbox = detail ? pmInbox(detail, Date.now()) : null;
  const [, wake] = useState(0);
  const nextWake = inbox?.nextWake;
  useEffect(() => {
    if (nextWake === undefined) return;
    const timer = setTimeout(() => wake((count) => count + 1), Math.min(MAX_TIMER_MS, Math.max(0, nextWake - Date.now() + 50)));
    return () => clearTimeout(timer);
  }, [nextWake]);
  // the PM's own AskUserQuestion is open by the field: that one first
  if (!detail || !inbox || !session.pmSummary || session.permissions[0]?.questions) return null;
  if (!inbox.rows.length && !inbox.snoozed.length) return null;
  const words = t.pm.inbox;
  const counts = [
    inbox.counts.asks ? t.pm.counts.asks(inbox.counts.asks) : '',
    inbox.counts.blocked ? words.blocked(inbox.counts.blocked) : '',
    inbox.counts.finished ? words.finished(inbox.counts.finished) : '',
  ].filter(Boolean).join(' · ') || words.nothing;
  return (
    <section className="cp-pm-inbox" aria-label={words.label} data-folded={folded}>
      <div className="cp-pm-inbox__head">
        <button type="button" className="cp-pm-inbox__title" aria-expanded={!folded} onClick={() => setFolded(!folded)}>
          <ChevronDownIcon />{words.label}<span className="cp-pm-inbox__counts">{counts}</span>
        </button>
      </div>
      {!folded && (
        <>
          <ul className="cp-pm-inbox__list">
            {inbox.rows.map((row) => <Row key={rowKey(row)} pm={session.id} row={row} detail={detail} />)}
          </ul>
          {inbox.more > 0 && <p className="cp-pm-inbox__more">{words.more(inbox.more)}</p>}
          {(inbox.snoozed.length > 0 || inbox.settled.length > 0) && (
            <div className="cp-pm-inbox__drawers">
              {inbox.snoozed.length > 0 && (
                <button type="button" className="cp-pm-inbox__drawer" aria-expanded={drawer === 'snoozed'} onClick={() => setDrawer(drawer === 'snoozed' ? null : 'snoozed')}>{words.snoozed(inbox.snoozed.length)}</button>
              )}
              {inbox.settled.length > 0 && (
                <button type="button" className="cp-pm-inbox__drawer" aria-expanded={drawer === 'settled'} onClick={() => setDrawer(drawer === 'settled' ? null : 'settled')}>{words.settled(inbox.settled.length)}</button>
              )}
            </div>
          )}
          {drawer === 'snoozed' && inbox.snoozed.length > 0 && <Snoozed pm={session.id} asks={inbox.snoozed} />}
          {drawer === 'settled' && inbox.settled.length > 0 && <Settled pm={session.id} asks={inbox.settled} />}
        </>
      )}
    </section>
  );
}

const rowKey = (row: InboxRow) => (row.kind === 'ask' ? `ask:${row.ask.no}` : `${row.kind}:${row.item.no}`);

function Row({ pm, row, detail }: { pm: string; row: InboxRow; detail: PmDetail }) {
  if (row.kind === 'ask') return <AskRow pm={pm} ask={row.ask} />;
  return <ItemRow item={row.item} note={row.kind === 'blocked' ? t.pm.inbox.blockedBy(blockingAsks(detail, row.item).map((ask) => fullAskTag(ask)).join(', ')) : row.item.done || t.pm.inbox.done} kind={row.kind} />;
}

/** A task: blocked by a question snoozed, or finished during the PM's last turn. */
function ItemRow({ item, note, kind }: { item: PmItem; note: string; kind: 'blocked' | 'finished' }) {
  return (
    <li className="cp-pm-inbox__row" data-kind={kind}>
      <p className="cp-pm-inbox__line">
        <span className="cp-pm-inbox__tag">{itemTag(item.no)}</span>
        <span className="cp-pm-inbox__text">{item.title}</span>
        {kind === 'finished' && <CheckIcon />}
      </p>
      <p className="cp-pm-inbox__note">{note}</p>
    </li>
  );
}

/** An open question: its answers as buttons, or a field for an answer of the user's own; its menu. */
function AskRow({ pm, ask }: { pm: string; ask: PmAsk }) {
  const toast = useSessions((s) => s.toast);
  const [typed, setTyped] = useState('');
  // one answer per question: the buttons and the field wait for the plan to bring the row away
  const [sent, setSent] = useState(false);
  const words = t.pm.inbox;
  const tag = fullAskTag(ask);
  const answer = (text: string) => { if (sent || !text.trim()) return; setSent(pmAskAction(pm, ask.no, 'answer', { answer: text.trim() })); };
  const dismiss = () => {
    if (pmAskAction(pm, ask.no, 'dismiss')) toast('info', words.dismissed(tag), { label: t.pm.ask.undo, run: () => pmAskAction(pm, ask.no, 'undoDismiss') });
  };
  const copy = () => { void navigator.clipboard.writeText(tag).then(() => toast('info', words.copied(tag)), () => {}); };
  return (
    <li className="cp-pm-inbox__row" data-kind="ask">
      <div className="cp-pm-inbox__line">
        <span className="cp-pm-inbox__tag">{tag}</span>
        <span className="cp-pm-inbox__text">{ask.title}</span>
        <ActionMenu
          trigger={{ label: words.actions(tag), icon: <ChevronDownIcon /> }}
          items={[
            { label: words.snoozeHour, title: words.snoozeHour, icon: <ClockIcon />, run: () => pmAskAction(pm, ask.no, 'snooze', { until: inAnHour(Date.now()) }) },
            { label: words.snoozeMorning, title: words.snoozeMorning, icon: <SunriseIcon />, run: () => pmAskAction(pm, ask.no, 'snooze', { until: tomorrowMorning(Date.now()) }) },
            { label: t.pm.ask.dismiss, title: words.dismissTitle, icon: <CloseIcon />, run: dismiss },
            { label: t.pm.ask.copyTag(tag), title: t.pm.ask.copyTag(tag), icon: <CopyIcon />, run: copy },
          ]}
        />
      </div>
      {ask.detail && <p className="cp-pm-inbox__detail">{ask.detail}</p>}
      {ask.answers.length > 0 ? (
        <div className="cp-pm-inbox__answers">
          {ask.answers.map((label) => {
            const recommended = label === ask.recommended;
            return (
              <button
                key={label} type="button" className="cp-button" data-size="small" data-variant={recommended ? 'primary' : undefined}
                aria-label={recommended ? words.recommendedAnswer(label) : undefined} title={recommended ? t.pm.ask.recommended : undefined} disabled={sent} onClick={() => answer(label)}
              >
                {recommended && <StarIcon />}{label}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="cp-pm-inbox__answers">
          {/* inside the composer's form: Enter answers the question, it never sends the composer's draft */}
          <input
            className="cp-pm-inbox__field" value={typed} disabled={sent} placeholder={words.typeAnswer} aria-label={words.answerLabel(tag)}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); answer(typed); } }}
          />
          <button type="button" className="cp-button" data-size="small" data-variant="primary" disabled={sent || !typed.trim()} onClick={() => answer(typed)}>{t.pm.ask.answer}</button>
        </div>
      )}
    </li>
  );
}

/** The snoozed questions, the first back first, each with when it comes back and a way to bring it back now. */
function Snoozed({ pm, asks }: { pm: string; asks: PmAsk[] }) {
  const now = new Date();
  return (
    <ul className="cp-pm-inbox__list" data-drawer="snoozed">
      {asks.map((ask) => (
        <li key={ask.no} className="cp-pm-inbox__row" data-kind="snoozed">
          <div className="cp-pm-inbox__line">
            <span className="cp-pm-inbox__tag">{fullAskTag(ask)}</span>
            <span className="cp-pm-inbox__text">{ask.title}</span>
            <button type="button" className="cp-button" data-size="small" onClick={() => pmAskAction(pm, ask.no, 'wake')}>{t.pm.ask.wake}</button>
          </div>
          {ask.snoozedUntil && <p className="cp-pm-inbox__note">{t.pm.inbox.snoozedUntil(resetLabel(ask.snoozedUntil, now))}</p>}
        </li>
      ))}
    </ul>
  );
}

/** The settled questions, the latest first: how each was settled, the answer given; a dismissal the PM was not told yet can be taken back. */
function Settled({ pm, asks }: { pm: string; asks: PmAsk[] }) {
  const states = t.pm.project.askStates;
  return (
    <ul className="cp-pm-inbox__list" data-drawer="settled">
      {asks.map((ask) => (
        <li key={ask.no} className="cp-pm-inbox__row" data-kind="settled">
          <div className="cp-pm-inbox__line">
            <span className="cp-pm-inbox__tag">{fullAskTag(ask)}</span>
            <span className="cp-pm-inbox__text">{ask.title}</span>
            {ask.state === 'dismissed' && !ask.dismissalTold && (
              <button type="button" className="cp-button" data-size="small" onClick={() => pmAskAction(pm, ask.no, 'undoDismiss')}>{t.pm.ask.undo}</button>
            )}
          </div>
          <p className="cp-pm-inbox__note"><InboxIcon />{states[ask.state]}{ask.answer ? ` · ${ask.answer}` : ''}</p>
        </li>
      ))}
    </ul>
  );
}
