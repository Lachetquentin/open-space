// A PM's live page in a window over the office (one at a time, opened from its card in the thread or its Inbox row):
// the page in a frame sandboxed without allow-same-origin (an opaque origin, no cookie, served under /pm-pages/ behind its
// kit and policy, server/pm-pages.ts), under a title bar that carries it, resized by its edges and corners, folded to its
// title. It stays open while the user types elsewhere, and follows its plan (usePmDetail): a page replaced by a newer
// one of its source shows the newer one, a page no longer there says so.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PmPage } from '../../shared/pm.ts';
import { t } from '../i18n/index.ts';
import { readPreference, writePreference } from '../lib/preferences.ts';
import { MOD_HEAD, modBox, NOT_PLACED, openingSpots, resizeMod, type ModPlacement } from '../state/mods.ts';
import { pageSubmission, pageView, pmPageUrl, type PageView } from '../state/pm-pages.ts';
import { closePmPage, openPmPage, usePmPageWindow } from '../state/pm.ts';
import type { Box } from '../state/room-frame.ts';
import { useSessions } from '../state/sessions.ts';
import { usePmDetail } from '../state/usePmDetail.ts';
import type { Edge } from '../state/windows.ts';
import { boxVariables, floatingSurface } from './boxes.ts';
import { FreeHandles } from './FreeHandles.tsx';
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, PmPageIcon } from './Icons.tsx';
import { useFreeCarry } from './useFreeCarry.ts';
import { currentTheme, onThemeChange } from './useModPage.tsx';
import { INTERACTIVE } from './useWindowDrag.ts';

/** the size it opens at, its title bar aside */
const SIZE = { width: 520, height: 600 };
/** where the user left it, in this browser: the same place for every page */
const PLACEMENT = 'pm-page-placement';
/** loaded without its kit saying it is there: the server did not serve the page (gone, the setting off) */
const READY_GRACE_MS = 1500;
/** how long answers sent wait for the plan to say the page answered before the page can send again (a refusal changes nothing) */
const ANSWER_RETRY_MS = 5000;

/** The live page open, if any. */
export function PmPageWindow() {
  const open = usePmPageWindow((s) => s.open);
  return open ? <PageWindow key={open.pm} pm={open.pm} asked={open.page} /> : null;
}

