// The live pages of the project managers (PM): the HTML a PM shows the user (pm_page_show), kept as it wrote it under
// OFFICE_DIR/pm/pages/<PM>/<page>.html (0600, written whole), and the document Open Space serves of it: the page behind a
// small kit (styles readable in both themes, the answers gathered and sent to the window around it), under a policy that
// lets it reach nothing outside itself and runs no script but the kit's: a page is a form of HTML and CSS. Which page is
// served, to whom, is the desk's to say (server/pm-desk.ts).
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { PAGE_ID, SESSION_ID } from '../shared/pm.ts';
import { writeFileAtomic } from './atomic-write.ts';
import { st } from './i18n/index.ts';

/** Where each PM's pages are kept: a folder per PM, so that forgetting the PM takes them all, even with its file damaged. */
export class PmPages {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** The page's HTML file; null for a PM or a page id that could lead out of the folder. */
  private file(pm: string, page: string): string | null {
    return SESSION_ID.test(pm) && PAGE_ID.test(page) ? path.join(this.dir, pm, `${page}.html`) : null;
  }

  async write(pm: string, page: string, html: string): Promise<void> {
    const file = this.file(pm, page);
    if (!file) throw new Error(st.pm.noPage(page));
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFileAtomic(file, html);
  }

  /** The page's HTML as the PM wrote it; null when there is none. */
  async read(pm: string, page: string): Promise<string | null> {
    const file = this.file(pm, page);
    if (!file) return null;
    try {
      return await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  /** Deletes these pages' files; an id that names no file is passed over. */
  async remove(pm: string, pages: readonly string[]): Promise<void> {
    for (const page of pages) {
      const file = this.file(pm, page);
      if (file) await rm(file, { force: true });
    }
  }

  /** Deletes every page of the PM (it is forgotten). */
  async removeAll(pm: string): Promise<void> {
    if (SESSION_ID.test(pm)) await rm(path.join(this.dir, pm), { recursive: true, force: true });
  }
}

/**
 * What a page may do: run the kit's script only (its nonce, new for each response: the PM's own <script> and onclick do not
 * run, so nothing it wrote can read what is typed and take it elsewhere), use its inline styles, show data: images and
 * fonts, nothing else. No request leaves it (fetch, an image, a font, a frame, a form), and its sandbox (here, and the
 * iframe's) gives it an origin of its own: no cookie, no access to Open Space's page, no popup, no navigation of the page
 * around it. Only Open Space frames it.
 */
const pageCsp = (nonce: string): string => [
  'sandbox allow-scripts', "default-src 'none'", `script-src 'nonce-${nonce}'`, "style-src 'unsafe-inline'", 'img-src data:', 'font-src data:',
  "form-action 'none'", "frame-src 'none'", "base-uri 'none'", "frame-ancestors 'self'",
].join('; ');

/**
 * The kit's styles: readable on their own (the system's colours, light or dark as the system is), then in Open Space's look
 * once the window sends its tokens (the same `theme` message as a mod's, see the kit's script). The page's own styles come
 * after, so they win.
 */
const KIT_STYLE = `
*,*::before,*::after{box-sizing:border-box}
:root{color-scheme:light dark;background:Canvas;color:var(--color-text,CanvasText);font:14px/1.5 var(--font-ui,system-ui,-apple-system,'Segoe UI',sans-serif)}
:root[data-themed]{color-scheme:dark;background:transparent}
body{margin:0;padding:16px}
h1,h2,h3{margin:0 0 .5em;line-height:1.25}h1{font-size:1.3em}h2{font-size:1.15em}h3{font-size:1em}
p,ul,ol{margin:0 0 .75em}
a{color:var(--color-accent,LinkText)}
img,svg,video{max-width:100%;height:auto}
small,.muted{color:var(--color-text-muted,GrayText)}
label{display:block;margin:.6em 0 .25em}
label:has(>input[type=checkbox],>input[type=radio]){display:flex;gap:.5em;align-items:center;margin:.35em 0}
input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]),select,textarea{width:100%;padding:.5em .65em;font:inherit;color:inherit;background:var(--glass-tint,Field);border:1px solid var(--color-border-strong,ButtonBorder);border-radius:var(--radius-sm,8px)}
textarea{min-height:5em;resize:vertical}
input[type=checkbox],input[type=radio]{accent-color:var(--color-accent,AccentColor)}
button,[data-answer]:not(input):not(select):not(textarea){display:inline-flex;align-items:center;gap:.4em;margin:0 .4em .4em 0;padding:.45em .9em;font:inherit;color:inherit;background:var(--glass-tint,ButtonFace);border:1px solid var(--color-border-strong,ButtonBorder);border-radius:var(--radius-sm,8px);cursor:pointer}
button:hover,[data-answer]:not(input):not(select):not(textarea):hover{border-color:var(--color-text-muted,GrayText)}
[data-answer][aria-pressed=true]{background:var(--color-accent-soft,Highlight);border-color:var(--color-accent,AccentColor)}
button[type=submit],[data-submit]{background:var(--color-accent,AccentColor);color:var(--color-accent-text,AccentColorText);border-color:transparent}
:focus-visible{outline:2px solid var(--color-focus,Highlight);outline-offset:1px}
fieldset{margin:0 0 1em;padding:.75em 1em;border:1px solid var(--color-border,GrayText);border-radius:var(--radius-md,12px)}
legend{padding:0 .35em;font-weight:600}
table{width:100%;margin:0 0 1em;border-collapse:collapse}th,td{padding:.4em .5em;text-align:left;border-bottom:1px solid var(--color-border,GrayText)}
.os-actions{display:flex;justify-content:flex-end;margin-top:1em}
[hidden]{display:none!important}
`;

/**
 * The kit's script. With the window around it (Task C's PmPageWindow), by postMessage to and from that window only:
 * - it says `{ openSpace: 'ready' }`, and takes `{ openSpace: 'theme', vars, style, language, reducedMotion }` (what a mod
 *   gets, src/command/useModPage.tsx): the tokens set on its root, the look switched to Open Space's;
 * - on Send it says `{ type: 'pm.page.submit', answers }`: an object of each field's value, under its data-answer, else its
 *   name, else its id, else "field<n>" (a checkbox alone: true or false; several under one name: the values checked; a radio
 *   group: the value checked or null; a multiple select: the values chosen), and of each choice (an element with
 *   data-answer that is no field: its data-value, or its text, once pressed; one per name unless data-multiple).
 * Send is a click on an element with data-submit, on a submit button (a <button> without type="button", in a form or not:
 * the sandbox lets no form be submitted, so the kit takes it), Enter in a form's field, or the Send button the kit adds
 * when the page has something to answer and no way to send it. Once sent, the root carries data-sent and Send does
 * nothing until the window says `{ openSpace: 'unsent' }` (nothing went, the answer was refused, the page opened again).
 * A click on a link (a[href], area[href]) goes nowhere: CSS can put a link under what was just typed or checked.
 */
const KIT_SCRIPT = `(function () {
  'use strict';
  var host = window.parent !== window ? window.parent : null;
  var root = document.documentElement;
  var CHOICE = '[data-answer]:not(input):not(select):not(textarea)';
  function say(message) { if (host) host.postMessage(message, '*'); }
  addEventListener('message', function (event) {
    var message = event.data;
    if (event.source !== host || !message) return;
    if (message.openSpace === 'unsent') { root.removeAttribute('data-sent'); return; }
    if (message.openSpace !== 'theme') return;
    var vars = message.vars && typeof message.vars === 'object' ? message.vars : {};
    Object.keys(vars).forEach(function (name) {
      if (/^--[\\w-]+$/.test(name) && typeof vars[name] === 'string') root.style.setProperty(name, vars[name]);
    });
    if (typeof message.style === 'string') root.setAttribute('data-window-style', message.style);
    if (typeof message.language === 'string') root.lang = message.language;
    root.toggleAttribute('data-reduced-motion', !!message.reducedMotion);
    root.setAttribute('data-themed', '');
  });
  function keyOf(element, index) { return element.getAttribute('data-answer') || element.name || element.id || 'field' + (index + 1); }
  function listAt(answers, key) { return Array.isArray(answers[key]) ? answers[key] : (answers[key] = []); }
  function answers() {
    var found = Object.create(null);
    var fields = Array.prototype.slice.call(document.querySelectorAll('input, select, textarea'));
    var boxes = Object.create(null);
    fields.forEach(function (field, index) { if (field.type === 'checkbox') { var key = keyOf(field, index); boxes[key] = (boxes[key] || 0) + 1; } });
    fields.forEach(function (field, index) {
      var type = field.type;
      if (type === 'submit' || type === 'button' || type === 'reset' || type === 'image' || type === 'file') return;
      var key = keyOf(field, index);
      if (type === 'checkbox') {
        if (boxes[key] > 1) { var checked = listAt(found, key); if (field.checked) checked.push(field.value); } else found[key] = field.checked;
      } else if (type === 'radio') {
        if (field.checked) found[key] = field.value; else if (!(key in found)) found[key] = null;
      } else if (field.tagName === 'SELECT' && field.multiple) {
        found[key] = Array.prototype.filter.call(field.options, function (option) { return option.selected; }).map(function (option) { return option.value; });
      } else found[key] = field.value;
    });
    document.querySelectorAll(CHOICE).forEach(function (choice) {
      var key = choice.getAttribute('data-answer');
      var value = choice.hasAttribute('data-value') ? choice.getAttribute('data-value') : choice.textContent.trim();
      var pressed = choice.getAttribute('aria-pressed') === 'true';
      if (choice.hasAttribute('data-multiple')) { var chosen = listAt(found, key); if (pressed) chosen.push(value); }
      else if (pressed) found[key] = value; else if (!(key in found)) found[key] = null;
    });
    return found;
  }
  function submit() {
    if (root.hasAttribute('data-sent')) return;
    try { say({ type: 'pm.page.submit', answers: answers() }); root.setAttribute('data-sent', ''); } catch (error) { console.error(error); }
  }
  function sends(element) {
    if (element.hasAttribute('data-submit')) return true;
    if (element.matches(CHOICE)) return false;
    if (element.tagName === 'INPUT') return element.type === 'submit' || element.type === 'image';
    // no script of the page runs, so a button is there to send unless it says type="button" (or reset)
    return element.tagName === 'BUTTON' && element.type === 'submit';
  }
  document.addEventListener('click', function (event) {
    var target = event.target instanceof Element ? event.target : null;
    if (target && target.closest('a, area')) event.preventDefault();
    var choice = target && target.closest(CHOICE);
    if (choice) {
      event.preventDefault();
      var key = choice.getAttribute('data-answer');
      if (choice.hasAttribute('data-multiple')) choice.setAttribute('aria-pressed', choice.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      else {
        document.querySelectorAll(CHOICE).forEach(function (other) { if (other.getAttribute('data-answer') === key && !other.hasAttribute('data-multiple')) other.setAttribute('aria-pressed', 'false'); });
        choice.setAttribute('aria-pressed', 'true');
      }
      if (choice.hasAttribute('data-submit')) submit();
      return;
    }
    var button = target && target.closest('[data-submit], button, input[type=submit], input[type=image]');
    if (button && sends(button)) { event.preventDefault(); submit(); }
  }, true);
  document.addEventListener('keydown', function (event) {
    var field = event.target;
    if (event.key !== 'Enter' || event.isComposing || !(field instanceof HTMLInputElement) || !field.form) return;
    if (['submit', 'image', 'button', 'reset', 'file'].indexOf(field.type) >= 0) return;
    event.preventDefault();
    submit();
  }, true);
  function addSend() {
    var asks = document.querySelector('input:not([type=hidden]), select, textarea, ' + CHOICE);
    var canSend = Array.prototype.some.call(document.querySelectorAll('[data-submit], button, input[type=submit], input[type=image]'), sends);
    if (!asks || canSend || !document.body) return;
    var bar = document.createElement('div');
    bar.className = 'os-actions';
    var button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-submit', '');
    button.textContent = SEND;
    bar.appendChild(button);
    document.body.appendChild(bar);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addSend); else addSend();
  say({ openSpace: 'ready' });
})();`;

/** A text inside a <script>: as JSON, with nothing that could close the element. */
const scriptValue = (value: string): string => JSON.stringify(value).replace(/</g, '\\u003c');

/**
 * What is served for a page, made again for each response: its policy, with a new nonce, and its document. The kit first,
 * closed before any of the page (so that nothing the PM wrote can take its nonce, and the page's own styles come after),
 * then the page as the PM wrote it, a fragment or a whole document (its doctype dropped: the browser merges its <html>,
 * <head> and <body> into the ones the kit opened). Its <script> tags stay, inert. Its <meta> start tags are renamed so that none refreshes the page to an address
 * elsewhere: this match is linear and finds each of them whatever its quotes (the word http-equiv in the page's text stays as written).
 */
export function pageDocument(html: string): { csp: string; body: string } {
  const nonce = randomBytes(18).toString('base64');
  const kit = `<style>${KIT_STYLE}</style><script nonce="${nonce}">var SEND = ${scriptValue(st.pm.pageSend)};\n${KIT_SCRIPT}</script>`;
  const page = html.replace(/^﻿?\s*<!doctype[^>]*>/i, '').replace(/<meta(?=[\s/>])/gi, '<x-meta');
  return { csp: pageCsp(nonce), body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${kit}${page}` };
}
