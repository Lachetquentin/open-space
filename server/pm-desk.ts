// What the pages see of the project managers (PM) and what the user does with them: each PM's summary in its session,
// the plan of the PMs a page looks at (pmDetail), the user's answers and changes. Every one of them waits for the setting
// and for a session that acts as a PM (pm-guards.ts); otherwise it is ignored. The answer path (answer) is the one every
// channel takes, so that a question takes one answer only and its PM hears it once.
import {
  answerMessage, asksShown, type PmAsk, type PmDetail, type PmFile, type PmMessageTag, type PmSummary, pmSummary, typedAnswer, workerLive,
} from '../shared/pm.ts';
import type { ClientMessage, ServerMessage, SessionInfo } from '../shared/protocol.ts';
import { st } from './i18n/index.ts';
import type { PmBook } from './pm.ts';
import { actsAsPm } from './pm-guards.ts';
import {
  answerAsk, archiveItem, dismissAsk, editMemory, type Err, setInstructions, setMission, snoozeAsk, undoDismiss, wakeAsk,
} from './pm-ops.ts';

/** A page: where its messages go. One page is one key, kept until its socket closes (leave). */
export type Viewer = (message: ServerMessage) => void;
type PmRequest = Extract<ClientMessage, { t: 'pmWatch' | 'pmEdit' | 'pmAsk' | 'pmItemArchive' }>;
interface Timer { clear: () => void }

export interface DeskDeps {
  book: PmBook;
  sessions: () => SessionInfo[];
  enabled: () => boolean;
  now: () => number;
  /** sends the session to every page again, its summary computed anew (SessionManager.republish) */
  republish: (sessionId: string) => void;
  /** sends a message to the PM: sessions.send(pm, text, [], [], tag) */
  deliver: (pm: string, text: string, tag: PmMessageTag) => void;
  /** tells the user, out of the page (a notification), that the PM asks a new question */
  notifyDecision?: (pm: SessionInfo, ask: PmAsk) => void;
  /** runs `run` in `ms`; replaceable in tests */
  setTimer?: (run: () => void, ms: number) => Timer;
  log?: (message: string, error: unknown) => void;
}

/** setTimeout fires at once past this delay: a later wake is waited for in steps. */
const MAX_TIMER_MS = 2_147_483_647;

const realTimer = (run: () => void, ms: number): Timer => {
  const timer = setTimeout(run, ms);
  timer.unref();
  return { clear: () => clearTimeout(timer) };
};

/** What a worker is doing, as its PM's plan reads it: what tells a change worth sending again. */
const doing = (session: SessionInfo): string => { const [live] = workerLive([session]); return live.waiting ? 'waiting' : live.working ? 'working' : 'idle'; };

export class PmDesk {
  private readonly deps: DeskDeps;
  /** the PMs each page looks at */
  private readonly watching = new Map<Viewer, Set<string>>();
  /** the one timer of each PM with a question snoozed: when it comes back, its summary and plan go out again */
  private readonly wakes = new Map<string, { at: number; timer: Timer }>();
  /** what each worker was doing when last sent */
  private readonly doing = new Map<string, string>();
  /** the PMs whose file is being read for the first time */
  private readonly loading = new Set<string>();
  /** the numbers of the questions already in each PM's file: one not among them is new */
  private readonly asked = new Map<string, Set<number>>();

  constructor(deps: DeskDeps) {
    this.deps = deps;
    deps.book.onChange((pm) => this.refresh(pm));
  }

  /** At startup: each PM's file read, then its summary sent. */
  start(): void {
    for (const session of this.deps.sessions()) if (session.pm) this.refresh(session.id);
  }

  /** The PM's summary for its session, while it acts as one; undefined until its file was read once (then it is sent again). */
  summary(session: SessionInfo): PmSummary | undefined {
    if (!actsAsPm(session, this.deps.enabled())) { this.wake(session.id, undefined); return undefined; }
    const file = this.file(session.id);
    if (!file) return undefined;
    const summary = pmSummary(file, this.liveOf(file), this.deps.now());
    this.wake(session.id, summary.nextWake);
    return summary;
  }

  /** A session went out to the pages: a worker that started or stopped working, or waits for the user, moves its PM's line. */
  sessionShown(session: SessionInfo): void {
    if (session.pm || !session.pmOf) return;
    const now = doing(session);
    if (this.doing.get(session.id) === now) return;
    this.doing.set(session.id, now);
    if (this.lead(session.pmOf)) this.refresh(session.pmOf);
  }

