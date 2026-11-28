import { useEffect, useMemo, useRef } from 'react';
import { hasNews, unreadMods } from '../../shared/dashboards.ts';
import { Tooltip } from '../design/Tooltip.tsx';
import { locale, plural, t } from '../i18n/index.ts';
import { MODIFIER } from '../lib/platform.ts';
import { roomSessions, type RoomKind } from '../room/cast.ts';
import { seatedRuns } from '../state/automata.ts';
import { outdatedSessions, selectClaudeNewer, useSessions, type View } from '../state/sessions.ts';
import { useProjects } from '../state/useProjects.ts';
import { useAppRestart } from './AppUpdateAction.tsx';
import { AutomatonIcon, DashboardIcon, DeskIcon, DownloadIcon, FocusIcon, RefreshIcon, SearchIcon, SettingsIcon, SofaIcon, TerminalIcon } from './Icons.tsx';
import { ModsButton } from './ModsPanel.tsx';
import { QuotaMeter } from './QuotaMeter.tsx';
import { Radio } from './Radio.tsx';
import { usePhone } from '../lib/phone.ts';

/** The rooms; the server room is always there, as the triggers are made from it (ServerRoomEmpty when it is empty, its orb after). */
const VIEWS = [['salle', DeskIcon, 'office'], ['repos', SofaIcon, 'lounge'], ['automates', AutomatonIcon, 'automata']] as const satisfies readonly (readonly [View, () => unknown, RoomKind])[];
/** The search opens with Cmd+K on a Mac, Ctrl+K elsewhere (App.tsx listens to both); focus mode, with Cmd+. or Ctrl+. */
const PALETTE_KEYS = `${MODIFIER} K`;
const FOCUS_KEYS = `${MODIFIER} .`;
const SETTINGS_KEYS = `${MODIFIER} ,`;
export const DASHBOARDS_BAR = 'cp-dashboards-bar';

export function Header() {
  const view = useSessions((s) => s.view);
  const phone = usePhone();
  const setView = useSessions((s) => s.setView);
  const quota = useSessions((s) => s.quota);
  const connection = useSessions((s) => s.connection);
  const openPalette = useSessions((s) => s.openPalette);
  const openSettings = useSessions((s) => s.openSettings);
  // off in the settings, the radio leaves its room to the rest
  const radio = useSessions((s) => s.preferences.radio !== false);
  const automata = useSessions((s) => s.automata);
  const sessions = useSessions((s) => s.sessions);
  const seen = useSessions((s) => s.seen);
  // a mod on a dashboard has something new: a dot on the dashboards' button, until they are shown
  const dashboardsNews = useSessions((s) => {
    const unread = unreadMods(s.mods);
    return s.view !== 'dashboards' && unread.size > 0 && (s.preferences.dashboards ?? []).some((dashboard) => hasNews(dashboard, unread));
  });
  // how many sessions each room holds, the way the rooms themselves place them
  const counts = useMemo(() => {
    const list = Object.values(sessions);
    // the server room: the triggers' runs, and every external run at work, with or without a capsule
    return { office: roomSessions(list, seen, 'office').flat().length, lounge: roomSessions(list, seen, 'lounge').flat().length, automata: roomSessions(list, seen, 'automata').flat().length + seatedRuns(automata).length };
  }, [sessions, seen, automata]);

  const words = t.common.header;
  return (
    <header className="cp-header">
      <div className="cp-header__where">
        {/* only when something is wrong: a live connection is the normal state */}
        {connection !== 'live' && <span className="cp-header__signal" data-connection={connection} title={words.disconnected} />}
        <h1 className="cp-sr-only">Open Space</h1>
        <nav className="cp-segmented" data-icons aria-label={words.rooms}>
          {!phone && VIEWS.map(([id, ViewIcon, room]) => (
            <Tooltip key={id} text={words[room]}>
              <button type="button" aria-pressed={view === id} aria-label={words.roomSessions(words[room], room === 'automata' ? plural(counts[room], words.automaton, words.automatons) : plural(counts[room], words.session, words.sessions))} onClick={() => setView(id)}>
                <ViewIcon />{counts[room] > 0 && <span className="cp-header__room-count" aria-hidden="true">{counts[room]}</span>}
              </button>
            </Tooltip>
          ))}
          <Tooltip text={dashboardsNews ? words.dashboardsNews : words.dashboardsTitle}>
            <button type="button" aria-pressed={view === 'dashboards'} aria-label={dashboardsNews ? words.dashboardsNews : words.dashboards} data-news={dashboardsNews || undefined} onClick={() => setView('dashboards')}>
              <DashboardIcon />
            </button>
          </Tooltip>
          {!phone && <span className="cp-header__divider" aria-hidden="true" />}
          <Tooltip text={words.focusTitle(FOCUS_KEYS)}>
            <button type="button" aria-pressed={view === 'focus'} aria-label={words.focus} onClick={() => setView('focus')}>
              <FocusIcon />
            </button>
          </Tooltip>
        </nav>
      </div>
      <ProjectFilter />
      {radio && !phone && <Radio />}
      {/* the dashboards' tabs and buttons, put here by Dashboards.tsx: the grid keeps the whole page under the header */}
      {view === 'dashboards' && <div className="cp-header__dashboards" id={DASHBOARDS_BAR} />}
      <div className="cp-header__tools">
        {quota && <QuotaMeter quota={quota} />}
        <ModsButton />
        <Tooltip text={words.searchTitle}>
          <button type="button" className="cp-button cp-header__search" data-variant="quiet" onClick={() => openPalette(true)} aria-label={words.search}>
            <SearchIcon /><kbd className="cp-kbd">{PALETTE_KEYS}</kbd>
          </button>
        </Tooltip>
        <AppUpdateButton />
        <ClaudeUpdateButton />
        <Tooltip text={words.settingsTitle(SETTINGS_KEYS)}>
          <button type="button" className="cp-icon-button cp-header__settings" onClick={() => openSettings(true)} aria-label={words.settings}>
            <SettingsIcon />
          </button>
        </Tooltip>
      </div>
    </header>
  );
}

