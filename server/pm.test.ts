import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { emptyPm, itemStatus, openWaits, PM_LIMITS, type PmFile, parsePmFile } from '../shared/pm.ts';
import { writeFileAtomic } from './atomic-write.ts';
import { PmBook } from './pm.ts';
import {
  addAsk, addItem, addLink, answerAsk, answerPage, archiveItem, dismissAsk, dismissedNotice, editMemory, forget, linkWorker, ownWorker, remember, reopenPage,
  resolveWorker, retirePage, seePage, setInstructions, setMission, settleAsk, showPage, snoozeAsk, undoDismiss, unlinkWorker, updateItem, wakeAsk,
} from './pm-ops.ts';

const base = mkdtempSync(path.join(os.tmpdir(), 'office-pm-'));
after(() => rmSync(base, { recursive: true, force: true }));

const isError = (result: unknown): boolean => typeof result === 'object' && result !== null && 'error' in result;
/** A file with tasks W1..Wn already added. */
const withItems = (count: number): PmFile => {
  const file = emptyPm();
  for (let no = 1; no <= count; no++) addItem(file, `Task ${no}`, 1);
  return file;
};

describe('PM tasks', () => {
  it('never hands out a task number twice, even after a task is dropped', () => {
    const file = withItems(2);
    assert.deepEqual(file.items.map((item) => item.no), [1, 2]);
    updateItem(file, { item: 1, status: 'drop' }, 2);
    assert.equal((addItem(file, 'Third', 3) as { no: number }).no, 3);
  });

  it('finishes a task only with the line to keep, and leaves its open questions open', () => {
    const file = withItems(1);
    addAsk(file, { item: 1, title: 'Which phone?', detail: '' }, 1);
    assert.ok(isError(updateItem(file, { item: 1, status: 'done' }, 2)));
    assert.equal(file.items[0].state, 'moving');
    updateItem(file, { item: 1, status: 'done', done: 'Shipped' }, 2);
    assert.equal(file.items[0].state, 'finished');
    assert.equal(file.asks[0].state, 'open');
  });

  it('withdraws the open questions of a dropped task, not the answered ones', () => {
    const file = withItems(1);
    addAsk(file, { item: 1, title: 'Open', detail: '' }, 1);
    addAsk(file, { item: 1, title: 'Answered', detail: '' }, 1);
    answerAsk(file, 2, 'Yes', 2);
    updateItem(file, { item: 1, status: 'drop' }, 3);
    assert.deepEqual(file.asks.map((ask) => ask.state), ['withdrawn', 'answered']);
  });

  it('changes nothing when one part of an update is refused', () => {
    const file = withItems(1);
    for (let step = 0; step < 30; step++) updateItem(file, { item: 1, step: `Step ${step}` }, 1);
    assert.ok(isError(updateItem(file, { item: 1, title: 'Renamed', step: 'One too many' }, 2)));
    assert.equal(file.items[0].title, 'Task 1');
    assert.equal(file.items[0].steps.length, 30);
  });

  it('waits on W<n> or Q<n> by number, so the wait lifts once that task or question is settled', () => {
    const file = withItems(2);
    addAsk(file, { title: 'Which phone?', detail: '' }, 1);
    updateItem(file, { item: 1, wait: 'Q1' }, 2);
    updateItem(file, { item: 2, wait: 'W1' }, 2);
    file.turn = 5;
    assert.equal(itemStatus(file.items[0], file, []), 'waiting');
    settleAsk(file, 1, 'done', 3);
    assert.equal(itemStatus(file.items[0], file, []), 'idle');
    assert.equal(itemStatus(file.items[1], file, []), 'waiting');
    updateItem(file, { item: 1, status: 'done', done: 'Done' }, 4);
    file.turn = 9;
    assert.equal(itemStatus(file.items[1], file, []), 'idle');
  });

  it('lifts a text wait only when told to, and its lifted waits leave room for new ones', () => {
    const file = withItems(1);
    for (let wait = 1; wait <= 10; wait++) updateItem(file, { item: 1, wait: `Bob ${wait}` }, 1);
    assert.ok(isError(updateItem(file, { item: 1, wait: 'Bob 11' }, 2)));
    updateItem(file, { item: 1, clearWaits: true }, 3);
    assert.deepEqual(openWaits(file.items[0], file), []);
    assert.ok(file.items[0].waits.every((wait) => wait.cleared === 3));
    assert.ok(!isError(updateItem(file, { item: 1, wait: 'Bob 11' }, 4)));
  });

  it('lifts the waits of a task once it is finished or dropped', () => {
    const file = withItems(2);
    updateItem(file, { item: 1, wait: 'Bob' }, 1);
    updateItem(file, { item: 2, wait: 'Alice' }, 1);
    updateItem(file, { item: 1, status: 'done', done: 'Shipped' }, 2);
    updateItem(file, { item: 2, status: 'drop' }, 2);
    assert.deepEqual(file.items.flatMap((item) => item.waits.map((wait) => wait.cleared)), [2, 2]);
  });
});

