// A PM's plan as the status panel shows it (PmProject.tsx): its tasks in sections by the status shown (shared/pm.ts),
// the ones for the user first, the finished ones last; which sections start open.
import { itemStatus, type PmDetail, type PmFile, type PmItem, type ShownStatus } from '../../shared/pm.ts';

export const PROJECT_SECTIONS = ['needsYou', 'blocked', 'inProgress', 'idle', 'waiting', 'later', 'done'] as const;
export type ProjectSection = (typeof PROJECT_SECTIONS)[number];

/** Open until the user folds them; the others start folded. */
export const OPEN_SECTIONS: readonly ProjectSection[] = ['blocked', 'inProgress'];

/** The plan as a file, for the pure logic of shared/pm.ts: the page never gets the report keys. */
export const planOf = (detail: PmDetail): PmFile => ({ ...detail, reports: [] });

// a dropped task ends with the finished ones, which the user archives together
const sectionOf = (status: ShownStatus): ProjectSection => (status === 'dropped' ? 'done' : status);

/** The tasks not archived at `now`, in the sections that hold some, in the order of PROJECT_SECTIONS, each in the plan's order. */
export function itemSections(detail: PmDetail, now: number): { section: ProjectSection; items: PmItem[] }[] {
  const plan = planOf(detail);
  const bySection = new Map<ProjectSection, PmItem[]>();
  for (const item of detail.items) {
    if (item.archived) continue;
    const section = sectionOf(itemStatus(item, plan, detail.live, now));
    bySection.set(section, [...(bySection.get(section) ?? []), item]);
  }
  return PROJECT_SECTIONS.flatMap((section) => {
    const items = bySection.get(section);
    return items ? [{ section, items }] : [];
  });
}
