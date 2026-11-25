import { plural } from '../index.ts';

/** The project managers (PM): their line in the list, their project in the status panel, their questions. */
export const pm = {
  counts: {
    items: (count: number) => plural(count, 'tâche', 'tâches'),
    asks: (count: number) => plural(count, 'question', 'questions'),
    workers: (count: number) => plural(count, 'worker', 'workers'),
  },
  /** what a PM's line says first (PmLine) */
  line: { blocked: 'Bloqué', yours: 'À toi', working: (count: number) => `${count} au travail`, calm: 'Calme' },
  ask: {
    answer: 'Répondre',
    recommended: 'Recommandée',
    snooze: 'Reporter',
    wake: 'Remettre',
    dismiss: 'Écarter',
    undo: 'Annuler',
    copyTag: (tag: string) => `Copier « ${tag} »`,
  },
  project: { title: 'Projet', mission: 'Mission', instructions: 'Instructions', memory: 'Mémoire', workers: 'Workers' },
};