describe('PM questions', () => {
  it('refuses more than six answers, or a recommended answer that is not one of them', () => {
    const file = emptyPm();
    const answers = ['a', 'b', 'c', 'd', 'e', 'f'];
    assert.ok(!isError(addAsk(file, { title: 'Six', detail: '', answers, recommended: 'f' }, 1)));
    assert.ok(isError(addAsk(file, { title: 'Seven', detail: '', answers: [...answers, 'g'] }, 1)));
    assert.ok(isError(addAsk(file, { title: 'Other', detail: '', answers, recommended: 'z' }, 1)));
    assert.equal(file.asks.length, 1);
  });

  it('takes one answer only', () => {
    const file = emptyPm();
    addAsk(file, { title: 'Which phone?', detail: '', answers: ['iPhone', 'Android'] }, 1);
    assert.ok(!isError(answerAsk(file, 1, 'iPhone', 2)));
    assert.ok(isError(answerAsk(file, 1, 'Android', 3)));
    assert.equal(file.asks[0].answer, 'iPhone');
  });

  it('marks an answered question done, but not a withdrawn one', () => {
    const file = emptyPm();
    addAsk(file, { title: 'One', detail: '' }, 1);
    addAsk(file, { title: 'Two', detail: '' }, 1);
    answerAsk(file, 1, 'Yes', 2);
    assert.ok(!isError(settleAsk(file, 1, 'done', 3)));
    settleAsk(file, 2, 'withdrawn', 3);
    assert.ok(isError(settleAsk(file, 2, 'done', 4)));
    assert.deepEqual(file.asks.map((ask) => ask.state), ['done', 'withdrawn']);
  });

  it('tells each question dismissed by the user once', () => {
    const file = emptyPm();
    addAsk(file, { title: 'One', detail: '' }, 1);
    addAsk(file, { title: 'Two', detail: '' }, 1);
    assert.equal(dismissedNotice(file), '');
    file.asks[1].state = 'dismissed';
    assert.match(dismissedNotice(file), /Q2/);
    assert.equal(dismissedNotice(file), '');
  });
});

