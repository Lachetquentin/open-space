// The live pages of a PM as the page shows them (PmPageWindow.tsx, their card in the thread, the Inbox), from its plan as
// the server sends it (PmDetail.pages, without their HTML, served under /pm-pages/): which page a window shows, what it
// offers, what a page's frame may say. Pure functions.
import type { PmDetail, PmPage } from '../../shared/pm.ts';

/** Where a live page is served (server/http.ts), behind its kit and policy (server/pm-pages.ts). */
export const pmPageUrl = (pm: string, page: string) => `/pm-pages/${encodeURIComponent(pm)}/${encodeURIComponent(page)}`;

/**
 * The page shown for `id`: itself, or, once replaced, the newest of the pages that replaced it in turn (a link to a page
 * no longer kept, or going round, stops at the last one found); undefined when it is not in the plan.
 */
export function newestPage(pages: readonly PmPage[], id: string): PmPage | undefined {
  let page = pages.find((one) => one.id === id);
  const passed = new Set<string>();
  while (page?.state === 'replaced' && page.replacedBy && !passed.has(page.id)) {
    passed.add(page.id);
    const by = page.replacedBy;
    const next = pages.find((one) => one.id === by);
    if (!next) break;
    page = next;
  }
  return page;
}

/** A newer page of the same source, after `page` in the plan (the last one, not retired): what the PM shows of it now. */
function newerOf(pages: readonly PmPage[], page: PmPage): PmPage | undefined {
  return pages.slice(pages.indexOf(page) + 1).findLast((one) => one.source === page.source && one.state !== 'retired');
}

/**
 * What a page's window offers. `answer`: the page takes answers (its Send); `seen` and `reply`: a page that asks no
 * question may be marked seen, or talked about in a message to the PM; `reopen`: a page answered or seen, open again to
 * answer anew, while no newer page of its source followed it (the server's rule, server/pm-ops.ts reopenPage).
 */
export interface PageOffer { answer: boolean; seen: boolean; reply: boolean; reopen: boolean }

/**
 * What a window opened on page `id` of a PM shows. `waiting`: its plan is not here yet; `gone`: no plan any more (the PM
 * forgotten or made an ordinary session, the setting off) once there was one (`known`), or the page not in it, or retired;
 * `shown`: the page to show (the newest of those that replaced it), what it offers, and the newer page of its source that
 * followed it when it is settled.
 */
export type PageView =
  | { kind: 'waiting' }
  | { kind: 'gone' }
  | { kind: 'shown'; page: PmPage; offer: PageOffer; newer?: PmPage };

export function pageView(plan: Pick<PmDetail, 'pages'> | null, id: string, known: boolean): PageView {
  if (!plan) return { kind: known ? 'gone' : 'waiting' };
  const page = newestPage(plan.pages, id);
  if (!page || page.state === 'retired') return { kind: 'gone' };
  const open = page.state === 'open', settled = page.state === 'answered' || page.state === 'seen';
  const newer = settled ? newerOf(plan.pages, page) : undefined;
  const followed = plan.pages.slice(plan.pages.indexOf(page) + 1).some((one) => one.source === page.source);
  const quiet = page.questions.length === 0;
  return {
    kind: 'shown', page,
    offer: { answer: open, seen: open && quiet, reply: open && quiet, reopen: settled && !followed },
    ...(newer ? { newer } : {}),
  };
}

/** The pages waiting for the user's answers (open, about questions of the plan): rows of the Inbox, oldest first. */
export const pagesToFill = (plan: Pick<PmDetail, 'pages'>): PmPage[] =>
  plan.pages.filter((page) => page.state === 'open' && page.questions.length > 0).sort((a, b) => a.createdAt - b.createdAt);

/** The answers a page's kit sends on Send (`{ type: 'pm.page.submit', answers }`); null for any other message. */
export function pageSubmission(data: unknown): { answers: unknown } | null {
  if (!data || typeof data !== 'object' || (data as { type?: unknown }).type !== 'pm.page.submit') return null;
  return { answers: (data as { answers?: unknown }).answers ?? null };
}

/** A value of the answers as a line: yes or no, the values of a list, an object as JSON. */
function shownValue(value: unknown, words: { yes: string; no: string; none: string }): string {
  if (value === null || value === undefined || value === '') return words.none;
  if (typeof value === 'boolean') return value ? words.yes : words.no;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.length ? value.map((one) => shownValue(one, words)).join(', ') : words.none;
  return JSON.stringify(value);
}

/** The answers sent from a page as rows (each name with its value): the object the kit gathers, or one value alone (name ''). */
export function answerRows(answers: unknown, words: { yes: string; no: string; none: string }): [string, string][] {
  if (answers && typeof answers === 'object' && !Array.isArray(answers)) return Object.entries(answers).map(([name, value]) => [name, shownValue(value, words)]);
  return answers === undefined ? [] : [['', shownValue(answers, words)]];
}
