// The « Projet » section of the status panel, for the session in front when it acts as a project manager (PM): its
// mission and instructions (the pencil changes them, the PM is told), its tasks by the status shown (src/state/pm-project.ts),
// each opened in place (what it is doing now, its steps, links and questions), its workers (a click opens one) and its
// memory. Each section's fold is remembered per PM in this browser; « Tout archiver » takes the finished tasks away.
import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { t } from '../i18n/index.ts';
import { readPreference, writePreference } from '../lib/preferences.ts';
import { Fold } from '../design/Fold.tsx';
import { stateLabel } from '../state/labels.ts';
import { OPEN_SECTIONS, itemSections, type ProjectSection } from '../state/pm-project.ts';
import { attentionKind } from '../state/queue.ts';
import { useSessions } from '../state/sessions.ts';
import { pmArchive, pmEdit, usePmDetail } from '../state/usePmDetail.ts';
import { askTag, itemTag, PM_LIMITS, type PmDetail, type PmItem } from '../../shared/pm.ts';
import type { SessionInfo } from '../../shared/protocol.ts';
import { CheckIcon, ChevronDownIcon, CloseIcon, ExternalLinkIcon, PencilIcon, PlusIcon, PullRequestIcon } from './Icons.tsx';

// each PM's folds, by section: only what the user changed from the defaults
const FOLDS_KEY = 'pmProjectFolds';
type Folds = Readonly<Record<string, Readonly<Record<string, boolean>>>>;

/** One section's fold for this PM, remembered with the others; `open`: open until the user folds it. */
function useFolds(pm: string) {
  const [folds, setFolds] = useState(() => readPreference<Folds>(FOLDS_KEY, {})[pm] ?? {});
  const folded = (key: string, open = false) => folds[key] ?? !open;
  const toggle = (key: string, open = false) => {
    const next = { ...folds, [key]: !folded(key, open) };
    // the PMs gone take their folds with them
    const sessions = useSessions.getState().sessions;
    const kept = Object.fromEntries(Object.entries(readPreference<Folds>(FOLDS_KEY, {})).filter(([id]) => id !== pm && sessions[id]?.pm));
    writePreference(FOLDS_KEY, { ...kept, [pm]: next });
    setFolds(next);
  };
  return { folded, toggle };
}

/** A text of the PM's plan, its pencil turning it into a field; Enter (with ⌘ or Ctrl on several lines) saves, Escape gives up. */
function EditableText({ label, value, empty, max, lines = false, onSave }: { label: string; value: string; empty: string; max: number; lines?: boolean; onSave: (text: string) => void }) {
  const words = t.pm.project;
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <div className="cp-pm__text">
        <p className="cp-pm__value" data-empty={!value}>{value || empty}</p>
        <button type="button" className="cp-pm__icon" aria-label={words.edit(label)} title={words.edit(label)} onClick={() => setDraft(value)}><PencilIcon /></button>
      </div>
    );
  }
  const save = (event?: FormEvent) => {
    event?.preventDefault();
    if (draft.trim() !== value) onSave(draft.trim());
    setDraft(null);
  };
  const keys = (event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (event.key === 'Escape') { event.stopPropagation(); setDraft(null); }
    if (lines && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) save();
  };
  return (
    <form className="cp-pm__edit" onSubmit={save}>
      {lines
        ? <textarea aria-label={label} value={draft} maxLength={max} rows={3} autoFocus onChange={(event) => setDraft(event.target.value)} onKeyDown={keys} />
        : <input aria-label={label} value={draft} maxLength={max} autoFocus onChange={(event) => setDraft(event.target.value)} onKeyDown={keys} />}
      <span className="cp-pm__edit-actions">
        <button type="button" className="cp-button" data-variant="quiet" onClick={() => setDraft(null)}>{words.cancel}</button>
        <button type="submit" className="cp-button" data-variant="primary">{words.save}</button>
      </span>
    </form>
  );
}