describe('what the user does with a question', () => {
  /** A file with open questions Q1..Qn. */
  const withAsks = (count: number): PmFile => {
    const file = emptyPm();
    for (let no = 1; no <= count; no++) addAsk(file, { title: `Question ${no}`, detail: '' }, 1);
    return file;
  };

  it('snoozes an open question until a time ahead, and wakes it again', () => {
    const file = withAsks(1);
    assert.ok(isError(snoozeAsk(file, 1, 100, 100)), 'a time not ahead');
    assert.ok(!isError(snoozeAsk(file, 1, 500, 100)));
    assert.equal(file.asks[0].snoozedUntil, 500);
    assert.ok(!isError(wakeAsk(file, 1)));
    assert.equal(file.asks[0].snoozedUntil, undefined);
  });

  it('snoozes, wakes or dismisses only a question still open', () => {
    const file = withAsks(1);
    answerAsk(file, 1, 'Yes', 2);
    assert.ok(isError(snoozeAsk(file, 1, 500, 100)));
    assert.ok(isError(wakeAsk(file, 1)));
    assert.ok(isError(dismissAsk(file, 1, 3)));
    assert.ok(isError(snoozeAsk(file, 9, 500, 100)), 'a question that is not there');
    assert.equal(file.asks[0].state, 'answered');
  });

  it('opens a dismissed question again until its PM has been told, not after', () => {
    const file = withAsks(2);
    dismissAsk(file, 1, 2);
    dismissAsk(file, 2, 2);
    assert.ok(!isError(undoDismiss(file, 1)));
    assert.equal(file.asks[0].state, 'open');
    assert.equal(file.asks[0].settledAt, undefined);
    assert.match(dismissedNotice(file), /Q2/);
    assert.ok(isError(undoDismiss(file, 2)));
    assert.equal(file.asks[1].state, 'dismissed');
    assert.ok(isError(undoDismiss(file, 1)), 'a question that was not dismissed');
  });
});

describe('archiving tasks', () => {
  it('archives a finished or dropped task, never one still open', () => {
    const file = withItems(3);
    updateItem(file, { item: 1, status: 'done', done: 'Shipped' }, 2);
    updateItem(file, { item: 2, status: 'drop' }, 2);
    assert.ok(isError(archiveItem(file, 3)));
    assert.ok(isError(archiveItem(file, 9)));
    assert.ok(!isError(archiveItem(file, 1)));
    assert.deepEqual(file.items.map((item) => !!item.archived), [true, false, false]);
  });

  it('archives every finished or dropped task at once with 0', () => {
    const file = withItems(3);
    updateItem(file, { item: 1, status: 'done', done: 'Shipped' }, 2);
    updateItem(file, { item: 3, status: 'drop' }, 2);
    assert.ok(!isError(archiveItem(file, 0)));
    assert.deepEqual(file.items.map((item) => !!item.archived), [true, false, true]);
  });
});

describe('the memory changed from the page', () => {
  const withNotes = (...notes: string[]): PmFile => {
    const file = emptyPm();
    for (const note of notes) remember(file, note, 1);
    return file;
  };

  it('adds, changes and deletes a note by its place from 0', () => {
    const file = withNotes('First', 'Second', 'Third');
    assert.deepEqual(editMemory(file, { op: 'edit', index: 0, was: 'First', text: 'Changed' }, 5), { number: 1, text: 'Changed' });
    assert.deepEqual(file.memory[0], { text: 'Changed', at: 5 });
    assert.deepEqual(editMemory(file, { op: 'delete', index: 1, was: 'Second' }, 6), { number: 2, text: 'Second' });
    assert.deepEqual(file.memory.map((note) => note.text), ['Changed', 'Third']);
    assert.deepEqual(editMemory(file, { op: 'add', text: 'Fourth' }, 7), { number: 3, text: 'Fourth' });
  });

  it('refuses a note that is not there, or empty, and changes nothing', () => {
    const file = withNotes('First');
    for (const op of [{ op: 'edit', index: 1, was: 'x', text: 'x' }, { op: 'delete', index: 1, was: 'x' }, { op: 'delete', index: -1, was: 'First' }, { op: 'edit', index: 0, was: 'First', text: '  ' }, { op: 'add', text: '' }] as const) {
      assert.ok(isError(editMemory(file, op, 5)), JSON.stringify(op));
    }
    assert.deepEqual(file.memory, [{ text: 'First', at: 1 }]);
  });

  it('refuses a change of a note that is no longer the one the page saw, and changes nothing', () => {
    const file = withNotes('First', 'Second');
    file.memory.shift(); // the PM forgot 'First' meanwhile: index 0 is now 'Second'
    for (const op of [{ op: 'delete', index: 0, was: 'Second?' }, { op: 'edit', index: 0, was: 'First', text: 'x' }] as const) {
      assert.ok(isError(editMemory(file, op, 5)), JSON.stringify(op));
    }
    assert.deepEqual(file.memory, [{ text: 'Second', at: 1 }]);
  });
});

