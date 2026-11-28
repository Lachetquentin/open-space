import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BRANCH_PREFIX, workSlug } from '../../shared/worktrees.ts';
import type { Conversation, Effort, PermissionMode, ReusableBranch, TuneChange } from '../../shared/protocol.ts';
import { defaultFolder, folderName, formatAgo, homeRelative } from '../lib/format.ts';
import { availability, stillFree } from '../state/availability.ts';
import { useProjects } from '../state/useProjects.ts';
import { useSessions } from '../state/sessions.ts';
import { LAUNCHER_DRAFT, readDraft, writeDraft } from '../state/drafts.ts';
import { branchPreview, isolationOffer, occupants, reuseChoice } from '../state/worktrees.ts';
import { BranchName } from './BranchCard.tsx';
import { Switch } from './Switch.tsx';
import { AttachButton, AttachmentStrip, DropOverlay } from './Attachments.tsx';
import { CommandField, useMentionable } from './CommandField.tsx';
import { t } from '../i18n/index.ts';
import { useAttachments } from './useAttachments.ts';
import { BranchIcon, ChevronDownIcon, CleanIcon, CloseIcon, FolderIcon, FolderOpenIcon, HistoryIcon, KeepIcon, SendIcon, SendUpIcon, TagIcon } from './Icons.tsx';
import { sessionTagHues } from '../design/tag-colors.ts';
import { FolderPicker } from './FolderPicker.tsx';
import { Snippet } from './Snippet.tsx';
import { PersonPicker } from './PersonPicker.tsx';
import { ProjectPicker } from './ProjectPicker.tsx';
import { TuneMenu } from './TuneMenu.tsx';
import { usePhone } from '../lib/phone.ts';
import { useDismiss } from './useDismiss.ts';


/**
 * Where a session starts when none is open: a message field at the bottom, with its folder (the default one when left empty),
 * model, effort, permissions, ultracode and fast mode; above it, the folder's Claude Code conversations when resuming one. Enter starts the session,
 * which opens in its place. N puts the focus here; Shift+N starts a session at once (see App.tsx). `onClose`: shown as
 * a window beside the open sessions (focus mode), it can be closed; `replacing`: the session the new one will take the
 * place of, when no room is left.
 * Two layouts of the same launcher (Preferences.launcherStyle): 'classic', the field at the foot of the column, and
 * 'streamlined', also at the foot of the column: a question, the field under it and its options in chips; only the markup differs.
 */