  /** The PM's summary and plan sent again: its file changed, a worker moved, a snooze ended, its role changed. */
  refresh(pm: string): void {
    this.announce(pm);
    // made an ordinary session again (pmRevert): no summary is asked of it any more, so its timer goes here
    if (!this.lead(pm)) this.wake(pm, undefined);
    this.deps.republish(pm);
    if (![...this.watching.values()].some((pms) => pms.has(pm))) return;
    const detail = this.detail(pm);
    // its file is being read: this runs again once it is
    if (detail === undefined) return;
    for (const [viewer, pms] of this.watching) if (pms.has(pm)) viewer({ t: 'pmDetail', pm, detail });
  }

  /** The setting turned on or off: every PM's summary and plan come or go. */
  settingChanged(): void {
    const pms = new Set([...this.deps.sessions().filter((one) => one.pm).map((one) => one.id), ...[...this.watching.values()].flatMap((one) => [...one])]);
    for (const pm of pms) this.refresh(pm);
  }

  /** A session forgotten: its timer goes; the pages that looked at it hear it is gone. */
  forgotten(sessionId: string): void {
    this.wake(sessionId, undefined);
    this.doing.delete(sessionId);
    this.refresh(sessionId);
  }

  /** The PMs a page looks at now: each new one's plan is sent to it at once. */
  async watch(viewer: Viewer, pms: readonly string[]): Promise<void> {
    const before = this.watching.get(viewer) ?? new Set<string>();
    const next = new Set(pms);
    if (next.size) this.watching.set(viewer, next);
    else this.watching.delete(viewer);
    for (const pm of next) {
      if (before.has(pm)) continue;
      const detail = await this.detailNow(pm);
      // looked away (or gone) meanwhile
      if (this.watching.get(viewer)?.has(pm)) viewer({ t: 'pmDetail', pm, detail });
    }
  }

  /** The page is gone (its socket closed): it looks at nothing any more. */
  leave(viewer: Viewer): void {
    this.watching.delete(viewer);
  }

  /** A PM request of the page; ignored while the setting is off or for a session that does not act as a PM. A refusal throws (a toast). */
  async handle(message: PmRequest, viewer: Viewer): Promise<void> {
    if (message.t === 'pmWatch') { await this.watch(viewer, message.pms); return; }
    if (!this.lead(message.pm)) return;
    const { pm } = message;
    const now = this.deps.now();
    if (message.t === 'pmItemArchive') { refused(await this.deps.book.change(pm, (file) => archiveItem(file, message.item))); return; }
    if (message.t === 'pmEdit') { await this.edit(pm, message); return; }
    const { ask } = message;
    switch (message.action) {
      case 'answer': refused(await this.answer(pm, ask, message.answer ?? '')); return;
      case 'snooze': refused(await this.deps.book.change(pm, (file) => snoozeAsk(file, ask, message.until ?? 0, now))); return;
      case 'wake': refused(await this.deps.book.change(pm, (file) => wakeAsk(file, ask))); return;
      case 'dismiss': refused(await this.deps.book.change(pm, (file) => dismissAsk(file, ask, now))); return;
      case 'undoDismiss': refused(await this.deps.book.change(pm, (file) => undoDismiss(file, ask))); return;
    }
  }

  /**
   * The user's answer to question `ask` of `pm`, from any channel (the page, the queue "for you", a chat bot): written in
   * the PM's file, then sent to the PM once, as "W4 Q3: answer". A question already settled (answered elsewhere first)
   * gives an error and nothing is sent. Refused while the setting is off or for a session that does not act as a PM.
   */
  async answer(pm: string, ask: number, answer: string): Promise<PmAsk | Err> {
    if (!this.lead(pm)) return { error: this.deps.enabled() ? st.pm.notAPm : st.pm.disabled };
    const answered = await this.deps.book.change(pm, (file) => answerAsk(file, ask, answer, this.deps.now()));
    if ('error' in answered) return answered;
    this.tell(pm, answerMessage(answered, answered.answer ?? answer), { answer: { ask } });
    return answered;
  }

  /** A message the user typed to a PM: one that starts with an open question's tag ("W4 Q3: …") answers it. It is sent as it is. */
  async typed(pm: string, text: string): Promise<void> {
    if (!this.lead(pm)) return;
    await this.deps.book.change(pm, (file) => {
      const typed = typedAnswer(file, text);
      if (typed) answerAsk(file, typed.ask, typed.answer, this.deps.now());
    });
  }