describe('PM memory and links', () => {
  it('keeps 60 notes at most, and numbers them again once one is forgotten', () => {
    const file = emptyPm();
    for (let note = 1; note <= 60; note++) assert.deepEqual(remember(file, `Note ${note}`, 1), { number: note });
    assert.ok(isError(remember(file, 'Note 61', 1)));
    forget(file, 2);
    assert.equal(file.memory[1].text, 'Note 3');
    assert.equal(file.memory.length, 59);
  });

  it('links web addresses only, and knows a pull request', () => {
    const file = withItems(1);
    assert.ok(isError(addLink(file, { item: 1, url: 'javascript:alert(1)' })));
    assert.equal((addLink(file, { item: 1, url: 'https://github.com/o/r/pull/3' }) as { kind: string }).kind, 'pr');
    assert.equal((addLink(file, { item: 1, url: 'https://gitlab.com/o/r/-/issues/4' }) as { kind: string }).kind, 'issue');
    assert.equal(file.items[0].links.length, 2);
  });
});

describe('PM workers', () => {
  it('counts a worker as its own until it is resolved or unlinked', () => {
    const file = withItems(1);
    linkWorker(file, 'w-1', 1, 1);
    linkWorker(file, 'w-2', 1);
    assert.equal(ownWorker(file, 'w-1')?.item, 1);
    resolveWorker(file, 'w-1', 2);
    unlinkWorker(file, 'w-2');
    assert.equal(ownWorker(file, 'w-1'), undefined);
    assert.equal(ownWorker(file, 'w-2'), undefined);
    assert.ok(isError(linkWorker(file, '../w-3', 1)));
  });
});

