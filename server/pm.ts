// The PM files: one per project manager session, OFFICE_DIR/pm/<id of the PM>.json, read when asked for and written whole.
// Changes to one PM's file run one after the other (the model calls several pm_* tools at once), so no W or Q number is
// handed out twice and no write is lost.
import { constants, mkdirSync } from 'node:fs';
import { copyFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { emptyPm, type PmFile, parsePmFile, SESSION_ID } from '../shared/pm.ts';
import { writeFileAtomic } from './atomic-write.ts';
import { st } from './i18n/index.ts';
import { PmPages } from './pm-pages.ts';

/** An edit of a PM file: synchronous, since what it changes after an await would be compared too early and never written. */
type Edit<T> = (file: PmFile) => T extends PromiseLike<unknown> ? never : T;

export class PmBook {
  private readonly dir: string;
  /** The HTML of each PM's live pages, under pages/<PM>/ (made on the first page): they go with the PM's file. */
  readonly pages: PmPages;
  /** The last change queued for each PM, never rejected: the next one waits for it. */
  private readonly queues = new Map<string, Promise<unknown>>();
  /** Each PM's file as last read or written, for what cannot wait (a session's summary): a copy no caller changes. */
  private readonly files = new Map<string, PmFile>();
  private readonly listeners = new Set<(pm: string) => void>();

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.pages = new PmPages(path.join(dir, 'pages'));
  }

  /** The PM's file: empty when there is none, its readable part when it is damaged. */
  read(pm: string): Promise<PmFile> {
    return this.queue(pm, async (file) => {
      const data = await this.load(file);
      this.files.set(pm, structuredClone(data));
      return data;
    });
  }

  /** The PM's file as last read or written, without waiting; undefined before its first read. Not to be changed. */
  cached(pm: string): PmFile | undefined {
    return this.files.get(pm);
  }

  /** Hears each PM whose file was written or removed, once that is done; gives what stops it. */
  onChange(listener: (pm: string) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /**
   * Runs `edit` on the PM's file once the changes before it are done, then writes the file if `edit` changed it.
   * An edit that gives `{ error }` must have changed nothing (the operations of pm-ops.ts check everything first), and
   * its caller stops there: the error is the result, nothing else is done in the same edit.
   */
  change<T>(pm: string, edit: Edit<T>): Promise<T> {
    return this.queue(pm, async (file) => {
      const data = await this.load(file);
      const before = JSON.stringify(data);
      const result = edit(data);
      const after = JSON.stringify(data);
      if (after !== before) await writeFileAtomic(file, after);
      this.files.set(pm, structuredClone(data));
      if (after !== before) this.tell(pm);
      return result;
    });
  }

  /** Deletes the PM's file and its pages, once the changes before are done. */
  remove(pm: string): Promise<void> {
    // the copy kept of a damaged file goes with it
    return this.queue(pm, async (file) => {
      await rm(file, { force: true });
      await rm(`${file}.bad`, { force: true });
      await this.pages.removeAll(pm);
      this.files.delete(pm);
      this.tell(pm);
    });
  }

  /** A listener that throws keeps neither the others nor the change from going on. */
  private tell(pm: string) {
    for (const listener of this.listeners) {
      try { listener(pm); } catch { /* the listener's own failure, not the change's */ }
    }
  }

  private queue<T>(pm: string, task: (file: string) => Promise<T>): Promise<T> {
    // a PM is a session: its id never leaves the folder
    if (!SESSION_ID.test(pm)) return Promise.reject(new Error(st.pm.badId(pm)));
    const file = path.join(this.dir, `${pm}.json`);
    const run = (this.queues.get(pm) ?? Promise.resolve()).then(() => task(file));
    const tail = run.catch(() => {});
    this.queues.set(pm, tail);
    void tail.then(() => { if (this.queues.get(pm) === tail) this.queues.delete(pm); });
    return run;
  }

  private async load(file: string): Promise<PmFile> {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyPm();
      // a file that is there but cannot be read must not be written over by an empty one
      throw error;
    }
    try {
      return parsePmFile(JSON.parse(text));
    } catch {
      // kept for inspection before the next change writes over it; the first copy stays, a later one would be the empty file
      await copyFile(file, `${file}.bad`, constants.COPYFILE_EXCL).catch(() => {});
      return parsePmFile(undefined);
    }
  }
}