/** A new Open Space the Mac app is downloading (a click shows it in the settings), then ready: a click restarts on it, after the same warning as the settings when sessions are at work. */
function AppUpdateButton() {
  const update = useSessions((s) => s.appUpdate);
  const { ask, restarting, warning } = useAppRestart();
  const words = t.common.header;
  if (update?.state !== 'downloading' && update?.state !== 'ready') return null;
  const ready = update.state === 'ready';
  const text = ready ? words.appReady(update.version) : words.appDownloading(update.version, new Intl.NumberFormat(locale(), { style: 'percent' }).format(update.percent / 100));
  return (
    <>
      <Tooltip text={text}>
        <button
          type="button" className="cp-icon-button cp-header__update" data-news={ready || undefined} aria-label={text}
          disabled={restarting} aria-busy={restarting || undefined} onClick={() => (ready ? ask() : useSessions.getState().openSettings(true, 'about'))}
        >
          <DownloadIcon />
        </button>
      </Tooltip>
      {warning}
    </>
  );
}

/**
 * Claude Code has news: a newer version on the registry (Preferences.claudeUpdateCheck), which a click installs with
 * `claude update`; or a new version installed while sessions still run the old one, which a click restarts when they wait.
 */
function ClaudeUpdateButton() {
  const newer = useSessions(selectClaudeNewer);
  const installed = useSessions((s) => s.claude?.version ?? '');
  const update = useSessions((s) => s.claudeUpdate);
  const sessions = useSessions((s) => s.sessions);
  const outdated = useMemo(() => outdatedSessions(Object.values(sessions), installed), [sessions, installed]);
  const words = t.common.header;
  const store = useSessions.getState;
  if (newer) {
    const busy = update?.state === 'checking';
    const text = busy ? words.claudeUpdating : update?.state === 'failed' ? words.claudeFailed(update.text) : words.claudeNewer(newer, installed);
    // not disabled while it installs, so its tooltip still says so
    return (
      <Tooltip text={text}>
        <button type="button" className="cp-icon-button cp-header__update" data-news aria-label={text} aria-busy={busy || undefined} onClick={() => { if (!busy) store().updateClaude(); }}>
          {busy ? <RefreshIcon /> : <TerminalIcon />}
        </button>
      </Tooltip>
    );
  }
  if (!outdated.length) return null;
  // like the settings' banner: only the waiting ones restart, the others switch at their next pause
  const waiting = outdated.some((session) => session.state === 'wait');
  const text = waiting ? words.claudeOutdated(installed, outdated.length) : words.claudeOutdatedBusy(installed, outdated.length);
  return (
    <Tooltip text={text}>
      <button type="button" className="cp-icon-button cp-header__update" data-news aria-label={text} onClick={() => (waiting ? store().restartOutdated() : store().openSettings(true, 'about'))}>
        <TerminalIcon />
      </button>
    </Tooltip>
  );
}

/** One pill per folder the sessions work in, once there are two or more: a click keeps that project's sessions in sight, a second one shows them all. */
function ProjectFilter() {
  const { projects, project } = useProjects();
  const setProject = useSessions((s) => s.setProject);
  // the pill scrolls when the projects overflow it: the one picked stays in sight
  const pill = useRef<HTMLDivElement>(null);
  useEffect(() => { pill.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [project, projects.length]);
  if (projects.length < 2) return null;
  const words = t.common.header;
  const total = projects.reduce((sum, { count }) => sum + count, 0);
  return (
    <div className="cp-header__projects" ref={pill}>
      <div className="cp-segmented" role="group" aria-label={words.projects}>
        <button type="button" aria-pressed={project === ''} title={words.allProjectsTitle} onClick={() => setProject('')}>
          {words.allProjects}<span className="cp-header__room-count">{total}</span>
        </button>
        {projects.map(({ folder, name, count, waiting }) => (
          <button
            key={folder} type="button" aria-pressed={project === folder} title={words.projectTitle(folder, waiting)}
            onClick={() => setProject(project === folder ? '' : folder)}
          >
            {name}<span className="cp-header__room-count" data-waiting={waiting}>{count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