describe('PM pages', () => {
  const page = (id: string, source = id) => ({ id, title: `Page ${id}`, source });

  it('replaces the page of the same source still open, and leaves one already answered as it is', () => {
    const file = emptyPm();
    showPage(file, page('a1', 'layout'), 1);
    answerPage(file, 'a1', { layout: 'B' }, 2);
    showPage(file, page('b2', 'layout'), 3);
    showPage(file, page('c3', 'layout'), 4);
    showPage(file, page('d4', 'other'), 5);
    assert.deepEqual(file.pages.map((one) => [one.id, one.state, one.replacedBy]), [
      ['a1', 'answered', undefined], ['b2', 'replaced', 'c3'], ['c3', 'open', undefined], ['d4', 'open', undefined],
    ]);
  });

  it('keeps the newest pages a PM may have, and names the ones let go so that their files go too', () => {
    const file = emptyPm();
    for (let no = 0; no < PM_LIMITS.pages; no++) showPage(file, page(`p${no}`), 1);
    assert.deepEqual(showPage(file, page('last'), 2), { page: file.pages.at(-1), dropped: ['p0'] });
    assert.equal(file.pages.length, PM_LIMITS.pages);
  });

  it('refuses a page about a task or a question that does not exist, changing nothing', () => {
    const file = withItems(1);
    addAsk(file, { item: 1, title: 'Which phone?', detail: '' }, 1);
    showPage(file, page('a1', 'layout'), 1);
    const before = JSON.stringify(file);
    assert.ok(isError(showPage(file, { ...page('b2', 'layout'), item: 2 }, 2)));
    assert.ok(isError(showPage(file, { ...page('b2', 'layout'), questions: ['Q1', 'Q9'] }, 2)));
    assert.equal(JSON.stringify(file), before);
    assert.deepEqual((showPage(file, { ...page('b2', 'layout'), item: 1, questions: ['W1 Q1', 'Q1'] }, 2) as { page: { questions: string[] } }).page.questions, ['Q1']);
  });

  it('takes one answer only, until the user opens the page again', () => {
    const file = emptyPm();
    showPage(file, page('a1'), 1);
    assert.ok(!isError(answerPage(file, 'a1', { phone: 'iPhone' }, 2)));
    assert.ok(isError(answerPage(file, 'a1', { phone: 'Android' }, 3)));
    assert.ok(isError(seePage(file, 'a1', 3)));
    assert.deepEqual(file.pages[0].answers, { phone: 'iPhone' });
    reopenPage(file, 'a1');
    assert.ok(!isError(answerPage(file, 'a1', { phone: 'Android' }, 4)));
    assert.deepEqual([file.pages[0].state, file.pages[0].answers], ['answered', { phone: 'Android' }]);
  });

  it('refuses answers longer than a page may send, changing nothing', () => {
    const file = emptyPm();
    showPage(file, page('a1'), 1);
    assert.ok(isError(answerPage(file, 'a1', { notes: 'x'.repeat(PM_LIMITS.pageAnswerBytes) }, 2)));
    assert.equal(file.pages[0].state, 'open');
    assert.ok(!isError(answerPage(file, 'a1', { notes: 'x'.repeat(PM_LIMITS.pageAnswerBytes - 20) }, 2)));
  });

  it('refuses answers nested deep enough to overflow the stack of a later copy of the file', () => {
    const file = emptyPm();
    showPage(file, page('a1'), 1);
    let deep: unknown = 'x';
    for (let i = 0; i < 3000; i++) deep = [deep];
    assert.ok(isError(answerPage(file, 'a1', { deep }, 2)));
    assert.equal(file.pages[0].state, 'open');
    assert.doesNotThrow(() => structuredClone(file));
    assert.ok(!isError(answerPage(file, 'a1', { choices: [[['a']]] }, 3)));
  });

  it('answers or opens again only a page the user can still act on', () => {
    const file = emptyPm();
    showPage(file, page('a1', 'layout'), 1);
    showPage(file, page('b2', 'layout'), 2);
    retirePage(file, 'b2', 3);
    assert.ok(isError(answerPage(file, 'a1', {}, 4)), 'replaced');
    assert.ok(isError(answerPage(file, 'b2', {}, 4)), 'retired');
    assert.ok(isError(reopenPage(file, 'b2')), 'retired');
    assert.ok(isError(reopenPage(file, 'a1')), 'replaced');
    assert.ok(isError(retirePage(file, 'b2', 5)), 'already retired');
    assert.ok(isError(answerPage(file, 'zz', {}, 4)), 'unknown');
  });

  it('opens again only a page no newer page of its source has followed, so that one page of a source at most is open', () => {
    const file = emptyPm();
    showPage(file, page('a1', 'layout'), 1);
    answerPage(file, 'a1', { layout: 'A' }, 2);
    showPage(file, page('b2', 'layout'), 3);
    assert.ok(isError(reopenPage(file, 'a1')));
    assert.equal(file.pages[0].state, 'answered');
  });

  it('is seen without an answer only when it asks no question', () => {
    const file = emptyPm();
    addAsk(file, { title: 'Which phone?', detail: '' }, 1);
    showPage(file, { ...page('a1'), questions: ['Q1'] }, 1);
    assert.ok(isError(seePage(file, 'a1', 2)));
    assert.equal(file.pages[0].state, 'open');
  });
});

