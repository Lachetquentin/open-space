import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { CLAUDE_LATEST_EVERY_MS, CLAUDE_LATEST_RETRY_MS, ClaudeLatest } from './claude-latest.ts';

describe('the latest Claude Code on the registry', () => {
  it('asks nothing while the check is off, and stops asking once it is turned off', async () => {
    mock.timers.enable({ apis: ['setInterval'] });
    try {
      let enabled = false;
      const asked: string[] = [];
      const latest = new ClaudeLatest({
        enabled: () => enabled, onChange: () => {}, log: () => {},
        fetch: async (url) => { asked.push(url); return { ok: true, status: 200, json: async () => ({ version: '2.2.0' }) }; },
      });
      latest.apply();
      mock.timers.tick(CLAUDE_LATEST_EVERY_MS * 2);
      assert.equal(asked.length, 0);

      enabled = true;
      latest.apply();
      assert.equal(asked.length, 1);
      mock.timers.tick(CLAUDE_LATEST_EVERY_MS);
      assert.equal(asked.length, 2);

      enabled = false;
      latest.apply();
      mock.timers.tick(CLAUDE_LATEST_EVERY_MS * 2);
      assert.equal(asked.length, 2);
    } finally {
      mock.timers.reset();
    }
  });

  it('keeps the version it knew when the registry fails or answers nonsense', async () => {
    mock.timers.enable({ apis: ['setInterval'] });
    try {
      const answers: (() => Promise<unknown>)[] = [async () => ({ version: '2.2.0' }), async () => { throw new Error('offline'); }, async () => ({ version: 'latest' })];
      const told: (string | null)[] = [];
      let settled: () => void = () => {};
      const next = () => new Promise<void>((resolve) => { settled = resolve; });
      const latest = new ClaudeLatest({
        enabled: () => true, onChange: (version) => { told.push(version); settled(); }, log: () => settled(),
        fetch: async () => ({ ok: true, status: 200, json: answers.shift() ?? (async () => ({})) }),
      });
      let answered = next();
      latest.apply();
      await answered;
      for (let failure = 0; failure < 2; failure++) {
        answered = next();
        mock.timers.tick(CLAUDE_LATEST_EVERY_MS);
        await answered;
      }
      assert.equal(latest.version, '2.2.0');
      assert.deepEqual(told, ['2.2.0']);
    } finally {
      mock.timers.reset();
    }
  });

  it('tries once more a few minutes after a failed request, and not after that one failed too', async () => {
    mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    try {
      let asked = 0;
      let settled: () => void = () => {};
      const next = () => new Promise<void>((resolve) => { settled = resolve; });
      const latest = new ClaudeLatest({
        enabled: () => true, onChange: () => {}, log: () => settled(),
        fetch: async () => { asked++; throw new Error('offline'); },
      });
      let failed = next();
      latest.apply();
      await failed;
      assert.equal(asked, 1);

      failed = next();
      mock.timers.tick(CLAUDE_LATEST_RETRY_MS);
      await failed;
      assert.equal(asked, 2);

      mock.timers.tick(CLAUDE_LATEST_RETRY_MS * 2);
      assert.equal(asked, 2);
    } finally {
      mock.timers.reset();
    }
  });

  it('drops the pending retry once the check is turned off', async () => {
    mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    try {
      let enabled = true;
      let asked = 0;
      let settled: () => void = () => {};
      const failed = new Promise<void>((resolve) => { settled = resolve; });
      const latest = new ClaudeLatest({
        enabled: () => enabled, onChange: () => {}, log: () => settled(),
        fetch: async () => { asked++; throw new Error('offline'); },
      });
      latest.apply();
      await failed;

      enabled = false;
      latest.apply();
      // on again without apply(): only a retry left pending would still ask
      enabled = true;
      mock.timers.tick(CLAUDE_LATEST_RETRY_MS);
      assert.equal(asked, 1);
    } finally {
      mock.timers.reset();
    }
  });
});
