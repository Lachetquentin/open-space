import { plural, type Dictionary } from '../index.ts';

export const pm: Dictionary['pm'] = {
  counts: {
    items: (count: number) => plural(count, 'task', 'tasks'),
    asks: (count: number) => plural(count, 'question', 'questions'),
    workers: (count: number) => plural(count, 'worker', 'workers'),
  },
  line: { blocked: 'Blocked', yours: 'For you', working: (count: number) => `${count} at work`, calm: 'Calm' },
  ask: {
    answer: 'Answer',
    recommended: 'Recommended',
    snooze: 'Snooze',
    wake: 'Bring back',
    dismiss: 'Dismiss',
    undo: 'Undo',
    copyTag: (tag: string) => `Copy “${tag}”`,
  },
  project: { title: 'Project', mission: 'Mission', instructions: 'Instructions', memory: 'Memory', workers: 'Workers' },
};
