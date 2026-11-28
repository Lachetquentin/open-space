import { useMemo, useState } from 'react';
import { modelName } from '../../shared/usage.ts';
import { t } from '../i18n/index.ts';
import { folderName, formatAgo, since } from '../lib/format.ts';
import { useNow } from '../lib/useNow.ts';
import { cardBranch, kanbanColumns, shipDetails, type KanbanCard, type KanbanColumnId } from '../state/kanban.ts';
import { backgroundLabel, pauseLabel, stateLabel, toneOf, type Tone } from '../state/labels.ts';
import { gitSummary } from '../state/pending.ts';
import { activeProject, projectOf } from '../state/projects.ts';
import { isPaused } from '../state/queue.ts';
import { useSessions } from '../state/sessions.ts';
import { useProjects } from '../state/useProjects.ts';
import { problemText } from './BranchCard.tsx';
import { AgentIcon, AutomatonIcon, BranchIcon, CloseIcon, FolderIcon, KanbanIcon, PlanIcon } from './Icons.tsx';
import { Modal } from './Modal.tsx';
import { TagChips } from './TagChips.tsx';

/** The colour of each column, from the states' tones; the sessions to ship take the accent. */
const COLUMN_TONES: Record<KanbanColumnId, Tone | undefined> = { attention: 'permission', working: 'work', toShip: undefined, ready: 'reply', stopped: 'idle' };

/** The agents' board (⌘B, or the search palette): every session in a column by where its work stands. */
export function KanbanDialog() {
  const open = useSessions((s) => s.kanbanOpen);
  return open ? <Kanban /> : null;
}

/** What a card says of where the session is: its state in a word, a few more words when there is more, and since when. */
function cardStatus({ session, kind }: KanbanCard, column: KanbanColumnId, now: number): { word: string; tone?: Tone; details: string[]; time: string } {
  const ago = formatAgo(now - session.stateSince);
  switch (column) {
    case 'attention': return { word: t.session.states.attention[kind ?? 'finished'], tone: toneOf(session, kind), details: [], time: ago };
    case 'working': {
      const word = session.compacting ? t.session.states.compacting[session.compacting]
        : isPaused(session) && session.pausedUntil ? pauseLabel(session.pausedUntil, new Date(now)) : stateLabel(session, null);
      return { word, details: session.background ? [backgroundLabel(session.background)] : [], time: since(session.busySince ?? session.stateSince, now) };
    }
    case 'toShip': {
      const { branch, merge } = shipDetails(session);
      const branchWork = branch ? [branch.ahead > 0 ? t.kanban.ahead(branch.ahead) : '', branch.dirty > 0 ? t.branches.card.dirty(branch.dirty) : ''].filter(Boolean).join(' · ') : null;
      const problem = merge?.step === 'failed' ? problemText(merge.problem, session) : null;
      const word = merge?.step === 'failed' ? t.branches.card.failed : merge ? t.kanban.merging : branchWork ? t.kanban.toMerge : t.kanban.toPush;
      const details = [branchWork ?? (session.git ? gitSummary(session.git) : null), problem].filter((detail): detail is string => !!detail);
      return { word, details, time: ago };
    }
    case 'ready': return { word: stateLabel(session, null), details: [], time: ago };
    case 'stopped': return { word: session.resting ? t.kanban.resting : stateLabel(session, null), details: [], time: ago };
  }
}

