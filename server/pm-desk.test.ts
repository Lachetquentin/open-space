import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import type { PmMessageTag } from '../shared/pm.ts';
import type { ServerMessage, SessionInfo } from '../shared/protocol.ts';
import { PmBook } from './pm.ts';
import { PmDesk } from './pm-desk.ts';
import { addAsk, linkWorker, remember } from './pm-ops.ts';
import { newSessionInfo } from './session.ts';

const base = mkdtempSync(path.join(os.tmpdir(), 'office-pm-desk-'));
after(() => rmSync(base, { recursive: true, force: true }));

const PM = 'pm-1';
const W = 'worker-1';

const info = (id: string, fields: Partial<SessionInfo> = {}): SessionInfo => ({
  ...newSessionInfo({ id, name: id, cwd: '/project', model: '', permissionMode: 'manual' }, 1), permissions: [], lastSeq: 1, ...fields,
});

/** A PM with one worker and an open question Q1, fake sessions, a fake clock and timers; what leaves is kept. */
async function office() {
  const clock = { now: 1_000_000 };
  const live = new Map<string, SessionInfo>();
  const setting = { enabled: true };
  const delivered: { pm: string; text: string; tag: PmMessageTag }[] = [];
  const republished: string[] = [];
  const decisions: { pm: string; ask: number }[] = [];
  const timers: { at: number; run: () => void; cleared: boolean }[] = [];
  const book = new PmBook(mkdtempSync(path.join(base, 'book-')));
  live.set(PM, info(PM, { pm: true }));
  live.set(W, info(W, { pmOf: PM, state: 'wait' }));
  await book.change(PM, (file) => { linkWorker(file, W, 100); addAsk(file, { title: 'Which phone?', detail: '', answers: ['iPhone', 'Android'] }, 100); });
  const desk = new PmDesk({
    book, sessions: () => [...live.values()], enabled: () => setting.enabled, now: () => clock.now,
    republish: (id) => { republished.push(id); },
    deliver: (pm, text, tag) => { delivered.push({ pm, text, tag }); },
    notifyDecision: (pm, ask) => { decisions.push({ pm: pm.id, ask: ask.no }); },
    setTimer: (run, ms) => { const timer = { at: clock.now + ms, run, cleared: false }; timers.push(timer); return { clear: () => { timer.cleared = true; } }; },
  });
  const put = (id: string, fields: Partial<SessionInfo>) => { live.set(id, { ...(live.get(id) as SessionInfo), ...fields }); return live.get(id) as SessionInfo; };
  /** a page: what it receives */
  const page = () => { const got: ServerMessage[] = []; const send = (message: ServerMessage) => { got.push(message); }; return { got, send }; };
  const details = (got: ServerMessage[]) => got.flatMap((message) => (message.t === 'pmDetail' ? [message] : []));
  return { clock, live, setting, delivered, republished, decisions, timers, book, desk, put, page, details };
}

describe('the answer to a PM question', () => {
  it('takes the first of two answers given at once, and tells the PM once', async () => {
    const { desk, book, delivered } = await office();
    const [first, second] = await Promise.all([desk.answer(PM, 1, 'iPhone'), desk.answer(PM, 1, 'Android')]);
    assert.ok(!('error' in first));
    assert.ok('error' in second);
    assert.equal((await book.read(PM)).asks[0].answer, 'iPhone');
    assert.deepEqual(delivered, [{ pm: PM, text: 'Q1: iPhone', tag: { answer: { ask: 1 } } }]);
  });

  it('is refused, and nothing sent, while the setting is off or for a session that is no PM', async () => {
    const { desk, book, delivered, setting, put } = await office();
    setting.enabled = false;
    assert.ok('error' in await desk.answer(PM, 1, 'iPhone'));
    setting.enabled = true;
    put(PM, { pm: undefined });
    assert.ok('error' in await desk.answer(PM, 1, 'iPhone'));
    assert.equal((await book.read(PM)).asks[0].state, 'open');
    assert.deepEqual(delivered, []);
  });

  it('takes a message the user typed to the PM with the question’s tag as its answer, and sends nothing more', async () => {
    const { desk, book, delivered } = await office();
    await desk.typed(PM, 'Q1: Android, please');
    await desk.typed(W, 'Q1: not the PM');
    const ask = (await book.read(PM)).asks[0];
    assert.deepEqual([ask.state, ask.answer], ['answered', 'Android, please']);
    assert.deepEqual(delivered, []);
  });
});

describe('a question the PM asks the user', () => {
  it('notifies the user once, and not of the questions its file already had', async () => {
    const { desk, book, live, clock, decisions } = await office();
    desk.summary(live.get(PM) as SessionInfo);
    await book.change(PM, (file) => { addAsk(file, { title: 'Which store?', detail: '' }, clock.now); });
    await book.change(PM, (file) => { remember(file, 'Uses pnpm', clock.now); });
    assert.deepEqual(decisions, [{ pm: PM, ask: 2 }]);
  });

  it('notifies nobody while the setting is off or for a session that does not act as a PM', async () => {
    for (const off of [{ setting: false }, { untrusted: true }]) {
      const { desk, book, live, clock, setting, put, decisions } = await office();
      desk.summary(live.get(PM) as SessionInfo);
      if ('setting' in off) setting.enabled = false;
      else put(PM, off);
      await book.change(PM, (file) => { addAsk(file, { title: 'Which store?', detail: '' }, clock.now); });
      assert.deepEqual(decisions, [], JSON.stringify(off));
    }
  });
});

