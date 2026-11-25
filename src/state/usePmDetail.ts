// The plan of a PM for the views that show it, and what the user does with it. The server ignores each request while the
// PM setting is off or for a session that is no PM (server/pm-desk.ts); a refusal comes back as a toast.
import { useEffect } from 'react';
import type { PmAskAction, PmDetail, PmMemoryOp } from '../../shared/protocol.ts';
import { unwatchPm, usePmDetails, watchedPms, watchPm } from './pm.ts';
import { useSessions } from './sessions.ts';

const send = useSessions.getState;
const sendWatched = () => send().send({ t: 'pmWatch', pms: watchedPms() });

/** The plan of PM `pm` (null: none), watched while the calling view is mounted: the server sends it now and at each change. */
export function usePmDetail(pm: string | null): PmDetail | null {
  const detail = usePmDetails((state) => (pm ? state.details[pm] : undefined));
  useEffect(() => {
    if (!pm) return;
    if (watchPm(pm)) sendWatched();
    return () => { if (unwatchPm(pm)) sendWatched(); };
  }, [pm]);
  return detail ?? null;
}

/** Answers question `ask` of the PM (`answer` needed), snoozes it until `until` (epoch ms), wakes it, dismisses it or takes that back. */
export function pmAskAction(pm: string, ask: number, action: PmAskAction, extra: { answer?: string; until?: number } = {}): boolean {
  return send().send({ t: 'pmAsk', pm, ask, action, ...(extra.answer !== undefined ? { answer: extra.answer } : {}), ...(extra.until !== undefined ? { until: extra.until } : {}) });
}

/** Changes the PM's mission, its instructions or a note of its memory (`index` from 0); the PM is told. */
export function pmEdit(pm: string, change: { mission?: string; instructions?: string; memory?: PmMemoryOp }): boolean {
  return send().send({ t: 'pmEdit', pm, ...change });
}

/** Archives a finished or dropped task of the PM; 0: all of them. */
export function pmArchive(pm: string, item: number): boolean {
  return send().send({ t: 'pmItemArchive', pm, item });
}