describe('a PM file after every operation', () => {
  it('reads back exactly as the operations left it', () => {
    const file = withItems(2);
    setMission(file, 'Ship the app');
    setInstructions(file, 'French only');
    remember(file, 'Uses pnpm', 1);
    linkWorker(file, 'w-1', 1, 1);
    linkWorker(file, 'w-2', 1);
    resolveWorker(file, 'w-2', 2);
    addAsk(file, { item: 1, title: 'Which phone?', detail: 'Details', answers: ['iPhone', 'Android'], recommended: 'iPhone', holds: true }, 2);
    addAsk(file, { title: 'Free', detail: '' }, 2);
    answerAsk(file, 1, 'iPhone', 3);
    settleAsk(file, 1, 'done', 4);
    settleAsk(file, 2, 'withdrawn', 4);
    updateItem(file, { item: 1, title: 'Renamed', now: 'Testing', step: 'Write tests', chore: true, wait: 'W2' }, 5);
    updateItem(file, { item: 1, stepDone: 1, wait: 'Bob' }, 5);
    updateItem(file, { item: 2, status: 'later' }, 5);
    updateItem(file, { item: 2, status: 'drop' }, 6);
    addLink(file, { item: 1, worker: 'w-1', url: 'https://github.com/o/r/pull/3' });
    addLink(file, { worker: 'w-1', url: 'https://example.com/' });
    file.asks[1].state = 'dismissed';
    dismissedNotice(file);
    addAsk(file, { title: 'Snoozed', detail: '' }, 6);
    snoozeAsk(file, 3, 900, 6);
    addAsk(file, { title: 'Dismissed then back', detail: '' }, 6);
    dismissAsk(file, 4, 7);
    undoDismiss(file, 4);
    archiveItem(file, 0);
    editMemory(file, { op: 'edit', index: 0, was: 'Uses pnpm', text: 'Uses npm' }, 8);
    showPage(file, { id: 'a1', title: 'Layout', source: 'layout', item: 1, questions: ['Q3'] }, 8);
    showPage(file, { id: 'b2', title: 'Layout', source: 'layout' }, 9);
    answerPage(file, 'b2', { layout: 'B', screens: ['home'], ok: true }, 9);
    showPage(file, { id: 'c3', title: 'Seen', source: 'note' }, 9);
    seePage(file, 'c3', 10);
    reopenPage(file, 'c3');
    showPage(file, { id: 'd4', title: 'Gone', source: 'gone' }, 10);
    retirePage(file, 'd4', 11);
    assert.deepEqual(parsePmFile(JSON.parse(JSON.stringify(file))), file);
  });
});

