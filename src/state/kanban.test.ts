import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PermissionPrompt, SessionInfo, SessionState, WorktreeInfo } from '../../shared/protocol.ts';
import { type KanbanFilter, kanbanColumns } from './kanban.ts';
import type { SeenSequences } from './queue.ts';

const session = (id: string, state: SessionState, extra: Partial<SessionInfo> = {}): SessionInfo => ({
  id, name: id, cwd: '/work/garden', model: '', activeModel: '', permissionMode: 'auto', state, stateSince: 1000, createdAt: 0, turns: 1, permissions: [],
  subagents: [], command: '', lastMessage: '', resumable: true, lastSeq: 5, ...extra,
});
const worktree = (extra: Partial<WorktreeInfo> = {}): WorktreeInfo => ({
  branch: 'os/lina-pay', base: 'main', root: '/work/garden/.claude/worktrees/os-lina-pay', mainRoot: '/work/garden', home: '/work/garden', ...extra,
});
const ahead = worktree({ status: { ahead: 2, behind: 0, files: 3, dirty: 0, head: 'abc' } });
const asking = [{ id: 'p1', tool: 'Bash' } as PermissionPrompt];
const DEFAULT: KanbanFilter = { showStopped: false, project: '' };

/** Where each session landed: column id → session ids, in the column's order. */
const board = (sessions: SessionInfo[], seen: SeenSequences = {}, filter: KanbanFilter = DEFAULT) =>
  Object.fromEntries(kanbanColumns(sessions, seen, filter).map(({ id, cards }) => [id, cards.map((card) => card.session.id)]));

describe('the agents board', () => {
  it('puts a session asking for a permission in Needs you, even with commits to land on its branch', () => {
    const columns = kanbanColumns([session('Lina', 'perm', { permissions: asking, worktree: ahead })], {}, DEFAULT);
    assert.deepEqual(columns.find(({ id }) => id === 'attention')?.cards.map(({ session: { id }, kind }) => [id, kind]), [['Lina', 'permission']]);
    assert.deepEqual(columns.find(({ id }) => id === 'toShip')?.cards, []);
  });

  it('counts as Working a session whose turn was seen while its sub-agents work, and one paused by the usage limit', () => {
    const helping = session('Hugo', 'wait', { subagents: [{ id: 'a', name: 'explorer', type: 'Explore' }], worktree: ahead });
    const paused = session('Zoe', 'wait', { pausedUntil: 9000 });
    assert.deepEqual(board([helping, paused], { Hugo: 5 }).working.sort(), ['Hugo', 'Zoe']);
  });

  it('puts an idle session whose finished turn was seen in To ship while its work is not landed, else in Ready', () => {
    const seen = { Lina: 5, Tom: 5 };
    const result = board([session('Lina', 'wait', { worktree: ahead }), session('Tom', 'wait', { worktree: worktree() })], seen);
    assert.deepEqual([result.attention, result.toShip, result.ready], [[], ['Lina'], ['Tom']]);
  });

  it('counts as not landed what git says is not committed or not pushed, and a merge asked for or failed', () => {
    const git = { dirty: 0, unpushed: 0, noUpstream: false, branch: 'main' };
    const cases: [string, Partial<SessionInfo>][] = [
      ['files not committed', { git: { ...git, dirty: 1 } }],
      ['commits not pushed', { git: { ...git, unpushed: 2 } }],
      ['a branch never pushed', { git: { ...git, unpushed: 1, noUpstream: true } }],
      ['a merge asked for', { worktree: worktree({ merge: { step: 'asked', retried: false } }) }],
      ['a failed merge on a clean branch', { worktree: worktree({ status: { ahead: 0, behind: 0, files: 0, dirty: 0, head: 'abc' }, merge: { step: 'failed', problem: { kind: 'behind' } } }) }],
    ];
    for (const [what, extra] of cases) assert.deepEqual(board([session('Lina', 'wait', { turns: 0, ...extra })]).toShip, ['Lina'], what);
  });

  it('hides the stopped and resting sessions unless asked, then shows them apart, the latest first; an unseen error still needs the user', () => {
    const sessions = [
      session('Done', 'done', { stateSince: 1 }), session('Closed', 'closed', { stateSince: 3 }), session('SeenError', 'error', { stateSince: 2 }),
      session('Resting', 'wait', { resting: true, turns: 0, stateSince: 4 }), session('NewError', 'error'), session('Ready', 'wait', { turns: 0 }),
    ];
    const seen = { SeenError: 5 };
    const hidden = board(sessions, seen);
    assert.deepEqual(Object.keys(hidden), ['attention', 'working', 'toShip', 'ready']);
    assert.deepEqual([hidden.attention, hidden.ready], [['NewError'], ['Ready']]);
    assert.deepEqual(board(sessions, seen, { showStopped: true, project: '' }).stopped, ['Resting', 'Closed', 'SeenError', 'Done']);
  });

  it('keeps a resting session that needs the user in the first column, not with the stopped ones', () => {
    const columns = board([session('Resting', 'error', { resting: true })], {}, { showStopped: true, project: '' });
    assert.deepEqual([columns.attention, columns.stopped], [['Resting'], []]);
  });

  it('keeps only the sessions of the project picked, an isolated one counted in the folder it was asked for', () => {
    const sessions = [
      session('Lina', 'work', { cwd: ahead.root, worktree: ahead }), session('Tom', 'work', { cwd: '/work/blog' }), session('Zoe', 'wait', { turns: 0, cwd: '/work/garden' }),
    ];
    const garden = board(sessions, {}, { showStopped: false, project: '/work/garden' });
    assert.deepEqual([garden.working, garden.ready], [['Lina'], ['Zoe']]);
    assert.deepEqual(board(sessions).working.sort(), ['Lina', 'Tom']);
  });
});
