import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isNewerVersion } from './claude-version.ts';

describe('a newer Claude Code than the one installed', () => {
  it('compares each part as a number, not as text', () => {
    assert.equal(isNewerVersion('2.1.10', '2.1.9'), true);
    assert.equal(isNewerVersion('2.10.0', '2.9.99'), true);
    assert.equal(isNewerVersion('3.0.0', '2.99.99'), true);
    assert.equal(isNewerVersion('2.1.9', '2.1.10'), false);
  });

  it('is not newer than itself', () => {
    assert.equal(isNewerVersion('2.1.325', '2.1.325'), false);
  });

  it('puts a pre-release before its release', () => {
    assert.equal(isNewerVersion('2.2.0', '2.2.0-beta.1'), true);
    assert.equal(isNewerVersion('2.2.0-beta.1', '2.2.0'), false);
    assert.equal(isNewerVersion('2.2.0-beta.1', '2.1.9'), true);
  });

  it('never calls a missing or garbled version newer', () => {
    for (const [a, b] of [['', '2.1.0'], ['2.1.0', ''], [undefined, '2.1.0'], ['2.1.0', null], ['latest', '2.1.0'], ['9.9', '2.1.0'], ['2.1.0', 'Claude Code']] as const) {
      assert.equal(isNewerVersion(a, b), false, `${a} vs ${b}`);
    }
  });
});