describe('the PM book', () => {
  it('gives an empty file for a PM without one, and the readable part of a damaged one', async () => {
    const book = new PmBook(path.join(base, 'damaged'));
    assert.deepEqual(await book.read('fresh'), emptyPm());
    writeFileSync(path.join(base, 'damaged', 'cut.json'), '{"mission":"Ship');
    assert.deepEqual(await book.read('cut'), emptyPm());
    writeFileSync(path.join(base, 'damaged', 'odd.json'), JSON.stringify({ mission: 'Ship', items: 'none' }));
    assert.equal((await book.read('odd')).mission, 'Ship');
  });

  it('keeps a file that does not read as JSON aside, once, before writing over it', async () => {
    const folder = path.join(base, 'kept');
    const book = new PmBook(folder);
    writeFileSync(path.join(folder, 'p.json'), '{"mission":"Ship');
    await book.change('p', (file) => setMission(file, 'Again'));
    writeFileSync(path.join(folder, 'p.json'), 'later damage');
    await book.read('p');
    assert.equal(readFileSync(path.join(folder, 'p.json.bad'), 'utf8'), '{"mission":"Ship');
  });

  it('numbers tasks added at the same time one after the other, and loses none', async () => {
    const book = new PmBook(path.join(base, 'parallel'));
    await Promise.all(Array.from({ length: 20 }, (_, index) => book.change('p', (file) => addItem(file, `Task ${index}`, 1))));
    const numbers = (await book.read('p')).items.map((item) => item.no).sort((a, b) => a - b);
    assert.deepEqual(numbers, Array.from({ length: 20 }, (_, index) => index + 1));
  });

  it('keeps going after an edit that throws, without writing it', async () => {
    const book = new PmBook(path.join(base, 'throwing'));
    const failed = book.change('p', (file) => { addItem(file, 'Lost', 1); throw new Error('boom'); });
    const next = book.change('p', (file) => addItem(file, 'Kept', 1));
    await assert.rejects(failed);
    await next;
    assert.deepEqual((await book.read('p')).items.map((item) => item.title), ['Kept']);
  });

  it('writes a file only its owner can read, and forgets it with its pages', async () => {
    const folder = path.join(base, 'private');
    const book = new PmBook(folder);
    await book.change('p', (file) => setMission(file, 'Ship'));
    const file = path.join(folder, 'p.json');
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).mission, 'Ship');
    if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
    writeFileSync(`${file}.bad`, '{');
    await book.pages.write('p', 'a1', '<p>Pick one</p>');
    await book.remove('p');
    assert.deepEqual(readdirSync(folder).filter((name) => name !== 'pages'), []);
    assert.deepEqual(readdirSync(path.join(folder, 'pages')), [], 'its pages go with it');
    assert.deepEqual(await book.read('p'), emptyPm());
  });

  it('takes only an edit that is done when it returns, so that what it changes is written', () => {
    const book = new PmBook(path.join(base, 'sync'));
    // @ts-expect-error an async edit would change the file after it was compared and written
    const asyncEdit = () => book.change('p', async (file) => setMission(file, 'Late'));
    assert.equal(typeof asyncEdit, 'function');
  });

  it('tells its listeners of a PM once a change is written, not of an edit that changed nothing or failed', async () => {
    const folder = path.join(base, 'heard');
    const book = new PmBook(folder);
    const heard: string[] = [];
    const stop = book.onChange((pm) => heard.push(`${pm}:${JSON.parse(readFileSync(path.join(folder, `${pm}.json`), 'utf8')).mission}`));
    await book.change('p', (file) => setMission(file, 'Ship'));
    await book.change('p', (file) => setMission(file, 'Ship'));
    await book.change('p', (file) => remember(file, '', 1));
    await assert.rejects(book.change('p', () => { throw new Error('boom'); }));
    stop();
    await book.change('p', (file) => setMission(file, 'Again'));
    assert.deepEqual(heard, ['p:Ship']);
  });

  it('keeps the last file read or written at hand, never one an edit failed to write', async () => {
    const book = new PmBook(path.join(base, 'cached'));
    assert.equal(book.cached('p'), undefined, 'not read yet');
    await book.change('p', (file) => setMission(file, 'Ship'));
    assert.equal(book.cached('p')?.mission, 'Ship');
    await assert.rejects(book.change('p', (file) => { setMission(file, 'Lost'); throw new Error('boom'); }));
    assert.equal(book.cached('p')?.mission, 'Ship');
    await book.remove('p');
    assert.equal(book.cached('p'), undefined);
  });

  it('refuses a PM id that is not a session id, so no path leaves its folder', async () => {
    const book = new PmBook(path.join(base, 'ids'));
    await assert.rejects(book.read('../sessions'));
    await assert.rejects(book.change('../sessions', (file) => setMission(file, 'x')));
    await assert.rejects(book.remove('..'));
  });
});

describe('writing a file whole', () => {
  it('replaces the file, owner only, and leaves no temporary file when the write fails', async () => {
    const folder = path.join(base, 'atomic');
    mkdirSync(folder);
    const file = path.join(folder, 'state.json');
    await writeFileAtomic(file, 'one');
    await writeFileAtomic(file, 'two');
    assert.equal(readFileSync(file, 'utf8'), 'two');
    if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
    mkdirSync(path.join(folder, 'taken'));
    await assert.rejects(writeFileAtomic(path.join(folder, 'taken'), 'three'));
    assert.deepEqual(readdirSync(folder).sort(), ['state.json', 'taken']);
  });
});