  /** The user changes the mission, the instructions or a note: the PM is told in one message, when something changed. */
  private async edit(pm: string, change: Extract<PmRequest, { t: 'pmEdit' }>): Promise<void> {
    const now = this.deps.now();
    const notes = await this.deps.book.change(pm, (file): string[] | Err => {
      // the memory first: it is the only part that can be refused, and a refusal must leave the file as it is
      const memory = change.memory && editMemory(file, change.memory, now);
      if (memory && 'error' in memory) return memory;
      const told: string[] = [];
      if (memory && change.memory) {
        const { noteAdded, noteEdited, noteDeleted } = st.pm.userChanged;
        told.push({ add: noteAdded, edit: noteEdited, delete: noteDeleted }[change.memory.op](memory.number, memory.text));
      }
      const before = { mission: file.mission, instructions: file.instructions };
      if (change.mission !== undefined) setMission(file, change.mission);
      if (change.instructions !== undefined) setInstructions(file, change.instructions);
      if (file.mission !== before.mission) told.push(st.pm.userChanged.mission(file.mission));
      if (file.instructions !== before.instructions) told.push(st.pm.userChanged.instructions(file.instructions));
      return told;
    });
    refused(notes);
    if (Array.isArray(notes) && notes.length) this.tell(pm, notes.join('\n\n'), { change: true });
  }

  /** A message to the PM; one it cannot take (closing) is dropped: what it says stays written in its file. */
  private tell(pm: string, text: string, tag: PmMessageTag) {
    try {
      this.deps.deliver(pm, text, tag);
    } catch (error) {
      this.deps.log?.('a message to a PM was dropped: it could not take it (closing or gone)', error);
    }
  }

  /** The session `pm` while it acts as a PM. */
  private lead(pm: string): SessionInfo | undefined {
    const session = this.deps.sessions().find((one) => one.id === pm);
    return actsAsPm(session, this.deps.enabled()) ? session : undefined;
  }

  /** The PM's file at hand; undefined the first time, while it is read (its summary and plan then go out). */
  private file(pm: string): PmFile | undefined {
    const file = this.deps.book.cached(pm);
    if (file && !this.asked.has(pm)) this.asked.set(pm, numbers(file));
    if (file || this.loading.has(pm)) return file;
    this.loading.add(pm);
    this.deps.book.read(pm)
      .then(() => { this.loading.delete(pm); this.refresh(pm); })
      .catch((error: unknown) => { this.loading.delete(pm); this.deps.log?.(`cannot read the PM file of ${pm}`, error); });
    return undefined;
  }

  /**
   * A question open in the PM's file that was not there before: the user is notified of it once, while the session acts
   * as a PM. The questions of a file seen for the first time are not new: they were there before Open Space looked.
   */
  private announce(pm: string) {
    const file = this.deps.book.cached(pm);
    const known = this.asked.get(pm);
    if (!file) { this.asked.delete(pm); return; }
    this.asked.set(pm, numbers(file));
    const { notifyDecision } = this.deps;
    const lead = this.lead(pm);
    if (!known || !notifyDecision || !lead) return;
    for (const ask of asksShown(file, this.deps.now()).open) {
      if (known.has(ask.no)) continue;
      try {
        notifyDecision(lead, ask);
      } catch (error) {
        this.deps.log?.('a PM question could not be notified', error);
      }
    }
  }

  /** What the PM's workers are doing now. */
  private liveOf(file: PmFile) {
    return workerLive(this.deps.sessions().filter((one) => file.workers.some((worker) => worker.session === one.id)));
  }

  /** The plan a page sees: null when `pm` does not act as a PM; undefined while its file is read for the first time. */
  private detail(pm: string): PmDetail | null | undefined {
    if (!this.lead(pm)) return null;
    const file = this.file(pm);
    return file && this.shown(pm, file);
  }

  /** The same, its file read when it is not at hand. */
  private async detailNow(pm: string): Promise<PmDetail | null> {
    if (!this.lead(pm)) return null;
    return this.shown(pm, this.deps.book.cached(pm) ?? await this.deps.book.read(pm));
  }

  private shown(pm: string, file: PmFile): PmDetail {
    const { reports: _reports, ...plan } = file;
    return { ...plan, pm, live: this.liveOf(file) };
  }

  /** Sets the PM's timer for `at` (none: no question snoozed), once: a summary computed again for the same time keeps it. */
  private wake(pm: string, at: number | undefined) {
    const armed = this.wakes.get(pm);
    if (armed?.at === at) return;
    armed?.timer.clear();
    this.wakes.delete(pm);
    if (at === undefined) return;
    const delay = Math.min(MAX_TIMER_MS, Math.max(0, at - this.deps.now()));
    // a wake further than the longest delay: the timer fires early, the summary computed then sets it again
    const timer = (this.deps.setTimer ?? realTimer)(() => { this.wakes.delete(pm); this.refresh(pm); }, delay);
    this.wakes.set(pm, { at, timer });
  }
}

const numbers = (file: PmFile): Set<number> => new Set(file.asks.map((ask) => ask.no));

/** A refusal of an operation, as the page's toast. */
function refused(result: unknown): void {
  if (typeof result === 'object' && result !== null && 'error' in result) throw new Error(String((result as Err).error));
}
