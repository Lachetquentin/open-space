// What a PM's Inbox shows above its message field (src/command/PmInbox.tsx), from its plan as the server sends it
// (PmDetail): the questions waiting for the user, the tasks they block, what the last turn finished. Pure functions.
import { asksShown, itemStatus, type PmAsk, type PmDetail, type PmItem } from '../../shared/pm.ts';
import { planOf } from './pm-project.ts';

export type InboxRow = { kind: 'ask'; ask: PmAsk } | { kind: 'blocked'; item: PmItem } | { kind: 'finished'; item: PmItem };

/** How many rows the Inbox shows at most; the others are counted. */
export const INBOX_ROWS = 4;
/** How many settled questions its "Traitées" drawer keeps, the latest first. */
const SETTLED_SHOWN = 20;

export interface Inbox {
  rows: InboxRow[];
  /** the rows past INBOX_ROWS */
  more: number;
  counts: { asks: number; blocked: number; finished: number };
  /** the snoozed questions, the first back first */
  snoozed: PmAsk[];
  /** the settled questions, the latest first */
  settled: PmAsk[];
  /** when the nearest snoozed question comes back */
  nextWake?: number;
}

/**
 * The Inbox of a PM at `now`: its open questions not snoozed (a snooze past brings one back), oldest first; its blocked
 * tasks whose blocking question is not among them (snoozed); the tasks finished during its last turn or the one under way.
 */
export function pmInbox(detail: PmDetail, now: number): Inbox {
  const file = planOf(detail);
  const shown = asksShown(file, now);
  const open = [...shown.open].sort((a, b) => a.createdAt - b.createdAt || a.no - b.no);
  const listed = (item: PmItem) => open.some((ask) => ask.item === item.no && ask.holds);
  const current = detail.items.filter((item) => !item.archived);
  const blocked = current.filter((item) => itemStatus(item, file, detail.live) === 'blocked' && !listed(item));
  // a task's touchedTurn is the PM's turn under way when it last changed (the count moves at each turn's end)
  const finished = current.filter((item) => item.state === 'finished' && item.touchedTurn >= detail.turn - 1);
  const rows: InboxRow[] = [
    ...open.map((ask) => ({ kind: 'ask' as const, ask })),
    ...blocked.map((item) => ({ kind: 'blocked' as const, item })),
    ...finished.map((item) => ({ kind: 'finished' as const, item })),
  ];
  const snoozed = [...shown.snoozed].sort((a, b) => (a.snoozedUntil ?? 0) - (b.snoozedUntil ?? 0));
  const settled = [...shown.settled].sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0)).slice(0, SETTLED_SHOWN);
  return {
    rows: rows.slice(0, INBOX_ROWS), more: Math.max(0, rows.length - INBOX_ROWS),
    counts: { asks: open.length, blocked: blocked.length, finished: finished.length },
    snoozed, settled, ...(snoozed.length ? { nextWake: snoozed[0].snoozedUntil } : {}),
  };
}

/** The blocking questions of a task, by their tag's number: what a blocked row names. */
export const blockingAsks = (detail: PmDetail, item: PmItem): PmAsk[] => detail.asks.filter((ask) => ask.item === item.no && ask.holds && ask.state === 'open');

/** "Reporter d'une heure": an hour from now. */
export const inAnHour = (now: number): number => now + 3_600_000;

/** "Demain matin": 9:00 on the next day, local time. */
export function tomorrowMorning(now: number): number {
  const date = new Date(now);
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date.getTime();
}