describe('the page’s PM requests', () => {
  it('ignores each of them while the setting is off', async () => {
    const { desk, book, delivered, setting, page } = await office();
    const before = JSON.stringify(await book.read(PM));
    setting.enabled = false;
    const { send } = page();
    for (const message of [
      { t: 'pmAsk', pm: PM, ask: 1, action: 'dismiss' }, { t: 'pmAsk', pm: PM, ask: 1, action: 'answer', answer: 'iPhone' },
      { t: 'pmEdit', pm: PM, mission: 'Ship' }, { t: 'pmItemArchive', pm: PM, item: 0 },
    ] as const) await desk.handle(message, send);
    assert.equal(JSON.stringify(await book.read(PM)), before);
    assert.deepEqual(delivered, []);
  });

  it('ignores a request about a session that does not act as a PM (untrusted folder)', async () => {
    const { desk, book, put, page } = await office();
    put(PM, { untrusted: true });
    await desk.handle({ t: 'pmEdit', pm: PM, mission: 'Ship' }, page().send);
    assert.equal((await book.read(PM)).mission, '');
  });

  it('tells the PM what the user changed in its plan, once, and nothing when nothing changed', async () => {
    const { desk, book, delivered, page } = await office();
    await book.change(PM, (file) => { remember(file, 'Uses pnpm', 1); });
    const { send } = page();
    await desk.handle({ t: 'pmEdit', pm: PM, mission: 'Ship the app', memory: { op: 'edit', index: 0, was: 'Uses pnpm', text: 'Uses npm' } }, send);
    await desk.handle({ t: 'pmEdit', pm: PM, mission: ' Ship the app ' }, send);
    assert.equal(delivered.length, 1);
    assert.deepEqual(delivered[0].tag, { change: true });
    assert.match(delivered[0].text, /Ship the app/);
    assert.match(delivered[0].text, /Uses npm/);
  });

  it('changes nothing when part of an edit is refused', async () => {
    const { desk, book, delivered, page } = await office();
    await assert.rejects(desk.handle({ t: 'pmEdit', pm: PM, mission: 'Ship', memory: { op: 'delete', index: 4, was: 'x' } }, page().send));
    assert.equal((await book.read(PM)).mission, '');
    assert.deepEqual(delivered, []);
  });
});

describe('the pages that look at a PM', () => {
  it('get its plan when they start looking and after each change, without its report keys, until they stop', async () => {
    const { desk, book, page, details } = await office();
    const one = page();
    const other = page();
    await desk.watch(one.send, [PM]);
    await desk.watch(other.send, [PM]);
    const first = details(one.got)[0].detail;
    assert.equal(first?.pm, PM);
    assert.equal(first?.asks.length, 1);
    assert.ok(first && !('reports' in first));
    desk.leave(other.send);
    await book.change(PM, (file) => { addAsk(file, { title: 'Second', detail: '' }, 200); });
    assert.equal(details(one.got).at(-1)?.detail?.asks.length, 2);
    assert.equal(details(other.got).length, 1, 'nothing after its socket closed');
  });

  it('see a worker start or stop working, once per change', async () => {
    const { desk, put, page, details, republished } = await office();
    const { got, send } = page();
    await desk.watch(send, [PM]);
    const working = put(W, { state: 'work' });
    desk.sessionShown(working);
    desk.sessionShown(working);
    assert.deepEqual(details(got).at(-1)?.detail?.live, [{ session: W, working: true, waiting: false }]);
    assert.equal(details(got).length, 2);
    assert.deepEqual(republished, [PM], 'its PM is sent again with its new summary, once');
  });

  it('get nothing more of the PM once the setting is off, and no summary goes with it', async () => {
    const { desk, setting, live, page, details } = await office();
    const { got, send } = page();
    await desk.watch(send, [PM]);
    setting.enabled = false;
    desk.settingChanged();
    assert.equal(details(got).at(-1)?.detail, null);
    assert.equal(desk.summary(live.get(PM) as SessionInfo), undefined);
  });
});

describe('a question snoozed from the page', () => {
  it('comes back in the PM’s summary once its time is up, with nothing else happening', async () => {
    const { desk, clock, live, timers, republished, page } = await office();
    await desk.handle({ t: 'pmAsk', pm: PM, ask: 1, action: 'snooze', until: clock.now + 60_000 }, page().send);
    assert.equal(desk.summary(live.get(PM) as SessionInfo)?.asks, 0);
    const armed = timers.filter((timer) => !timer.cleared);
    assert.deepEqual(armed.map((timer) => timer.at), [clock.now + 60_000]);
    republished.length = 0;
    clock.now += 60_000;
    armed[0].run();
    assert.deepEqual(republished, [PM]);
    assert.equal(desk.summary(live.get(PM) as SessionInfo)?.asks, 1);
  });

  it('loses its timer when the PM is made an ordinary session again', async () => {
    const { desk, clock, live, timers, put, page } = await office();
    await desk.handle({ t: 'pmAsk', pm: PM, ask: 1, action: 'snooze', until: clock.now + 60_000 }, page().send);
    desk.summary(live.get(PM) as SessionInfo);
    assert.equal(timers.filter((timer) => !timer.cleared).length, 1);
    put(PM, { pm: undefined });
    desk.refresh(PM);
    assert.deepEqual(timers.filter((timer) => !timer.cleared), []);
  });
});
