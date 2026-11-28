import { folderName, homeRelative } from '../lib/format.ts';
import { roomSessions } from '../room/cast.ts';
import { attentionKind, type SeenSequences } from './queue.ts';
import { matchesAll } from '../../shared/search.ts';
import { isInside } from '../../shared/worktrees.ts';
import type { SavedProject, SessionInfo } from '../../shared/protocol.ts';

/**
 * A folder sessions work in, or one the user saved (Preferences.projects), as the header's filter and the launcher show it:
 * its name, how many sessions, whether one waits for the user, whether it is saved and pinned.
 */
export interface Project { folder: string; name: string; count: number; waiting: boolean; saved: boolean; pinned: boolean }

/** The folder a session works for: the one asked for in the main checkout when it runs on a branch of its own, made by Open Space or not. */
export const projectOf = (session: SessionInfo) => session.worktree?.home ?? session.checkout ?? session.cwd;

/** Whether a session belongs to the project picked in the header ('' = all of them). */
export const inProject = (session: SessionInfo, project: string) => !project || projectOf(session) === project;

/** The projects of the sessions in a room and the saved ones, each folder once. */
function merged(sessions: readonly SessionInfo[], seen: SeenSequences, saved: readonly SavedProject[]): Project[] {
  const byFolder = new Map<string, Project>();
  const projectAt = (folder: string) => byFolder.get(folder) ?? { folder, name: folderName(folder), count: 0, waiting: false, saved: false, pinned: false };
  // a trigger's finished run is in no room: counted, it would make the pills disagree with the rooms
  const placed = (['office', 'lounge', 'automata'] as const).flatMap((room) => roomSessions(sessions, seen, room).flat());
  for (const session of placed) {
    const project = projectAt(projectOf(session));
    project.count += 1;
    project.waiting ||= attentionKind(session, seen) !== null;
    byFolder.set(project.folder, project);
  }
  for (const { folder, pinned } of saved) byFolder.set(folder, { ...projectAt(folder), saved: true, pinned: pinned === true });
  return [...byFolder.values()];
}

/** Two folders with the same name show their parent too ("web/app", "mobile/app"); the pinned ones come first, then by name. */
function arranged(projects: Project[]): Project[] {
  const shared = new Set(projects.filter((project) => projects.some((other) => other !== project && other.name === project.name)).map(({ name }) => name));
  for (const project of projects) {
    if (shared.has(project.name)) project.name = project.folder.split(/[\\/]/).filter(Boolean).slice(-2).join('/');
  }
  return projects.sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));
}

/** The header's projects: those of the sessions in a room, and the pinned ones even without a session. */
export function projectsOf(sessions: readonly SessionInfo[], seen: SeenSequences, saved: readonly SavedProject[] = []): Project[] {
  return arranged(merged(sessions, seen, saved).filter((project) => project.count > 0 || project.pinned));
}

/** Every project the launcher offers: those of the sessions in a room and every saved one. */
export const allProjects = (sessions: readonly SessionInfo[], seen: SeenSequences, saved: readonly SavedProject[]) => arranged(merged(sessions, seen, saved));

/** The projects whose name or folder has every word of the query (all of them for an empty one). */
export const findProjects = (projects: readonly Project[], query: string) => (query.trim() ? projects.filter((project) => matchesAll(`${project.name} ${project.folder}`, query)) : projects);

/** The saved projects with `folder` pinned or not: a project of the sessions only is saved when pinned; unpinned, a saved one stays saved. */
export function withPin(saved: readonly SavedProject[], folder: string, pinned: boolean): SavedProject[] {
  if (!saved.some((project) => project.folder === folder)) return pinned ? [...saved, { folder, pinned: true }] : [...saved];
  return saved.map((project) => (project.folder === folder ? { folder, ...(pinned ? { pinned: true } : {}) } : project));
}

/** The saved projects with `folder` added (once). */
export const withProject = (saved: readonly SavedProject[], folder: string): SavedProject[] => (saved.some((project) => project.folder === folder) ? [...saved] : [...saved, { folder }]);

/** The saved projects without `folder`. */
export const withoutProject = (saved: readonly SavedProject[], folder: string): SavedProject[] => saved.filter((project) => project.folder !== folder);

/** The digit of ⌥1…⌥9 that opens a new session in a project: its place among the header's projects, the first nine. */
export function projectDigit(projects: readonly Project[], folder: string): number | null {
  const index = projects.findIndex((project) => project.folder === folder);
  return index >= 0 && index < 9 ? index + 1 : null;
}

/** The project picked, while two projects or more are in the header and it has a session; otherwise none: no filter, nothing hidden. */
export const activeProject = (projects: readonly Project[], picked: string) => (projects.length > 1 && projects.some((project) => project.folder === picked && project.count > 0) ? picked : '');

/** The row the arrow keys land on from `from`, a step of 1 or -1 further, skipping the disabled ones and wrapping; `from` itself when every other one is disabled. */
export function nextRow(disabled: readonly boolean[], from: number, step: 1 | -1): number {
  for (let tried = 1; tried <= disabled.length; tried += 1) {
    const index = (((from + step * tried) % disabled.length) + disabled.length) % disabled.length;
    if (!disabled[index]) return index;
  }
  return Math.max(from, 0);
}

/** Whether a saved project's folder is no longer inside the allowed folders (Settings › Folders): it cannot start a session until it is again. */
export const outsideRoots = (project: Project, roots: readonly string[], realRoots: readonly string[] = []) => project.saved && !insideRoots(project.folder, roots, realRoots);

/**
 * Whether a folder is inside the allowed folders: as the page has them (`roots`, as typed) or under their real paths
 * (`realRoots`, where the server keeps the saved projects). Both sides are compared as the page shows them: the folder
 * picker gives "~/code/app", which the server reads as the home, not "/Users/me/code/app".
 */
export const insideRoots = (folder: string, roots: readonly string[], realRoots: readonly string[] = []) => {
  const shown = homeRelative(folder);
  return [...roots, ...realRoots].some((root) => isInside(shown, homeRelative(root)));
};

/**
 * The preferences without the saved projects. The settings dialog saves its draft whole, and projects also change from the
 * launcher meanwhile: a draft carrying them would put its old copy back, so it leaves them out (the server keeps what it has).
 */
export const withoutProjects = <T extends { projects?: unknown }>({ projects: _saved, ...rest }: T): Omit<T, 'projects'> => rest;
