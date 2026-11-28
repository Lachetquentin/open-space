import { useMemo } from 'react';
import { activeProject, allProjects, projectsOf } from './projects.ts';
import { useSessions } from './sessions.ts';

/**
 * The header's projects (those of the sessions there and the pinned ones), the one its filter keeps in sight ('' = all),
 * and every project the launcher offers (`known`: the saved ones too).
 */
export function useProjects() {
  const sessions = useSessions((s) => s.sessions);
  const seen = useSessions((s) => s.seen);
  const picked = useSessions((s) => s.project);
  const saved = useSessions((s) => s.preferences.projects);
  return useMemo(() => {
    const projects = projectsOf(Object.values(sessions), seen, saved);
    return { projects, project: activeProject(projects, picked), known: allProjects(Object.values(sessions), seen, saved ?? []) };
  }, [sessions, seen, picked, saved]);
}