export function Launcher({ onClose, replacing }: { onClose?: () => void; replacing?: string }) {
  const roots = useSessions((s) => s.roots);
  const directories = useSessions((s) => s.directories);
  const found = useSessions((s) => s.conversations);
  const draft = useSessions((s) => s.newSession);
  const openNewSession = useSessions((s) => s.openNewSession);
  const createSession = useSessions((s) => s.createSession);
  const send = useSessions((s) => s.send);
  const live = useSessions((s) => s.connection === 'live');
  const crew = useSessions((s) => s.crew);
  const sessions = useSessions((s) => s.sessions);
  const people = useMemo(() => availability(crew, Object.values(sessions)), [crew, sessions]);
  const mentionable = useMentionable();
  // someone asked for who got a session meanwhile is not asked for any more
  const [asked, setAsked] = useState<string | null>(null);
  const person = stillFree(asked, people);

  const [resuming, setResuming] = useState(false);
  const [folder, setFolder] = useState('');
  const preferences = useSessions((s) => s.preferences);
  const [model, setModel] = useState(preferences.model);
  const [effort, setEffort] = useState<Effort | undefined>(preferences.effort || undefined);
  const [ultracode, setUltracode] = useState(false);
  const [fastMode, setFastMode] = useState(false);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(preferences.permissionMode);
  // the settings arrive with the server's hello, maybe after the launcher showed
  useEffect(() => { setModel(preferences.model); setEffort(preferences.effort || undefined); setPermissionMode(preferences.permissionMode); }, [preferences.model, preferences.effort, preferences.permissionMode]);
  // kept while a session is open in its place: going back finds it again
  const [text, setTyped] = useState(() => readDraft(LAUNCHER_DRAFT));
  const setText = useCallback((value: string) => { writeDraft(LAUNCHER_DRAFT, value); setTyped(value); }, []);
  const [resumeId, setResumeId] = useState<string | null>(null);
  // words to find in the folder's conversations (their messages, not only their titles)
  const [query, setQuery] = useState('');
  const wanted = query.trim();
  const field = useRef<HTMLTextAreaElement>(null);
  const folderBox = useRef<HTMLSpanElement>(null);
  const attachments = useAttachments();
  // a project picked in the header is where a new session goes, while it is one the sessions may work in
  const { project } = useProjects();
  const startFolder = defaultFolder(roots, project || preferences.defaultFolder);
  const cwd = folder.trim() || startFolder;
  const conversations = found && found.cwd === cwd && found.query === wanted ? found.list : null;

  // the folder's repository, asked for once the user stops typing it: whether to offer a branch of its own
  const repo = useSessions((s) => s.folderRepos[cwd]);
  const openBranches = useSessions((s) => s.openBranches);
  // and again when a session comes or goes: a branch another one took is no longer on offer
  const sessionCount = Object.keys(sessions).length;
  useEffect(() => {
    if (!cwd || !live) return;
    const timer = window.setTimeout(() => send({ t: 'folderInfo', cwd }), 250);
    return () => window.clearTimeout(timer);
  }, [cwd, live, send, sessionCount]);
  const taken = useMemo(() => (repo ? occupants(Object.values(sessions), repo) : []), [repo, sessions]);
  const offer = isolationOffer(preferences.isolate, repo, taken.length);
  // the user's own choice for this folder (the line's switch or the panel's Shared / Isolated), else the setting's
  const [isolateChoice, setIsolateChoice] = useState<{ cwd: string; isolated: boolean } | null>(null);
  const [base, setBase] = useState<{ cwd: string; branch: string } | null>(null);
  const [choosingBase, setChoosingBase] = useState(false);
  const canIsolate = !resuming && !!repo?.branch;
  const isolated = canIsolate && (isolateChoice?.cwd === cwd ? isolateChoice.isolated : offer.checked);
  const startBase = base?.cwd === cwd && repo?.branches.includes(base.branch) ? base.branch : repo?.branch ?? '';
  // a branch of the folder to go on with ("Previous worktree" / "or go on with a kept branch"), while the server still offers it
  const [reuse, setReuse] = useState<{ cwd: string; branch: string } | null>(null);
  const reusable = repo?.reusable ?? [];
  const streamlined = preferences.launcherStyle === 'streamlined';
  // any new choice of workspace forgets the branch that is gone (and its notice)
  const chooseIsolated = (next: boolean) => { setIsolateChoice({ cwd, isolated: next }); if (!next) setReuse(null); };
  const { branch: reused, gone } = reuseChoice(reuse, cwd, isolated, repo);
  const workspace: Workspace = !isolated ? 'checkout' : reused ? 'existing' : 'new';
  const chooseWorkspace = (next: Workspace) => {
    chooseIsolated(next !== 'checkout');
    setReuse(next === 'existing' && reusable[0] ? { cwd, branch: reusable[0].branch } : null);
  };
  const goneNote = gone && <p className="cp-launcher__note" role="status">{t.branches.launcher.gone(gone)}</p>;

  useEffect(() => { if (live) send({ t: 'directories' }); }, [live, send]);

  // a request for a new session (N, the palette, the room) lands here: the field takes the focus and the command asked for
  useEffect(() => {
    if (!draft) return;
    setResuming(draft.resumeIn !== undefined);
    if (draft.resumeIn || draft.folder) setFolder(draft.resumeIn || draft.folder || '');
    if (draft.command) setText(draft.command);
    if (draft.person) setAsked(draft.person);
    field.current?.focus();
    openNewSession(null);
  }, [draft, openNewSession, setText]);

  // the folder's conversations, asked for once the user stops typing it or the words to find
  useEffect(() => {
    if (!resuming || !cwd || !live) return;
    setResumeId(null);
    const timer = window.setTimeout(() => send({ t: 'conversations', cwd, ...(wanted ? { query: wanted } : {}) }), 250);
    return () => window.clearTimeout(timer);
  }, [resuming, cwd, wanted, live, send]);

  const tune = (change: TuneChange) => {
    if (change.model !== undefined) setModel(change.model);
    if (change.effort !== undefined) setEffort(change.effort || undefined);
    if (change.ultracode !== undefined) setUltracode(change.ultracode);
    if (change.fastMode !== undefined) setFastMode(change.fastMode);
    if (change.permissionMode !== undefined) setPermissionMode(change.permissionMode);
  };

  const ready = (resuming ? resumeId !== null : true) && !attachments.preparing;
  const start = () => {
    if (!ready || !cwd) return;
    const message = text.trim();
    const images = attachments.uploads;
    const files = attachments.files;
    const isolate = isolated ? { isolate: reused ? { branch: reused } : startBase && startBase !== repo?.branch ? { base: startBase } : {} } : {};
    // the text and the pictures stay when they could not leave (too long, not connected)
    if (!createSession({ cwd, model, ...(effort ? { effort } : {}), ...(ultracode ? { ultracode } : {}), ...(fastMode ? { fastMode } : {}), permissionMode, ...(person ? { name: person } : {}), ...(message ? { text: message } : {}), ...(images.length ? { images } : {}), ...(files.length ? { files } : {}), ...(resuming && resumeId ? { resumeId } : {}), ...isolate })) return;
    setText('');
    attachments.clear();
    setResumeId(null);
    setAsked(null);
    // the branch it took is no longer free: the choice is forgotten (the folder is asked again once the session shows up)
    setReuse(null);
  };

  const words = t.composer.launcher;
  const phone = usePhone();
  const branchWords = t.branches.launcher;
  // the branch it will get: with someone asked for, the name the server will give; else the work's part only
  const slug = workSlug(text);
  const preview = person ? branchPreview(person, text) : `${BRANCH_PREFIX}…${slug ? `-${slug}` : ''}`;
  const tidy = !resuming && repo && repo.merged >= 3;

  const closeButton = onClose && <button type="button" className="cp-icon-button cp-launcher__close" data-variant="outlined" aria-label={words.close} title={words.close} onClick={onClose}><CloseIcon /></button>;
  const resumeList = resuming && (
    <ResumeList
      conversations={conversations} cwd={cwd} wanted={wanted} query={query} onQuery={setQuery} chosen={resumeId}
      onPick={(conversation) => { setResumeId(conversation.id); if (conversation.name) setAsked(conversation.name); field.current?.focus(); }}
    />
  );
  const tidyLine = tidy && (
    <p className="cp-launcher__tidy">
      <CleanIcon />{branchWords.tidy(repo.merged, folderName(repo.root))} <button type="button" className="cp-link" onClick={() => openBranches(cwd)}>{branchWords.tidyAction}</button>
    </p>
  );
  const placeholder = resuming ? (resumeId ? words.placeholderResume : words.placeholderPickFirst) : streamlined ? words.placeholderAsk : phone ? words.placeholderShort : words.placeholder;
  const commandField = (
    <CommandField
      ref={field} id="launcher-field" label={words.fieldLabel} value={text} onChange={setText} onSubmit={() => { if (text.trim() || attachments.items.length) start(); }}
      onPaste={attachments.onPaste} people={mentionable} paths={{ cwd }} placeholder={placeholder}
    />
  );
  // the streamlined launcher chooses the workspace in its own chip, under the field
  const tuneMenu = <TuneMenu tuning={{ model, effort, ultracode, fastMode, permissionMode }} cwd={cwd} onChange={tune} isolation={canIsolate && !streamlined ? { isolated, onChange: chooseIsolated } : undefined} compact />;
  const personPicker = people.length > 0 && <PersonPicker people={people} chosen={person} onChoose={setAsked} />;
  const folderPicker = <FolderPicker directories={directories} value={folder} onChange={setFolder} placeholder={homeRelative(startFolder)} />;
  const attachButton = <AttachButton attachments={attachments} className="cp-icon-button cp-launcher__attach" />;
  const submit = (event: FormEvent) => { event.preventDefault(); start(); };
  const sendLabel = resuming ? words.resume : words.start;

  if (streamlined) {
    const projectName = folderName(cwd);
    return (
      <aside className="cp-launcher" data-style="streamlined" aria-label={words.label} {...attachments.dropTarget}>
        <DropOverlay attachments={attachments} />
        {closeButton}
        <div className="cp-launcher__center">
          {/* the conversations fill what is left above the question, as the classic launcher's body does */}
          {resumeList && <div className="cp-launcher__body">{resumeList}</div>}
          <header className="cp-launcher__hero">
            {projectName ? <ProjectPicker cwd={cwd} name={projectName} before={words.buildIn} after={words.buildEnd} onPick={setFolder} /> : <h2>{words.buildAnywhere}</h2>}
            <button type="button" className="cp-link cp-launcher__pick" onClick={() => folderBox.current?.querySelector('input')?.focus()}>{words.pickFolder}</button>
            {replacing && <p className="cp-muted">{words.replaces(replacing)}</p>}
          </header>
          <form className="cp-launcher__composer" onSubmit={submit}>
            <div className="cp-launcher__box">
              <AttachmentStrip attachments={attachments} />
              {commandField}
              <div className="cp-launcher__options">
                {attachButton}
                {tuneMenu}
                {personPicker}
                <button type="submit" className="cp-launcher__send" disabled={!ready} aria-label={sendLabel} title={sendLabel}><SendUpIcon /></button>
              </div>
            </div>
            <div className="cp-launcher__chips">
              {/* the same chips in the same places in both modes: resuming only presses one and greys the workspace out */}
              <span className="cp-launcher__chips-start">
                {(canIsolate || (resuming && repo?.branch)) && <WorkspaceMenu workspace={workspace} reusable={reusable.length > 0} disabled={resuming} onChange={chooseWorkspace} />}
                <span className="cp-launcher__folder" ref={folderBox}><FolderOpenIcon />{folderPicker}</span>
                <button type="button" className="cp-launcher__chip" aria-pressed={resuming} onClick={() => setResuming(!resuming)}><HistoryIcon /><span>{words.resumeConversation}</span></button>
              </span>
              <span className="cp-launcher__chips-end">
                {reused ? (
                  <ChipSelect
                    icon={<KeepIcon />} label={words.reusedBranch} shown={reused} value={reused}
                    options={reusableOptions(reusable)} onChange={(branch) => setReuse({ cwd, branch })}
                  />
                ) : repo && isolated && (
                  <ChipSelect
                    icon={<BranchIcon />} label={branchWords.base} shown={`${words.fromBranch} ${startBase}`} value={startBase}
                    options={repo.branches.map((branch) => ({ value: branch, label: branch }))} onChange={(branch) => setBase({ cwd, branch })}
                  />
                )}
              </span>
            </div>
            {goneNote}
            {repo && isolated && repo.dirty > 0 && <p className="cp-launcher__note">{branchWords.dirty(repo.dirty, folderName(repo.root))}</p>}
            {tidyLine}
          </form>
        </div>
      </aside>
    );
  }

  return (
    <aside className="cp-launcher" aria-label={words.label} {...attachments.dropTarget}>
      <DropOverlay attachments={attachments} />
      <div className="cp-launcher__head">
        <div className="cp-segmented" role="group" aria-label={words.conversation}>
          <button type="button" aria-pressed={!resuming} onClick={() => setResuming(false)}>{words.newConversation}</button>
          <button type="button" aria-pressed={resuming} onClick={() => setResuming(true)}>{words.resume}</button>
        </div>
        {closeButton}
      </div>

      <div className="cp-launcher__body">
        {!resuming ? (
          <div className="cp-launcher__intro">
            <h2>{words.title}</h2>
            <p>{replacing ? words.replaces(replacing) : words.intro}</p>
            <ul className="cp-launcher__keys">
              <li><kbd className="cp-kbd">N</kbd> {words.newRequest}</li>
              <li><kbd className="cp-kbd">{words.shiftN}</kbd> {words.startNow(homeRelative(startFolder))}</li>
              <li><kbd className="cp-kbd">/</kbd> {words.commandKey}</li>
            </ul>
          </div>
        ) : resumeList}
      </div>

      <form className="cp-launcher__composer" onSubmit={submit}>
        {repo && canIsolate && (offer.shown || isolated) && (
          <section className="cp-isolate" data-on={isolated} aria-label={branchWords.title}>
            <span className="cp-isolate__icon" aria-hidden="true"><BranchIcon /></span>
            <div className="cp-isolate__text">
              <strong className="cp-isolate__title">{branchWords.title}</strong>
              <p>
                {taken.length ? branchWords.busy(taken[0].name, taken.length - 1, folderName(repo.root)) : branchWords.alone}
                {isolated && (reused ? (
                  <> {branchWords.reuses(person)}{' '}
                    <span className="cp-chip" data-select>
                      <select aria-label={words.reusedBranch} value={reused} onChange={(e) => setReuse({ cwd, branch: e.target.value })}>
                        {reusableOptions(reusable).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </span>
                    . <button type="button" className="cp-link" onClick={() => setReuse(null)}>{branchWords.reuseOff}</button>
                  </>
                ) : (
                  <> {branchWords.startsOn(person)} <BranchName name={preview} />{branchWords.from}{' '}
                    {choosingBase ? (
                      <span className="cp-chip" data-select>
                        <select aria-label={branchWords.base} value={startBase} autoFocus onChange={(e) => { setBase({ cwd, branch: e.target.value }); setChoosingBase(false); }} onBlur={() => setChoosingBase(false)}>
                          {repo.branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
                        </select>
                      </span>
                    ) : <BranchName name={startBase} />}
                    .{repo.branches.length > 1 && !choosingBase && <> <button type="button" className="cp-link" title={branchWords.changeTitle} onClick={() => setChoosingBase(true)}>{branchWords.change}</button></>}
                    {reusable.length > 0 && !choosingBase && <> <button type="button" className="cp-link" title={branchWords.reuseTitle} onClick={() => setReuse({ cwd, branch: reusable[0].branch })}>{branchWords.reuse}</button></>}
                  </>
                ))}
              </p>
              {goneNote}
              {isolated && repo.dirty > 0 && <p className="cp-isolate__dirty">{branchWords.dirty(repo.dirty, folderName(repo.root))}</p>}
            </div>
            <Switch checked={isolated} onChange={chooseIsolated} label={branchWords.title} />
          </section>
        )}
        {tidyLine}
        <div className="cp-launcher__box">
        <AttachmentStrip attachments={attachments} />
        {commandField}
        <div className="cp-launcher__options">
          {personPicker}
          {tuneMenu}
          {folderPicker}
          {attachButton}
          <button type="submit" className="cp-launcher__send" disabled={!ready}><span className="cp-launcher__send-label">{sendLabel}</span><SendIcon /></button>
        </div>
        </div>
      </form>
    </aside>
  );
}

/** The folder's Claude Code conversations to resume one of (or what is said while there are none), and the words to find in them. */
function ResumeList({ conversations, cwd, wanted, query, onQuery, chosen, onPick }: {
  conversations: readonly Conversation[] | null; cwd: string; wanted: string; query: string; onQuery: (query: string) => void; chosen: string | null; onPick: (conversation: Conversation) => void;
}) {
  const words = t.composer.launcher;
  return (
    <div className="cp-resume">
      {!conversations ? (
        <div className="cp-resume__loading" role="status">
          <span className="cp-resume__spinner" aria-hidden="true" />
          <p className="cp-muted">{wanted ? words.searchingWords(homeRelative(cwd)) : words.searching(homeRelative(cwd))}</p>
        </div>
      )
        : conversations.length === 0 ? <p className="cp-muted">{wanted ? words.noMatch(wanted, homeRelative(cwd)) : words.noConversation(homeRelative(cwd))}</p>
          : (
            <ul className="cp-resume__list" aria-label={words.conversationsOf(homeRelative(cwd))}>
              {conversations.map((conversation) => (
                <li key={conversation.id}>
                  <button type="button" className="cp-resume__item" aria-pressed={chosen === conversation.id} onClick={() => onPick(conversation)}>
                    <span className="cp-resume__title">{conversation.title}</span>
                    <span className="cp-resume__when">
                      {conversation.tags && <ResumeTags tags={conversation.tags} />}
                      {conversation.archived && <span className="cp-tag cp-resume__archived" title={words.archivedTitle}><KeepIcon />{words.archived}</span>}
                      {formatAgo(Date.now() - conversation.updatedAt)}
                    </span>
                    {conversation.match ? <span className="cp-resume__preview"><Snippet {...conversation.match} /></span>
                      : conversation.preview && conversation.preview !== conversation.title && <span className="cp-resume__preview">{conversation.preview}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
      {/* last, so it sits right above the composer whatever the list's height */}
      <input
        className="cp-resume__search" type="search" value={query} placeholder={words.searchConversations} aria-label={words.searchConversations}
        autoComplete="off" spellCheck={false} onChange={(e) => onQuery(e.target.value)}
      />
    </div>
  );
}

/** Where a session of the streamlined launcher works: the folder itself, a worktree on a new branch, or a branch to go on with. */
type Workspace = 'checkout' | 'new' | 'existing';

/** The kept branches a session can go on with, as the two dropdowns list them: the branch, and when it was last worked on. */
const reusableOptions = (branches: readonly ReusableBranch[]) => branches.map((one) => ({ value: one.branch, label: one.at ? `${one.branch} · ${formatAgo(Date.now() - one.at)}` : one.branch }));

/** The streamlined launcher's choice of workspace; "Previous worktree" only when the folder has a branch to go on with. */
function WorkspaceMenu({ workspace, reusable, disabled, onChange }: { workspace: Workspace; reusable: boolean; disabled: boolean; onChange: (workspace: Workspace) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, box, close);
  const words = t.composer.launcher;
  const choices: { value: Workspace; icon: ReactNode; label: string; title: string }[] = [
    { value: 'checkout', icon: <FolderIcon />, label: words.currentCheckout, title: t.branches.tune.sharedTitle },
    { value: 'new', icon: <BranchIcon />, label: words.newWorktree, title: t.branches.tune.isolatedTitle },
    ...(reusable ? [{ value: 'existing' as const, icon: <KeepIcon />, label: words.previousWorktree, title: t.branches.launcher.reuseTitle }] : []),
  ];
  const shown = choices.find((choice) => choice.value === workspace) ?? choices[0];
  return (
    <div className="cp-launcher__workspace" ref={box}>
      <button type="button" className="cp-launcher__chip" aria-haspopup="menu" aria-expanded={open && !disabled} title={words.workspace} disabled={disabled} onClick={() => setOpen(!open)}>
        {shown.icon}<span>{shown.label}</span><ChevronDownIcon />
      </button>
      {open && !disabled && (
        <div className="cp-detail__menu cp-launcher__menu" role="menu" aria-label={words.workspace}>
          <p className="cp-launcher__menu-title" aria-hidden="true">{words.workspace}</p>
          {choices.map((choice) => (
            <button key={choice.value} type="button" role="menuitemradio" aria-checked={workspace === choice.value} title={choice.title} onClick={() => { close(); onChange(choice.value); }}>
              {choice.icon}{choice.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A small chip of the streamlined launcher that shows its choice; the browser's own list, laid over it, opens on a click. */
function ChipSelect({ icon, label, shown, value, options, onChange }: {
  icon: ReactNode; label: string; shown: string; value: string; options: readonly { value: string; label: string }[]; onChange: (value: string) => void;
}) {
  return (
    <label className="cp-launcher__chip" title={label}>
      {icon}<span>{shown}</span><ChevronDownIcon />
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

/** The tags a conversation's session had when it left, as its session showed them. */
function ResumeTags({ tags }: { tags: readonly string[] }) {
  const hues = sessionTagHues(tags);
  return tags.map((tag, index) => <span key={tag} className="cp-tag cp-resume__tag" data-hue={hues[index]}><TagIcon />{tag}</span>);
}