function PageWindow({ pm, asked }: { pm: string; asked: string }) {
  const words = t.pm.page;
  const detail = usePmDetail(pm);
  const lead = useSessions((s) => s.sessions[pm]);
  // once its plan came, no plan (the PM forgotten or made an ordinary session, the setting off) leaves the page unavailable
  const known = useRef(false);
  if (detail) known.current = true;
  const view = pageView(detail, asked, known.current || !lead);
  const shown = view.kind === 'shown' ? view.page : null;
  const shownId = shown?.id ?? null;

  const [placement, setPlacement] = useState<ModPlacement>(() => readPreference(PLACEMENT, NOT_PLACED));
  const [, setSurface] = useState(floatingSurface);
  const spot = openingSpots([SIZE], floatingSurface())[0];
  const box = modBox(SIZE, placement, spot, floatingSurface());
  const place = (next: ModPlacement) => { setPlacement(next); writePreference(PLACEMENT, next); };
  const [moved, setMoved] = useState<Box | null>(null);
  const free = useFreeCarry(box, {
    resize: (start, edge, dx, dy) => resizeMod(start, edge, dx, dy, floatingSurface()),
    move: setMoved,
    drop: (edge) => {
      if (!moved) return;
      setMoved(null);
      place({ ...placement, left: moved.left, top: moved.top, size: edge ? { width: moved.width, height: moved.height - MOD_HEAD } : placement.size });
    },
  });
  const shownBox = moved ?? box;
  const folded = placement.folded;

  // a smaller page: the window stays within reach
  useEffect(() => {
    const keep = () => setSurface(floatingSurface());
    window.addEventListener('resize', keep);
    return () => window.removeEventListener('resize', keep);
  }, []);

  const grab = (edge: Edge | null, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (!edge && (event.target as HTMLElement).closest(INTERACTIVE))) return;
    free.grab(edge, event);
  };
  const fold = () => place({ ...placement, folded: !placement.folded });

  // the frame of the page shown, and whether its kit said it is there
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const grace = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [silent, setSilent] = useState(false);
  // one answer at a time: a double click, a second Send, wait for the plan to say the page answered. The ref is what
  // guards (two messages can come before the next render); the state shows it. The kit holds its own Send until told.
  const [sent, setSent] = useState(false);
  const sentRef = useRef(false);
  const unsend = () => {
    sentRef.current = false;
    setSent(false);
    frame.current?.contentWindow?.postMessage({ openSpace: 'unsent' }, '*');
  };
  // a new page shown, or its state changed: it may send again
  // biome-ignore lint/correctness/useExhaustiveDependencies: unsend reads refs and a state setter only
  useEffect(() => { unsend(); }, [shownId, shown?.state]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: unsend reads refs and a state setter only
  useEffect(() => {
    if (!sent) return;
    const timer = setTimeout(unsend, ANSWER_RETRY_MS);
    return () => clearTimeout(timer);
  }, [sent]);
  const answer = useRef<(answers: unknown) => void>(() => {});
  answer.current = (answers) => {
    if (sentRef.current) return;
    // nothing went (the page no longer open, the connection down): the kit may send again
    if (shown?.state !== 'open' || !useSessions.getState().send({ t: 'pmPage', pm, page: shown.id, action: 'answer', answers })) {
      frame.current?.contentWindow?.postMessage({ openSpace: 'unsent' }, '*');
      return;
    }
    sentRef.current = true;
    setSent(true);
  };
  const tellTheme = () => frame.current?.contentWindow?.postMessage({ openSpace: 'theme', ...currentTheme() }, '*');

  // listening before the frame loads (its kit says it is there from its head): only its own frame is heard, and the
  // messages go to it by '*', its origin being opaque
  // biome-ignore lint/correctness/useExhaustiveDependencies: tellTheme reads the frame's ref only
  useLayoutEffect(() => {
    if (!shownId) return;
    ready.current = false;
    setSilent(false);
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      if ((event.data as { openSpace?: unknown } | null)?.openSpace === 'ready') { ready.current = true; setSilent(false); tellTheme(); return; }
      const submitted = pageSubmission(event.data);
      if (submitted) answer.current(submitted.answers);
    };
    window.addEventListener('message', onMessage);
    const restyle = onThemeChange(tellTheme);
    return () => { window.removeEventListener('message', onMessage); restyle(); clearTimeout(grace.current); };
  }, [shownId]);
  const loaded = () => {
    tellTheme();
    clearTimeout(grace.current);
    grace.current = setTimeout(() => { if (!ready.current) setSilent(true); }, READY_GRACE_MS);
  };

  const title = shown?.title ?? words.windowLabel('');
  const unavailable = view.kind === 'gone' || silent;
  return (
    <section
      className="cp-mod cp-pm-page" aria-label={words.windowLabel(shown?.title ?? '')} data-folded={folded} data-moving={!!moved || undefined}
      style={boxVariables(shownBox)}
      onPointerMove={free.drag} onPointerUp={free.drop} onPointerCancel={free.drop}
    >
      <header className="cp-mod__head" onPointerDown={(event) => grab(null, event)} onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest(INTERACTIVE)) fold(); }}>
        <span className="cp-mod__icon"><PmPageIcon /></span>
        <span className="cp-pm-page__titles">
          <span className="cp-mod__title">{shown ? title : words.of(lead?.name ?? '')}</span>
          {shown && lead && <span className="cp-pm-page__of">{words.of(lead.name)}</span>}
        </span>
        <div className="cp-detail__controls">
          <button type="button" className="cp-icon-button" data-variant="outlined" aria-label={folded ? words.unfold : words.fold} title={folded ? words.unfold : words.fold} onClick={fold}>
            {folded ? <ChevronDownIcon /> : <ChevronUpIcon />}
          </button>
          <button type="button" className="cp-icon-button" data-variant="outlined" aria-label={words.close} title={words.close} onClick={closePmPage}><CloseIcon /></button>
        </div>
      </header>
      {/* folded, the frame stays (hidden): what was typed in it is still there once unfolded */}
      <div className="cp-pm-page__body" hidden={folded}>
        {unavailable ? <p className="cp-pm-page__gone">{words.gone}</p> : !shown ? <p className="cp-pm-page__gone">{words.loading}</p> : (
          <iframe key={shown.id} ref={frame} className="cp-mod__page" title={shown.title} src={pmPageUrl(pm, shown.id)} sandbox="allow-scripts" referrerPolicy="no-referrer" onLoad={loaded} />
        )}
        {!unavailable && view.kind === 'shown' && <PageFoot pm={pm} lead={lead?.name ?? ''} view={view} sent={sent} />}
      </div>
      {!folded && <FreeHandles onPull={grab} />}
    </section>
  );
}

