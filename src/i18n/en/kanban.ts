import { plural, type Dictionary } from '../index.ts';

export const kanban: Dictionary['kanban'] = {
  title: 'Agent board',
  project: 'Project',
  allProjects: 'All projects',
  showStopped: 'Show stopped or resting sessions',
  columns: { attention: 'Needs you', working: 'Working', toShip: 'To ship', ready: 'Ready', stopped: 'Stopped' },
  count: (title, count) => `${title}: ${plural(count, 'session', 'sessions')}`,
  empty: 'Nothing here',
  toMerge: 'To merge',
  toPush: 'To commit or push',
  merging: 'Merge asked',
  ahead: (count) => `+${plural(count, 'commit', 'commits')}`,
  resting: 'Resting',
  pending: (count) => plural(count, 'thing left pending', 'things left pending'),
  model: (name) => `Model: ${name}`,
  folder: (name) => `Project: ${name}`,
};