/** A task, its tag and title; opened, what it is doing now, its steps, its links and its questions. */
function Task({ item, detail }: { item: PmItem; detail: PmDetail }) {
  const words = t.pm.project;
  const [open, setOpen] = useState(false);
  const asks = detail.asks.filter((ask) => ask.item === item.no);
  const now = item.state === 'finished' ? item.done : item.now;
  return (
    <li className="cp-pm__task" data-open={open}>
      <button type="button" className="cp-pm__task-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="cp-pm__tag">{itemTag(item.no)}</span>
        <span className="cp-pm__task-title">{item.title}</span>
        {item.state === 'dropped' && <span className="cp-pm__muted">{words.dropped}</span>}
      </button>
      {open && (
        <div className="cp-pm__task-body">
          {now && <p className="cp-pm__now"><span className="cp-pm__muted">{words.now}</span> {now}</p>}
          {item.steps.length > 0 && (
            <ul className="cp-pm__steps" aria-label={words.steps}>
              {item.steps.map((step) => (
                <li key={`${step.at}-${step.text}`} data-done={step.done} data-chore={step.chore}>
                  <span className="cp-pm__step-mark" aria-hidden="true">{step.done && <CheckIcon />}</span>{step.text}
                </li>
              ))}
            </ul>
          )}
          {item.links.length > 0 && (
            <ul className="cp-pm__links" aria-label={words.links}>
              {item.links.map((link) => (
                <li key={link.url}>
                  <a href={link.url} target="_blank" rel="noopener noreferrer">{link.kind === 'pr' ? <PullRequestIcon /> : <ExternalLinkIcon />}{link.title || link.url}</a>
                </li>
              ))}
            </ul>
          )}
          {asks.length > 0 && (
            <ul className="cp-pm__asks" aria-label={words.questions}>
              {asks.map((ask) => (
                <li key={ask.no} data-state={ask.state}>
                  <span className="cp-pm__tag">{askTag(ask.no)}</span>
                  <span className="cp-pm__ask-title">{ask.title}</span>
                  <span className="cp-pm__muted">{ask.answer ?? words.askStates[ask.state]}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/** A worker of the PM: its name, its task, what it is doing, its last report; a click opens it. */
function Worker({ id, item, report }: { id: string; item?: number; report?: string }) {
  const words = t.pm.project;
  const session: SessionInfo | undefined = useSessions((s) => s.sessions[id]);
  const seen = useSessions((s) => s.seen);
  const show = useSessions((s) => s.show);
  const kind = session ? attentionKind(session, seen) : null;
  return (
    <li>
      <button type="button" className="cp-pm__worker" data-kind={kind ?? (session?.state === 'work' ? 'working' : 'idle')} disabled={!session}
        title={session ? words.openWorker(session.name) : words.gone} onClick={() => session && show(id)}>
        <span className="cp-pm__worker-line">
          <span className="cp-pm__worker-name">{session?.name ?? words.gone}</span>
          {item !== undefined && <span className="cp-pm__tag">{itemTag(item)}</span>}
          {session && <span className="cp-pm__muted">{stateLabel(session, kind)}</span>}
        </span>
        {report && <span className="cp-pm__report" title={report}>{report}</span>}
      </button>
    </li>
  );
}

/** The PM's memory: each note changed or deleted in place, a field to add one. */
function Memory({ pm, notes }: { pm: string; notes: PmDetail['memory'] }) {
  const words = t.pm.project;
  const [draft, setDraft] = useState('');
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (draft.trim() && pmEdit(pm, { memory: { op: 'add', text: draft.trim() } })) setDraft('');
  };
  return (
    <>
      {notes.length === 0 && <p className="cp-pm__muted">{words.noMemory}</p>}
      <ul className="cp-pm__notes">
        {notes.map((note, index) => (
          <li key={`${note.at}-${note.text}`} className="cp-pm__note">
            <EditableText label={words.editNote} value={note.text} empty="" max={PM_LIMITS.note} onSave={(text) => pmEdit(pm, { memory: text ? { op: 'edit', index, text } : { op: 'delete', index } })} />
            <button type="button" className="cp-pm__icon" aria-label={words.deleteNote} title={words.deleteNote} onClick={() => pmEdit(pm, { memory: { op: 'delete', index } })}><CloseIcon /></button>
          </li>
        ))}
      </ul>
      {notes.length < PM_LIMITS.memory && (
        <form className="cp-pm__add" onSubmit={add}>
          <input aria-label={words.addNote} placeholder={words.addNote} value={draft} maxLength={PM_LIMITS.note} onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" className="cp-pm__icon" aria-label={words.addNote} title={words.addNote} disabled={!draft.trim()}><PlusIcon /></button>
        </form>
      )}
    </>
  );
}

/** The PM's plan in the status panel, folded with the panel's other groups (`folded`, `onFold`). */
export function PmProject({ pm, folded, onFold }: { pm: SessionInfo; folded: boolean; onFold: () => void }) {
  const words = t.pm.project;
  const detail = usePmDetail(pm.id);
  const folds = useFolds(pm.id);
  const fold = (key: string, title: string, note: ReactNode, children: ReactNode, open = false, actions?: ReactNode) => (
    <Fold key={key} title={title} note={note} marker={<ChevronDownIcon />} folded={folds.folded(key, open)} onToggle={() => folds.toggle(key, open)} actions={actions}>
      {children}
    </Fold>
  );
  const sectionOpen = (section: ProjectSection) => OPEN_SECTIONS.includes(section);
  const workers = detail?.workers.filter((worker) => !worker.resolvedAt) ?? [];
  return (
    <div className="cp-pm" data-folded={folded}>
      <Fold title={words.title} note={pm.name} marker={<ChevronDownIcon />} folded={folded} onToggle={onFold}>
        {!detail ? <p className="cp-pm__muted">{words.loading}</p> : (
          <div className="cp-pm__body">
            <div className="cp-pm__field">
              <span className="cp-pm__label">{words.mission}</span>
              <EditableText label={words.mission} value={detail.mission} empty={words.noMission} max={PM_LIMITS.mission} lines onSave={(mission) => pmEdit(pm.id, { mission })} />
            </div>
            <div className="cp-pm__field">
              <span className="cp-pm__label">{words.instructions}</span>
              <EditableText label={words.instructions} value={detail.instructions} empty={words.noInstructions} max={PM_LIMITS.instructions} lines onSave={(instructions) => pmEdit(pm.id, { instructions })} />
            </div>
            {itemSections(detail).map(({ section, items }) => fold(
              section, words.sections[section], items.length,
              <ul className="cp-pm__tasks">{items.map((item) => <Task key={item.no} item={item} detail={detail} />)}</ul>,
              sectionOpen(section),
              section === 'done' && <button type="button" className="cp-pm__action" title={words.archiveAllTitle} onClick={() => pmArchive(pm.id, 0)}>{words.archiveAll}</button>,
            ))}
            {detail.items.every((item) => item.archived) && <p className="cp-pm__muted">{words.noTasks}</p>}
            {fold('workers', words.workers, workers.length, workers.length === 0 ? <p className="cp-pm__muted">{words.noWorkers}</p> : (
              <ul className="cp-pm__workers">{workers.map((worker) => <Worker key={worker.session} id={worker.session} item={worker.item} report={worker.lastReport?.line} />)}</ul>
            ), true)}
            {fold('memory', words.memory, detail.memory.length, <Memory pm={pm.id} notes={detail.memory} />)}
          </div>
        )}
      </Fold>
    </div>
  );
}
