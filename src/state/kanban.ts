// The agents' board (KanbanDialog.tsx): every session in one column by where its work stands, from what waits for the
// user to what is done. Pure functions; the rules of the queue and of work come from queue.ts.
import type { SessionInfo } from '../../shared/protocol.ts';
import { inProject } from './projects.ts';
import { type AttentionKind, attentionQueue, otherSessions, type SeenSequences } from './queue.ts';
import { hasNews } from './worktrees.ts';

/** `toShip`: idle, with work not landed yet; `stopped`: closed, done, a seen error, or put to rest (shown on demand). */
export const KANBAN_COLUMNS = ['attention', 'working', 'toShip', 'ready', 'stopped'] as const;
export type KanbanColumnId = (typeof KANBAN_COLUMNS)[number];

/** A session on the board; `kind` says why it waits for the user, in the first column only. */
export interface KanbanCard { session: SessionInfo; kind: AttentionKind | null }
export interface KanbanColumn { id: KanbanColumnId; cards: KanbanCard[] }

export interface KanbanFilter {
  /** the stopped and resting sessions get a column of their own */
  showStopped: boolean;
  /** the project's folder (projects.ts projectOf), '' for every project */
  project: string;
}

/**
 * Work an idle session has not landed: commits or changes on its branch, files git says are not committed or commits
 * not pushed in its folder, or a merge of its branch asked for or failed.
 */
export function hasUnlandedWork(session: SessionInfo): boolean {
  const { worktree, git } = session;
  if (worktree && (worktree.merge || hasNews(worktree.status))) return true;
  return !!git && (git.dirty > 0 || git.unpushed > 0);
}

/** What a "to ship" card says of its work: the branch's commits and changes (null when it has none), and the merge asked for or failed. */
export function shipDetails(session: SessionInfo): { branch: { ahead: number; dirty: number } | null; merge: NonNullable<SessionInfo['worktree']>['merge'] } {
  const { worktree } = session;
  const status = worktree?.status;
  return { branch: status && hasNews(status) ? { ahead: status.ahead, dirty: status.dirty } : null, merge: worktree?.merge };
}

/** The branch a card shows: its own branch for an isolated session, else the one its folder is on; null outside git or detached. */
export const cardBranch = (session: SessionInfo): string | null => session.worktree?.branch || session.git?.branch || null;

/**
 * The board's columns, in order: what waits for the user (the queue's order), what works, the idle sessions with work
 * to land, the other idle ones, and, when asked for, the stopped and resting ones. Each session is in one column at
 * most; a resting one is with the stopped ones, as it is in the break room, unless it needs the user.
 */
export function kanbanColumns(sessions: readonly SessionInfo[], seen: SeenSequences, { showStopped, project }: KanbanFilter): KanbanColumn[] {
  const shown = sessions.filter((session) => inProject(session, project));
  const awake = shown.filter((session) => !session.resting);
  const attention = attentionQueue(shown, seen);
  const { working, idle, stopped } = otherSessions(awake, seen);
  const card = (session: SessionInfo): KanbanCard => ({ session, kind: null });
  const columns: KanbanColumn[] = [
    { id: 'attention', cards: attention.map(({ session, kind }) => ({ session, kind })) },
    { id: 'working', cards: working.map(card) },
    { id: 'toShip', cards: idle.filter(hasUnlandedWork).map(card) },
    { id: 'ready', cards: idle.filter((session) => !hasUnlandedWork(session)).map(card) },
  ];
  if (!showStopped) return columns;
  const queued = new Set(attention.map(({ session }) => session.id));
  const resting = shown.filter((session) => session.resting && !queued.has(session.id));
  const asleep = [...stopped, ...resting].sort((a, b) => b.stateSince - a.stateSince);
  return [...columns, { id: 'stopped', cards: asleep.map(card) }];
}