/** Under the page: what became of it, and what the user may do with it besides answering in it. */
function PageFoot({ pm, lead, view, sent }: { pm: string; lead: string; view: PageView & { kind: 'shown' }; sent: boolean }) {
  const words = t.pm.page;
  const { page, offer, newer } = view;
  const send = useSessions((s) => s.send);
  const act = (action: 'seen' | 'reopen') => send({ t: 'pmPage', pm, page: page.id, action });
  const note = page.state === 'open' ? (offer.seen ? null : sent ? words.sending : words.fill)
    : page.state === 'answered' ? words.answered : page.state === 'seen' ? words.sawIt : words.replacedNote;
  return (
    <footer className="cp-pm-page__foot">
      {note && <p className="cp-pm-page__note" aria-live="polite">{note}</p>}
      {newer && <p className="cp-pm-page__note">{words.newerNote}</p>}
      {(offer.seen || offer.reopen || newer) && (
        <div className="cp-pm-page__actions">
          {offer.seen && <button type="button" className="cp-button" data-size="small" data-variant="primary" title={words.seenTitle} onClick={() => act('seen')}>{words.seen}</button>}
          {offer.reopen && <button type="button" className="cp-button" data-size="small" title={words.reopenTitle} onClick={() => act('reopen')}>{words.reopen}</button>}
          {newer && <button type="button" className="cp-button" data-size="small" onClick={() => openPmPage(pm, newer.id)}>{words.newer}</button>}
        </div>
      )}
      {offer.reply && <Reply pm={pm} lead={lead} page={page} />}
    </footer>
  );
}

/** A message to the PM about a page that asks nothing, from the window: the page named before what the user writes. */
function Reply({ pm, lead, page }: { pm: string; lead: string; page: PmPage }) {
  const words = t.pm.page;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const sendText = useSessions((s) => s.sendText);
  const toast = useSessions((s) => s.toast);
  const reply = () => {
    if (!text.trim()) return;
    if (sendText(pm, `${words.replyAbout(page.title, page.id)}\n\n${text.trim()}`)) { setText(''); setOpen(false); toast('info', words.replied(lead)); }
  };
  if (!open) return <div className="cp-pm-page__actions"><button type="button" className="cp-button" data-size="small" onClick={() => setOpen(true)}>{words.reply}</button></div>;
  return (
    <div className="cp-pm-page__reply">
      <textarea
        className="cp-pm-page__field" value={text} aria-label={words.replyLabel} placeholder={words.replyPlaceholder} rows={2} autoFocus
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); reply(); } }}
      />
      <button type="button" className="cp-button" data-size="small" data-variant="primary" disabled={!text.trim()} onClick={reply}>{words.replySend}</button>
    </div>
  );
}
