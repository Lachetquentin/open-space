import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PmPage } from '../../shared/pm.ts';
import { newestPage, pageView } from './pm-pages.ts';

const page = (id: string, extra: Partial<PmPage> = {}): PmPage => ({ id, source: 'layout', title: id, questions: [], state: 'open', createdAt: 0, ...extra });

describe('a live page in its window', () => {
  it('shows the newest of the pages that replaced the one asked for, stopping on a link that goes round or to a page no longer kept', () => {
    const chain = [page('a', { state: 'replaced', replacedBy: 'b' }), page('b', { state: 'replaced', replacedBy: 'c' }), page('c')];
    assert.equal(newestPage(chain, 'a')?.id, 'c');
    assert.equal(newestPage([page('a', { state: 'replaced', replacedBy: 'b' }), page('b', { state: 'replaced', replacedBy: 'a' })], 'a')?.state, 'replaced', 'going round');
    assert.equal(newestPage([page('a', { state: 'replaced', replacedBy: 'gone' })], 'a')?.id, 'a');
    assert.equal(newestPage(chain, 'nope'), undefined);
  });

  it('says the page is unavailable once its plan is gone, or when it is retired, replaced by a retired one or not in the plan', () => {
    assert.equal(pageView(null, 'a', false).kind, 'waiting', 'no plan seen yet');
    assert.equal(pageView(null, 'a', true).kind, 'gone', 'the plan gone: PM forgotten, setting off');
    assert.equal(pageView({ pages: [page('a', { state: 'retired' })] }, 'a', true).kind, 'gone');
    assert.equal(pageView({ pages: [page('a', { state: 'replaced', replacedBy: 'b' }), page('b', { state: 'retired' })] }, 'a', true).kind, 'gone');
    assert.equal(pageView({ pages: [page('b')] }, 'a', true).kind, 'gone');
  });

  it('offers "seen" only for an open page that asks nothing, and reopening only while no newer page of its source followed it', () => {
    const offer = (pages: PmPage[], id: string) => { const view = pageView({ pages }, id, true); return view.kind === 'shown' ? view.offer : null; };
    assert.deepEqual(offer([page('a')], 'a'), { answer: true, seen: true, reply: true, reopen: false });
    assert.deepEqual(offer([page('a', { questions: ['Q4'] })], 'a'), { answer: true, seen: false, reply: false, reopen: false });
    assert.equal(offer([page('a', { state: 'answered' })], 'a')?.reopen, true);
    assert.equal(offer([page('a', { state: 'seen' }), page('b', { source: 'other' })], 'a')?.reopen, true, 'a newer page of another source');
    const followed = pageView({ pages: [page('a', { state: 'answered' }), page('b', { state: 'retired' }), page('c')] }, 'a', true);
    assert.equal(followed.kind === 'shown' && followed.offer.reopen, false);
    assert.equal(followed.kind === 'shown' && followed.newer?.id, 'c', 'the newer page to go to, not the retired one');
  });
});
