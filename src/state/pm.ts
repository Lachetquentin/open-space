// What the page shows of project managers (PM) and their workers (shared/pm.ts): who a worker works for, and the plans
// of the PMs this page watches, as the server sends them (pmDetail). The hook and the actions are in usePmDetail.ts.
import { create } from 'zustand';
import type { PmDetail, SessionInfo } from '../../shared/protocol.ts';

/**
 * The PM a session works for, while it still is one: a worker of a session gone or made an ordinary session again is
 * shown as any other session.
 */
export function leadOf(session: SessionInfo, sessions: Readonly<Record<string, SessionInfo>>): SessionInfo | undefined {
  const lead = session.pmOf ? sessions[session.pmOf] : undefined;
  return lead?.pm ? lead : undefined;
}

/** The plans of the PMs this page watches, by PM id: none for a PM that is no PM any more, or while the setting is off. */
export const usePmDetails = create<{ details: Readonly<Record<string, PmDetail>> }>(() => ({ details: {} }));

/** The server's pmDetail: the PM's plan now, or null once it has none to show. */
export function heardPmDetail(pm: string, detail: PmDetail | null): void {
  const { [pm]: _dropped, ...others } = usePmDetails.getState().details;
  usePmDetails.setState({ details: detail ? { ...others, [pm]: detail } : others });
}

/** How many views of the page show each PM: it is watched while one still does. */
const views = new Map<string, number>();

/** A view shows the PM; true when it was not watched yet (the list sent to the server changes). */
export function watchPm(pm: string): boolean {
  const count = views.get(pm) ?? 0;
  views.set(pm, count + 1);
  return count === 0;
}

/** A view no longer shows the PM; true when it was the last one (the list sent to the server changes). */
export function unwatchPm(pm: string): boolean {
  const count = views.get(pm) ?? 0;
  if (count <= 1) views.delete(pm);
  else views.set(pm, count - 1);
  return count === 1;
}

/** The PMs this page watches: what pmWatch sends, again after each reconnection. */
export const watchedPms = (): string[] => [...views.keys()];
