import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SessionInfo } from '../../shared/protocol.ts';
import { listGroups, shownWorkers } from './list-groups.ts';

const session = (id: string, cwd: string, extra: Partial<SessionInfo> = {}) =>
  ({ id, name: id, cwd, state: 'wait', turns: 1, permissions: [], subagents: [], createdAt: 0, stateSince: 0, lastSeq: 1, ...extra }) as unknown as SessionInfo;

const keys = (groups: ReturnType<typeof listGroups>) => groups.map((group) => [group.key, group.sessions.map((each) => each.id)]);

describe('the list in groups', () => {
  const unseen = session('a', '/code/app', { tags: ['pipou'] });
  const read = session('b', '/code/app', { tags: ['pipou'], stateSince: 5 });
  const other = session('c', '/code/site', { tags: ['blog'] });
  const resting = session('d', '/code/site', { resting: true } as Partial<SessionInfo>);
  const seen = { b: 1, c: 1, d: 1 };

  it('by state: what waits for the user, then who is ready, then who rests', () => {
    assert.deepEqual(keys(listGroups([unseen, read, other, resting], seen, 'state')), [['waiting', ['a']], ['ready', ['b', 'c']], ['resting', ['d']]]);
  });

  it('by project: what waits first, the states in order inside', () => {
    const byProject = listGroups([unseen, read, other, resting], seen, 'project');
    assert.deepEqual(keys(byProject), [['project:/code/app', ['a', 'b']], ['project:/code/site', ['c', 'd']]]);
    assert.deepEqual(byProject.map((group) => group.waiting), [1, 0]);
    assert.deepEqual(byProject.map((group) => group.folder), ['/code/app', '/code/site']);
  });

  it('by state: who works first, and a read session that left something to do goes to finish until put off', () => {
    const working = session('w', '/code/app', { state: 'work' });
    const leftover = session('f', '/code/app', { stateSince: 3, pending: [{ id: 'p', text: 'Mettre la clé', since: 1 }] } as Partial<SessionInfo>);
    const all = [unseen, read, working, leftover];
    assert.deepEqual(keys(listGroups(all, { ...seen, f: 1 }, 'state')), [['working', ['w']], ['waiting', ['a']], ['finish', ['f']], ['ready', ['b']]]);
    const later = { f: JSON.stringify([['p'], null]) };
    assert.deepEqual(keys(listGroups(all, { ...seen, f: 1 }, 'state', null, later)), [['working', ['w']], ['waiting', ['a']], ['ready', ['b', 'f']]]);
  });

  it('keeps the session just opened where it was, until another is opened', () => {
    const first = session('e', '/code/app');
    const opened = { ...unseen, stateSince: 9 };
    // seen now: it would move to the ready ones
    assert.deepEqual(keys(listGroups([first, opened], { a: 1 }, 'state'))[0], ['waiting', ['e']]);
    assert.deepEqual(keys(listGroups([first, opened], { a: 1 }, 'state', { id: 'a', index: 0 })), [['waiting', ['a', 'e']]]);
  });

  it('shows the latest waiting first, a blocked session still on top', () => {
    const old = session('o', '/code/app', { stateSince: 1 });
    const recent = session('r', '/code/app', { stateSince: 9 });
    const asking = session('p', '/code/app', { state: 'perm', permissions: [{}], stateSince: 0 } as unknown as Partial<SessionInfo>);
    assert.deepEqual(keys(listGroups([old, recent, asking], {}, 'state')), [['waiting', ['p', 'r', 'o']]]);
  });
});

describe('the list with project managers', () => {
  const summary = { items: 2, asks: 0, workers: 2, working: 1, line: 'working' } as const;
  const rows = (groups: ReturnType<typeof listGroups>) => groups.map((group) => [group.key, group.rows.map((row) => [row.session.id, (row.workers ?? []).map((each) => each.id)])]);
  const lead = session('pm', '/code/app', { pm: true, pmSummary: summary });
  const atWork = session('w1', '/code/app', { pmOf: 'pm', state: 'work' });
  const asking = session('w2', '/code/app', { pmOf: 'pm', state: 'perm', permissions: [{}] } as unknown as Partial<SessionInfo>);

  it('by project: the PM heads its project with its workers under it; a worker in another project stays there', () => {
    const other = session('o', '/code/app', { state: 'work', stateSince: 9 });
    const far = session('far', '/code/site', { pmOf: 'pm', state: 'work' });
    assert.deepEqual(rows(listGroups([other, lead, atWork, far], { pm: 1 }, 'project')), [
      ['project:/code/app', [['pm', ['w1']], ['o', []]]],
      ['project:/code/site', [['far', []]]],
    ]);
  });

  it('by state: a worker goes under its PM in the same group, one waiting for the user stays in the waiting group at its place', () => {
    const working = { ...lead, state: 'work' } as SessionInfo;
    assert.deepEqual(rows(listGroups([working, atWork, asking], {}, 'state')), [['working', [['pm', ['w1']]]], ['waiting', [['w2', []]]]]);
    // the PM waits too (its reply unread): its worker still is not put under it
    assert.deepEqual(rows(listGroups([lead, asking], {}, 'state')), [['waiting', [['w2', []], ['pm', []]]]]);
    // in another project than its PM's, it stays at its place in the group they share
    const far = session('far', '/code/site', { pmOf: 'pm', state: 'work' });
    assert.deepEqual(rows(listGroups([working, far], {}, 'state')), [['working', [['pm', []], ['far', []]]]]);
  });

  it('a PM with the setting off, or made an ordinary session again, leaves the list flat', () => {
    for (const [why, ordinary] of [['setting off', { pm: true }], ['reverted', {}]] as const) {
      const former = session('pm', '/code/app', { ...ordinary, state: 'work' });
      assert.deepEqual(rows(listGroups([former, atWork], {}, 'state')), [['working', [['pm', []], ['w1', []]]]], why);
      assert.deepEqual(rows(listGroups([former, atWork], {}, 'project')), [['project:/code/app', [['pm', []], ['w1', []]]]], why);
    }
  });

  it('a folded PM still shows its worker waiting for the user', () => {
    const [group] = listGroups([lead, atWork, asking], { pm: 1 }, 'project');
    const row = group.rows[0];
    assert.deepEqual(shownWorkers(row, false, {}).map((each) => each.id), ['w1', 'w2']);
    assert.deepEqual(shownWorkers(row, true, {}).map((each) => each.id), ['w2']);
  });
});
