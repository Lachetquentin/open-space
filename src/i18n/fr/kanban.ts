import { plural } from '../index.ts';

export const kanban = {
  /** the agents' board: every session in a column by where its work stands (src/state/kanban.ts) */
  title: 'Suivi des agents',
  project: 'Projet',
  allProjects: 'Tous les projets',
  showStopped: 'Afficher les sessions arrêtées ou au repos',
  columns: { attention: 'À toi', working: 'Au travail', toShip: 'À livrer', ready: 'Prêtes', stopped: 'Arrêtées' },
  count: (title: string, count: number) => `${title} : ${plural(count, 'session', 'sessions')}`,
  empty: 'Rien ici',
  /** what an idle session has not landed: commits or changes on its branch, or what git says of its folder */
  toMerge: 'À fusionner',
  toPush: 'À commiter ou pousser',
  merging: 'Fusion demandée',
  ahead: (count: number) => `+${plural(count, 'commit', 'commits')}`,
  resting: 'Au repos',
  pending: (count: number) => plural(count, 'chose laissée en attente', 'choses laissées en attente'),
  model: (name: string) => `Modèle : ${name}`,
  folder: (name: string) => `Projet : ${name}`,
};
