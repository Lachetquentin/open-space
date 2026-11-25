// A PM's Inbox, above its message field next to PendingStrip: the questions of its plan waiting for the user (their
// answers as buttons, the recommended one marked; a field when it proposes none), its live pages to fill (opened in their
// window, PmPageWindow), the tasks they block, what its last
// turn finished; the snoozed and settled questions and the closed tasks in three drawers; a question shown where it was
// asked in the conversation (ShowInFeedContext). Shown while the server sends the PM's summary (the PM setting on), drawn
// from the plan it sends (usePmDetail) and nothing else: an answer taken leaves when the plan comes back.
import { use, useEffect, useRef, useState } from 'react';
import { fullAskTag, itemTag, type PmAsk, type PmItem, type PmPage } from '../../shared/pm.ts';
import type { PmDetail, SessionInfo } from '../../shared/protocol.ts';
import { MAX_TIMER_MS } from '../../shared/timers.ts';
import { t } from '../i18n/index.ts';
import { resetLabel } from '../lib/format.ts';
import { blockingAsks, inAnHour, type InboxRow, pmInbox, tomorrowMorning } from '../state/pm-inbox.ts';
import { pmArchive, pmAskAction, usePmDetail } from '../state/usePmDetail.ts';
import { openPmPage } from '../state/pm.ts';
import { useSessions } from '../state/sessions.ts';
import { ShowInFeedContext } from './Feed.tsx';
import { CheckIcon, ChevronDownIcon, ClockIcon, CloseIcon, CopyIcon, InboxIcon, MessageIcon, PmPageIcon, StarIcon, SunriseIcon } from './Icons.tsx';
import { ActionMenu } from './ModWindows.tsx';
import { WindowCompactContext } from './useWindowDrag.ts';
import { usePhone } from '../lib/phone.ts';

/** How long an answer sent waits for the plan to take its question away before the row can answer again. */
const ANSWER_RETRY_MS = 5000;

export function PmInbox({ session }: { session: SessionInfo }) {
  const detail = usePmDetail(session.pmSummary ? session.id : null);
  // folded from the start in a small window or on a phone, where the thread needs the room
  const small = use(WindowCompactContext);
  const phone = usePhone();
  const [folded, setFolded] = useState(small || phone);
  const [drawer, setDrawer] = useState<'snoozed' | 'settled' | 'closed' | null>(null);
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
    inbox.counts.pages ? words.pages(inbox.counts.pages) : '',
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
          {(inbox.snoozed.length > 0 || inbox.settled.length > 0 || inbox.closed.length > 0) && (
            <div className="cp-pm-inbox__drawers">
              {inbox.snoozed.length > 0 && (
                <button type="button" className="cp-pm-inbox__drawer" aria-expanded={drawer === 'snoozed'} onClick={() => setDrawer(drawer === 'snoozed' ? null : 'snoozed')}>{words.snoozed(inbox.snoozed.length)}</button>
              )}
              {inbox.settled.length > 0 && (
                <button type="button" className="cp-pm-inbox__drawer" aria-expanded={drawer === 'settled'} onClick={() => setDrawer(drawer === 'settled' ? null : 'settled')}>{words.settled(inbox.settled.length)}</button>
              )}
              {inbox.closed.length > 0 && (
                <button type="button" className="cp-pm-inbox__drawer" aria-expanded={drawer === 'closed'} onClick={() => setDrawer(drawer === 'closed' ? null : 'closed')}>{words.closed(inbox.closed.length)}</button>
              )}
            </div>
          )}
          {drawer === 'snoozed' && inbox.snoozed.length > 0 && <Snoozed pm={session.id} asks={inbox.snoozed} />}
          {drawer === 'settled' && inbox.settled.length > 0 && <Settled pm={session.id} asks={inbox.settled} />}
          {drawer === 'closed' && inbox.closed.length > 0 && <Closed pm={session.id} items={inbox.closed} />}
        </>
      )}
    </section>
  );
}

const rowKey = (row: InboxRow) => (row.kind === 'ask' ? `ask:${row.ask.no}` : row.kind === 'page' ? `page:${row.page.id}` : `${row.kind}:${row.item.no}`);

function Row({ pm, row, detail }: { pm: string; row: InboxRow; detail: PmDetail }) {
  if (row.kind === 'ask') return <AskRow pm={pm} ask={row.ask} />;
  if (row.kind === 'page') return <PageRow pm={pm} page={row.page} />;
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

/** A live page to fill: the questions it asks, and Ouvrir (its window, where it is answered). */
function PageRow({ pm, page }: { pm: string; page: PmPage }) {
  const words = t.pm.page;
  return (
    <li className="cp-pm-inbox__row" data-kind="page">
      <div className="cp-pm-inbox__line">
        <span className="cp-pm-inbox__tag">{page.questions.join(' ')}</span>
        <span className="cp-pm-inbox__text">{page.title}</span>
        <button type="button" className="cp-button" data-size="small" data-variant="primary" title={words.openTitle(page.title)} onClick={() => openPmPage(pm, page.id)}>
          <PmPageIcon />{words.open}
        </button>
      </div>
      <p className="cp-pm-inbox__note">{words.states.open}</p>
    </li>
  );
}

/** An open question: its answers as buttons, or a field for an answer of the user's own; its menu. */
function AskRow({ pm, ask }: { pm: string; ask: PmAsk }) {
  const toast = useSessions((s) => s.toast);
  // in a session's panel, by its conversation
  const showInFeed = use(ShowInFeedContext);
  const [typed, setTyped] = useState('');
  // one answer per question: the buttons and the field wait for the plan to bring the row away
  // (the ref is what guards: a double click comes before the next render)
  const [sent, setSent] = useState(false);
  const sentRef = useRef(false);
  // a refused answer changes nothing in the plan: the row is still there a while later, and answers again (the server
  // still takes one answer only)
  useEffect(() => {
    if (!sent) return;
    const timer = setTimeout(() => { sentRef.current = false; setSent(false); }, ANSWER_RETRY_MS);
    return () => clearTimeout(timer);
  }, [sent]);
  const words = t.pm.inbox;
  const tag = fullAskTag(ask);
  const answer = (text: string) => {
    if (sentRef.current || !text.trim()) return;
    sentRef.current = pmAskAction(pm, ask.no, 'answer', { answer: text.trim() });
    setSent(sentRef.current);
  };
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
            ...(showInFeed ? [{ label: words.showInFeed, title: words.showInFeedTitle, icon: <MessageIcon />, run: () => showInFeed(ask.createdAt) }] : []),
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

/** The tasks finished or dropped and not archived, as the Projet section ends with them; « Tout archiver » takes them all away. */
function Closed({ pm, items }: { pm: string; items: PmItem[] }) {
  const words = t.pm.project;
  return (
    <div className="cp-pm-inbox__closed">
      <ul className="cp-pm-inbox__list" data-drawer="closed">
        {items.map((item) => (
          <li key={item.no} className="cp-pm-inbox__row" data-kind="finished">
            <p className="cp-pm-inbox__line">
              <span className="cp-pm-inbox__tag">{itemTag(item.no)}</span>
              <span className="cp-pm-inbox__text">{item.title}</span>
              {item.state === 'finished' && <CheckIcon />}
            </p>
            <p className="cp-pm-inbox__note">{item.state === 'dropped' ? words.dropped : item.done || t.pm.inbox.done}</p>
          </li>
        ))}
      </ul>
      <button type="button" className="cp-button" data-size="small" title={words.archiveAllTitle} onClick={() => pmArchive(pm, 0)}>{words.archiveAll}</button>
    </div>
  );
}
