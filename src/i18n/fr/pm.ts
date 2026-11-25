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
  /** what Open Space sent a PM, as cards in its thread (src/state/feed.ts) */
  feed: {
    report: (worker: string) => `Rapport de ${worker}`,
    /** a worker's report by its kind (ReportKind) */
    kinds: { finished: 'Fini', waiting: 'Attend une réponse', quiet: 'Ne bouge plus', stopped: 'Arrêté', error: 'En erreur', paused: 'En pause', restarted: 'Coupé par un redémarrage' },
    aWorker: 'un worker',
    answer: 'Réponse envoyée',
    change: 'Changement envoyé',
  },
  /** above a PM's message field: its questions, the tasks they block, what its last turn finished */
  inbox: {
    label: 'À décider',
    blocked: (count: number) => plural(count, 'tâche bloquée', 'tâches bloquées'),
    finished: (count: number) => plural(count, 'tâche finie', 'tâches finies'),
    nothing: 'Rien à décider',
    more: (count: number) => `et ${count} de plus`,
    blockedBy: (tags: string) => `Bloquée par ${tags}`,
    done: 'Finie',
    typeAnswer: 'Ta réponse',
    answerLabel: (tag: string) => `Ta réponse à ${tag}`,
    recommendedAnswer: (answer: string) => `${answer} (recommandée)`,
    actions: (tag: string) => `Actions sur ${tag}`,
    snoozeHour: 'Reporter d’une heure',
    snoozeMorning: 'Reporter à demain matin',
    snoozedUntil: (when: string) => `Revient ${when}`,
    dismissTitle: 'Le PM saura que tu l’as écartée, et ne la reposera pas',
    dismissed: (tag: string) => `${tag} écartée`,
    copied: (tag: string) => `« ${tag} » copié`,
    snoozed: (count: number) => `Reportées (${count})`,
    settled: (count: number) => `Traitées (${count})`,
  },
  /** a PM's line in the session list, its workers under it */
  list: {
    fold: (name: string) => `Replier les workers de ${name}`,
    unfold: (name: string) => `Déplier les workers de ${name}`,
  },
  /** the « Projet » section of the status panel, for the PM in front */
  project: {
    title: 'Projet',
    mission: 'Mission',
    instructions: 'Instructions',
    memory: 'Mémoire',
    workers: 'Workers',
    loading: 'Lecture du plan…',
    noMission: 'Pas encore de mission',
    noInstructions: 'Aucune instruction',
    noTasks: 'Aucune tâche',
    noWorkers: 'Aucun worker',
    noMemory: 'Rien en mémoire',
    edit: (what: string) => `Modifier : ${what}`,
    save: 'Enregistrer',
    cancel: 'Annuler',
    /** the tasks, by the status shown (src/state/pm-project.ts) */
    sections: { needsYou: 'À toi', blocked: 'Bloquées', inProgress: 'En cours', idle: 'Personne dessus', waiting: 'En attente', later: 'Plus tard', done: 'Terminées' },
    dropped: 'Abandonnée',
    archiveAll: 'Tout archiver',
    archiveAllTitle: 'Retirer du plan les tâches terminées et abandonnées',
    now: 'Maintenant',
    steps: 'Étapes',
    links: 'Liens',
    questions: 'Questions',
    askStates: { open: 'Ouverte', answered: 'Répondue', done: 'Réglée', withdrawn: 'Retirée', dismissed: 'Écartée' },
    openWorker: (name: string) => `Ouvrir ${name}`,
    gone: 'Session fermée',
    addNote: 'Ajouter une note',
    editNote: 'Modifier la note',
    deleteNote: 'Supprimer la note',
  },
};
