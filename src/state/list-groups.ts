// Focus mode's list, in groups (SessionList.tsx): by state, as in the Status panel (who works, what waits for the user,
// who left something to finish, who is done, who rests), or by project with the states in that order inside each.
// The triggers' runs stay apart, last. A project manager's (PM) workers go under it when they are in its group and project.
import { folderName } from '../lib/format.ts';
import { roomSessions } from '../room/cast.ts';
import { pendingEntries } from './pending.ts';
import { isPutOff } from './pending-later.ts';
import { projectOf } from './projects.ts';
import { ATTENTION_RANK, attentionKind, type SeenSequences } from './queue.ts';
import type { SessionInfo } from '../../shared/protocol.ts';

export const LIST_GROUPINGS = ['state', 'project'] as const;
export type ListGrouping = (typeof LIST_GROUPINGS)[number];

export type StateGroup = 'working' | 'waiting' | 'finish' | 'ready' | 'resting' | 'automata';

/** A line of the list: a session, and for a PM, the workers of its own that go under it. */
export interface ListRow { session: SessionInfo; workers?: SessionInfo[] }

/**
 * A group of the list: a state, or a project (`label`, its `folder`); `rows`: its lines, `sessions`: every session in it
 * in the order shown (each line, then its workers); `waiting`: how many wait for the user.
 */
export interface ListGroup { key: string; state?: StateGroup; label?: string; folder?: string; rows: ListRow[]; sessions: SessionInfo[]; waiting: number }

/** The session just opened from the waiting group, kept there until another is opened, at the place it had. */
export interface Kept { id: string; index: number }

const latestFirst = (list: readonly SessionInfo[]) => [...list].sort((a, b) => b.stateSince - a.stateSince);

/** A session that acts as a PM: the server sends its summary only then, never while the PM setting is off. */
const leads = (session: SessionInfo): boolean => session.pmSummary !== undefined;

/**
 * The lines of a group: with `nest`, a worker whose PM is in the same list and the same project goes under it, the others
 * stay at their place; with `leadsFirst`, the PMs come before the rest.
 */
function rowsOf(list: readonly SessionInfo[], nest: boolean, leadsFirst: boolean): ListRow[] {
  const leaders = new Map(list.filter(leads).map((session) => [session.id, session]));
  const leadOf = (session: SessionInfo) => {
    const lead = nest && !leads(session) && session.pmOf ? leaders.get(session.pmOf) : undefined;
    return lead && projectOf(lead) === projectOf(session) ? lead : undefined;
  };
  const workers = new Map<string, SessionInfo[]>();
  for (const session of list) {
    const lead = leadOf(session);
    if (lead) workers.set(lead.id, [...(workers.get(lead.id) ?? []), session]);
  }
  const rows = list.filter((session) => !leadOf(session)).map((session): ListRow => {
    const own = workers.get(session.id);
    return own ? { session, workers: own } : { session };
  });
  return leadsFirst ? [...rows.filter((row) => leads(row.session)), ...rows.filter((row) => !leads(row.session))] : rows;
}

const flat = (rows: readonly ListRow[]): SessionInfo[] => rows.flatMap((row) => [row.session, ...(row.workers ?? [])]);

/**
 * The workers shown under a PM's line: all of them while it is unfolded; folded, still those that wait for the user (a
 * question, a permission, a reply to read) and those the user has open (`openIds`), which must never hide under their PM.
 */
export function shownWorkers(row: ListRow, folded: boolean, seen: SeenSequences, openIds: ReadonlySet<string>): SessionInfo[] {
  const workers = row.workers ?? [];
  return folded ? workers.filter((session) => openIds.has(session.id) || attentionKind(session, seen) !== null) : workers;
}

/** `later`: the leftovers the user put off (pending-later.ts), whose sessions go with the done ones. */
export function listGroups(
  all: readonly SessionInfo[], seen: SeenSequences, grouping: ListGrouping, kept: Kept | null = null, later: Readonly<Record<string, string>> = {},
): ListGroup[] {
  const [queue, working, idle] = roomSessions(all, seen, 'office');
  const [resting] = roomSessions(all, seen, 'lounge');
  const automata = roomSessions(all, seen, 'automata').flat();
  const finishing = new Set(pendingEntries(idle).filter((entry) => !isPutOff(later, entry.session)).map((entry) => entry.session.id));
  // unlike the queue (the longest waiting first), the list shows the latest first, blocked sessions still on top
  const rank = (session: SessionInfo) => ATTENTION_RANK[attentionKind(session, seen) ?? 'finished'];
  const waitingNow = [...queue].sort((a, b) => rank(a) - rank(b) || b.stateSince - a.stateSince);
  let waiting = waitingNow;
  let finish = latestFirst(idle.filter((session) => finishing.has(session.id)));
  let ready = latestFirst(idle.filter((session) => !finishing.has(session.id)));
  // opened, it stops waiting: it would jump to another group under the pointer
  const moved = kept && !queue.some((session) => session.id === kept.id) ? idle.find((session) => session.id === kept.id) : undefined;
  if (moved && kept) {
    finish = finish.filter((session) => session !== moved);
    ready = ready.filter((session) => session !== moved);
    waiting = [...waitingNow.slice(0, kept.index), moved, ...waitingNow.slice(kept.index)];
  }
  const count = (list: readonly SessionInfo[]) => list.filter((session) => attentionKind(session, seen) !== null).length;
  const states: [StateGroup, SessionInfo[]][] = [['working', working], ['waiting', waiting], ['finish', finish], ['ready', ready], ['resting', latestFirst(resting)]];
  const tail: ListGroup[] = automata.length ? [{ key: 'automata', state: 'automata', rows: automata.map((session) => ({ session })), sessions: automata, waiting: count(automata) }] : [];
  if (grouping === 'state') {
    // what waits for the user stays at its place in its group, never under its PM
    return [...states.filter(([, list]) => list.length > 0).map(([state, list]) => {
      const rows = rowsOf(list, state !== 'waiting', false);
      return { key: state, state, rows, sessions: flat(rows), waiting: count(list) };
    }), ...tail];
  }
  const byKey = new Map<string, { label: string; folder: string; list: SessionInfo[]; waiting: number }>();
  for (const [, list] of states) {
    for (const session of list) {
      const folder = projectOf(session);
      const key = `project:${folder}`;
      const group = byKey.get(key) ?? { label: folderName(folder), folder, list: [], waiting: 0 };
      group.list.push(session);
      if (attentionKind(session, seen) !== null) group.waiting += 1;
      byKey.set(key, group);
    }
  }
  // what waits for the user first, then by name
  const groups = [...byKey].map(([key, { list, ...group }]): ListGroup => {
    const rows = rowsOf(list, true, true);
    return { key, ...group, rows, sessions: flat(rows) };
  }).sort((a, b) => Number(b.waiting > 0) - Number(a.waiting > 0) || (a.label ?? '').localeCompare(b.label ?? ''));
  return [...groups, ...tail];
}
