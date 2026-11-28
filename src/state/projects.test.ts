import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SessionInfo } from '../../shared/protocol.ts';
import { activeProject, allProjects, inProject, nextRow, outsideRoots, projectDigit, projectOf, projectsOf, withoutProjects, withPin } from './projects.ts';

const session = (id: string, cwd: string, extra: Partial<SessionInfo> = {}) => ({ id, cwd, state: 'wait', turns: 0, permissions: [], subagents: [], createdAt: 0, ...extra }) as unknown as SessionInfo;

describe('projects', () => {
  it('leaves out a trigger run that is in no room', () => {
    const done = session('t', '/code/app', { state: 'done', trigger: 'nightly' } as unknown as Partial<SessionInfo>);
    assert.deepEqual(projectsOf([session('a', '/code/app'), done], {}).map(({ name, count }) => [name, count]), [['app', 1]]);
  });

  it('counts a session on a branch of its own in the folder it was asked for', () => {
    const branch = session('b', '/code/app/.claude/worktrees/x', { worktree: { home: '/code/app' } as SessionInfo['worktree'] });
    assert.equal(projectOf(branch), '/code/app');
    assert.deepEqual(projectsOf([session('a', '/code/app'), branch], {}).map(({ name, count }) => [name, count]), [['app', 2]]);
  });

  it('counts a session in a worktree made outside Open Space in its main checkout', () => {
    const outside = session('c', '/code/app-feature', { checkout: '/code/app' });
    assert.equal(projectOf(outside), '/code/app');
    assert.deepEqual(projectsOf([session('a', '/code/app'), outside], {}).map(({ name, count }) => [name, count]), [['app', 2]]);
  });

  it('sorts by name, tells same-named folders apart and flags the one waiting for the user', () => {
    const projects = projectsOf([session('a', '/web/app'), session('b', '/mobile/app', { state: 'perm', permissions: [{}] } as unknown as Partial<SessionInfo>), session('c', '/code/blog')], {});
    assert.deepEqual(projects.map(({ name, waiting }) => [name, waiting]), [['blog', false], ['mobile/app', true], ['web/app', false]]);
  });

  it('gives the first nine projects, by name, the digit of their shortcut', () => {
    const projects = projectsOf([session('a', '/code/site'), session('b', '/code/app')], {});
    assert.equal(projectDigit(projects, '/code/app'), 1);
    assert.equal(projectDigit(projects, '/code/site'), 2);
    assert.equal(projectDigit(projects, '/code/gone'), null);
    const many = projectsOf(Array.from({ length: 10 }, (_, index) => session(String(index), `/code/p${index}`)), {});
    assert.equal(projectDigit(many, '/code/p9'), null);
  });

  it('merges the saved projects with those of the sessions, each folder once, the pinned ones first', () => {
    const saved = [{ folder: '/code/app', pinned: true }, { folder: '/web/site' }, { folder: '/mobile/site', pinned: true }];
    const every = allProjects([session('a', '/code/app'), session('b', '/code/blog')], {}, saved);
    assert.deepEqual(every.map(({ name, count, pinned }) => [name, count, pinned]), [['app', 1, true], ['mobile/site', 0, true], ['blog', 1, false], ['web/site', 0, false]]);
  });

  it('shows in the header the projects with sessions, and the pinned ones even without', () => {
    const header = projectsOf([session('a', '/code/blog')], {}, [{ folder: '/code/app', pinned: true }, { folder: '/code/site' }]);
    assert.deepEqual(header.map(({ name, count }) => [name, count]), [['app', 0], ['blog', 1]]);
  });

  it('saves a project of the sessions when it is pinned, and keeps it saved when unpinned', () => {
    const pinned = withPin([], '/code/app', true);
    assert.deepEqual(pinned, [{ folder: '/code/app', pinned: true }]);
    assert.deepEqual(withPin(pinned, '/code/app', false), [{ folder: '/code/app' }]);
  });

  it('keeps every session in sight with no project picked, or only one project there', () => {
    const projects = projectsOf([session('a', '/code/app')], {});
    assert.equal(activeProject(projects, '/code/app'), '');
    assert.equal(activeProject(projectsOf([session('a', '/code/app'), session('b', '/code/blog')], {}), '/code/gone'), '');
    assert.equal(inProject(session('a', '/code/app'), ''), true);
    assert.equal(inProject(session('a', '/code/app'), '/code/blog'), false);
  });

  it('never filters on a pinned project without a session: nothing would be left to see', () => {
    const projects = projectsOf([session('a', '/code/blog')], {}, [{ folder: '/code/app', pinned: true }]);
    assert.equal(projects.length, 2);
    assert.equal(activeProject(projects, '/code/app'), '');
    assert.equal(activeProject(projects, '/code/blog'), '/code/blog');
  });

  it('tells a saved project that left the allowed folders from one inside, and from a project of sessions only', () => {
    assert.equal(outsideRoots({ folder: '/old/app', name: 'app', count: 1, waiting: false, saved: true, pinned: false }, ['/code']), true);
    assert.equal(outsideRoots({ folder: '/code/site', name: 'site', count: 0, waiting: false, saved: true, pinned: false }, ['/code']), false);
    assert.equal(outsideRoots({ folder: '/elsewhere/blog', name: 'blog', count: 1, waiting: false, saved: false, pinned: false }, ['/code']), false);
  });

  it('moves the arrow keys over the rows that can be picked, wrapping, and stays when none can', () => {
    const disabled = [false, true, false, true];
    assert.equal(nextRow(disabled, 0, 1), 2);
    assert.equal(nextRow(disabled, 2, 1), 0);
    assert.equal(nextRow(disabled, 0, -1), 2);
    assert.equal(nextRow(disabled, -1, 1), 0, 'from no row, the first one that can be picked');
    assert.equal(nextRow([true, true], 1, 1), 1);
  });

  it('leaves the saved projects out of what the settings dialog saves, so it cannot put an old copy back', () => {
    assert.deepEqual(withoutProjects({ theme: 'space', projects: [{ folder: '/code/app' }] }), { theme: 'space' });
  });
});
