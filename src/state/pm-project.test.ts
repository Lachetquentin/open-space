import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emptyPm, type PmDetail, type PmItem } from '../../shared/pm.ts';
import { itemSections } from './pm-project.ts';

const item = (no: number, extra: Partial<PmItem> = {}): PmItem =>
  ({ no, title: `W${no}`, state: 'moving', now: '', done: '', steps: [], waits: [], links: [], touchedTurn: 0, createdAt: 1, updatedAt: 1, ...extra });

describe('a PM’s tasks in the status panel', () => {
  it('blocked before in progress, dropped with the finished ones at the end, archived ones gone', () => {
    const { reports: _reports, ...file } = emptyPm();
    const detail: PmDetail = {
      ...file, pm: 'pm', turn: 5, live: [],
      items: [item(1, { state: 'finished' }), item(2, { touchedTurn: 5 }), item(3, { state: 'dropped' }), item(4, { state: 'finished', archived: true }), item(5)],
      asks: [{ no: 1, item: 5, title: 'Which?', detail: '', answers: [], holds: true, state: 'open', createdAt: 1 }],
    };
    assert.deepEqual(itemSections(detail).map(({ section, items }) => [section, items.map((one) => one.no)]), [['blocked', [5]], ['inProgress', [2]], ['done', [1, 3]]]);
  });
});