function Card({ card, column, now, onOpen }: { card: KanbanCard; column: KanbanColumnId; now: number; onOpen: (id: string) => void }) {
  const { session } = card;
  const words = t.kanban;
  const branch = cardBranch(session);
  const folder = folderName(projectOf(session));
  const model = session.activeModel || session.model;
  const { word, tone, details, time } = cardStatus(card, column, now);
  return (
    <button type="button" className="cp-kanban__card" onClick={() => onOpen(session.id)}>
      <span className="cp-kanban__card-title">
        <span className="cp-kanban__name" title={session.name}>{session.name}</span>
        {session.trigger && <span className="cp-kanban__mark" title={t.session.status.automata}><AutomatonIcon /></span>}
        <TagChips tags={session.tags} className="cp-kanban__tag" short />
      </span>
      <span className="cp-kanban__meta">
        {branch && <span className="cp-kanban__branch" title={t.branches.icon(branch)}><BranchIcon /><span className="cp-kanban__text">{branch}</span></span>}
        <span className="cp-kanban__folder" title={words.folder(folder)}><FolderIcon /><span className="cp-kanban__text">{folder}</span></span>
        {model && <span className="cp-kanban__model" title={words.model(modelName(model))}>{modelName(model)}</span>}
        {session.subagents.length > 0 && <span className="cp-kanban__agents"><AgentIcon />{t.session.status.subagents(session.subagents.length)}</span>}
        {!!session.pending?.length && <span className="cp-kanban__pending" title={words.pending(session.pending.length)}><PlanIcon />{session.pending.length}</span>}
      </span>
      {details.map((detail) => <span key={detail} className="cp-kanban__detail" title={detail}>{detail}</span>)}
      <span className="cp-kanban__status">
        <span className="cp-kanban__state" data-tone={tone} title={word}>{word}</span>
        <span className="cp-kanban__time">{time}</span>
      </span>
    </button>
  );
}

function Kanban() {
  const sessions = useSessions((s) => s.sessions);
  const seen = useSessions((s) => s.seen);
  const openKanban = useSessions((s) => s.openKanban);
  const show = useSessions((s) => s.show);
  const { projects, project: headerProject } = useProjects();
  // starts on the project the header keeps in sight
  const [picked, setPicked] = useState(headerProject);
  const [showStopped, setShowStopped] = useState(false);
  const project = activeProject(projects, picked);
  const columns = useMemo(() => kanbanColumns(Object.values(sessions), seen, { showStopped, project }), [sessions, seen, showStopped, project]);
  // the times go on by the minute ("since 4 min")
  const now = useNow(15_000);
  const words = t.kanban;
  const close = () => openKanban(false);
  const open = (sessionId: string) => { close(); show(sessionId); };

  return (
    <Modal title={words.title} onClose={close} look="full">
      <div className="cp-kanban">
        <header className="cp-kanban__head">
          <h2 className="cp-kanban__title"><KanbanIcon />{words.title}</h2>
          <div className="cp-kanban__filters">
            {projects.length > 1 && (
              <select value={project} aria-label={words.project} onChange={(e) => setPicked(e.target.value)}>
                <option value="">{words.allProjects}</option>
                {projects.map(({ folder, name }) => <option key={folder} value={folder}>{name}</option>)}
              </select>
            )}
            <label className="cp-kanban__check">
              <input type="checkbox" checked={showStopped} onChange={(e) => setShowStopped(e.target.checked)} />{words.showStopped}
            </label>
          </div>
          <button type="button" className="cp-icon-button" aria-label={t.settings.close} title={t.settings.close} onClick={close}><CloseIcon /></button>
        </header>
        <div className="cp-kanban__columns">
          {columns.map(({ id, cards }) => (
            <section key={id} className="cp-kanban__column" data-column={id} data-tone={COLUMN_TONES[id]} aria-label={words.count(words.columns[id], cards.length)}>
              <h3 className="cp-kanban__column-title">
                <span className="cp-kanban__dot" aria-hidden="true" />{words.columns[id]}<span className="cp-kanban__count">{cards.length}</span>
              </h3>
              {cards.length ? (
                <ul className="cp-kanban__cards">
                  {cards.map((card) => <li key={card.session.id}><Card card={card} column={id} now={now} onOpen={open} /></li>)}
                </ul>
              ) : <p className="cp-kanban__empty">{words.empty}</p>}
            </section>
          ))}
        </div>
      </div>
    </Modal>
  );
}
