// What Open Space opens on the user's computer: a terminal window, from the room (a click on the user's own screen),
// and a web page, in the default browser (an MCP server's sign-in).
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { st } from './i18n/index.ts';
import type { EditorChoice, EditorKind, TerminalChoice, TerminalKind } from '../shared/terminal.ts';

const ITERM = ['/Applications/iTerm.app', path.join(os.homedir(), 'Applications', 'iTerm.app')];

// A detached cmd.exe with ignored stdio exits immediately when started by Electron's console-less utility process.
// Hide only the PowerShell launcher; Start-Process explicitly opens an independent, visible console window.
// Paths travel through the environment, never through shell source; quote the Git Bash argument for Windows argv.
const OPEN_WINDOWS_TERMINAL = "$ErrorActionPreference = 'Stop'; $terminalArgs = switch ($env:OPEN_SPACE_TERMINAL_KIND) { 'cmd' { @('/d', '/k') } 'powershell' { @('-NoLogo', '-NoExit') } 'git-bash' { @('--cd=\"' + $env:OPEN_SPACE_TERMINAL_FOLDER.Replace([char]92, [char]47) + '\"') } }; Start-Process -FilePath $env:OPEN_SPACE_TERMINAL_EXE -ArgumentList $terminalArgs -WorkingDirectory $env:OPEN_SPACE_TERMINAL_FOLDER -WindowStyle Normal";

/** Fixed executable names only: a saved preference never supplies executable code or a command line. */
export function findTerminals(env: NodeJS.ProcessEnv = process.env, exists: (file: string) => boolean = existsSync): TerminalChoice[] {
  const system = path.join(env.SystemRoot || 'C:\\Windows', 'System32');
  const search = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter((folder) => path.isAbsolute(folder));
  const programs = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs')].filter((folder): folder is string => !!folder);
  const gitRoots = [
    ...(env.CLAUDE_CODE_GIT_BASH_PATH ? [path.resolve(path.dirname(env.CLAUDE_CODE_GIT_BASH_PATH), '..')] : []),
    ...search.flatMap((folder) => [folder, path.dirname(folder)]),
    ...programs.map((folder) => path.join(folder, 'Git')),
  ];
  const candidates: { id: TerminalKind; name: string; paths: string[] }[] = [
    { id: 'cmd', name: 'cmd', paths: [env.ComSpec || path.join(system, 'cmd.exe')] },
    { id: 'powershell', name: 'PowerShell', paths: [...search.map((folder) => path.join(folder, 'pwsh.exe')), ...programs.map((folder) => path.join(folder, 'PowerShell', '7', 'pwsh.exe')), path.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe')] },
    { id: 'git-bash', name: 'Git Bash', paths: gitRoots.map((folder) => path.join(folder, 'git-bash.exe')) },
  ];
  return candidates.flatMap(({ id, name, paths }) => {
    const file = paths.find((candidate) => path.isAbsolute(candidate) && exists(candidate));
    return file ? [{ id, name, path: file }] : [];
  });
}

/** A visible terminal in the chosen folder: the one picked in the settings on Windows, iTerm/Terminal on macOS. */
export function openTerminal(folder: string, kind: TerminalKind = 'cmd'): Promise<void> {
  if (process.platform === 'win32') {
    return new Promise((resolve, reject) => {
      const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
      const choice = findTerminals().find((terminal) => terminal.id === kind);
      if (!choice) { reject(new Error(st.terminal.failed)); return; }
      execFile(path.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', OPEN_WINDOWS_TERMINAL], {
          timeout: 10_000, windowsHide: true,
          env: { ...process.env, OPEN_SPACE_TERMINAL_EXE: choice.path, OPEN_SPACE_TERMINAL_FOLDER: folder, OPEN_SPACE_TERMINAL_KIND: choice.id },
        }, (error) => (error ? reject(new Error(st.terminal.failed)) : resolve()));
    });
  }
  if (process.platform !== 'darwin') return Promise.reject(new Error(st.terminal.unsupported));
  const application = ITERM.find((candidate) => existsSync(candidate)) ?? 'Terminal';
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/open', ['-a', application, folder], { timeout: 10_000 }, (error) => (error ? reject(new Error(st.terminal.failed)) : resolve()));
  });
}

/** An editor found, and the program that opens a folder in it: `args`, then the folder. */
export interface EditorLaunch extends EditorChoice { file: string; args: string[] }

/**
 * Where each editor is: its command on PATH, its program on Windows (from the folder of its command, else where its
 * installer puts it; the command itself is a .cmd, which only runs through a shell), its app on macOS.
 */
const EDITOR_PLACES: Readonly<Record<EditorKind, { name: string; command: string; fromCommand: string[]; installed: string[]; app: string }>> = {
  vscode: { name: 'VS Code', command: 'code', fromCommand: ['..', 'Code.exe'], installed: ['Microsoft VS Code/Code.exe'], app: 'Visual Studio Code.app' },
  cursor: { name: 'Cursor', command: 'cursor', fromCommand: ['..', '..', '..', 'Cursor.exe'], installed: ['cursor/Cursor.exe'], app: 'Cursor.app' },
};

/** The code editors installed, by fixed names only: nothing the page sends ever names a program. */
export function findEditors(env: NodeJS.ProcessEnv = process.env, exists: (file: string) => boolean = existsSync, platform: NodeJS.Platform = process.platform, home = os.homedir()): EditorLaunch[] {
  const search = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter((folder) => path.isAbsolute(folder));
  const programs = [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'), env.ProgramFiles, env['ProgramFiles(x86)']].filter((folder): folder is string => !!folder);
  return (Object.keys(EDITOR_PLACES) as EditorKind[]).flatMap((id): EditorLaunch[] => {
    const { name, command, fromCommand, installed, app } = EDITOR_PLACES[id];
    const found = (files: string[], args: string[] = []) => {
      const file = files.find((candidate) => path.isAbsolute(candidate) && exists(candidate));
      return file ? [{ id, name, file, args }] : null;
    };
    if (platform === 'win32') {
      return found([
        ...search.filter((folder) => exists(path.join(folder, `${command}.cmd`))).map((folder) => path.resolve(folder, ...fromCommand)),
        ...programs.flatMap((folder) => installed.map((file) => path.join(folder, file))),
      ]) ?? [];
    }
    const onPath = found(search.map((folder) => path.join(folder, command)));
    if (onPath || platform !== 'darwin') return onPath ?? [];
    const bundle = ['/Applications', path.join(home, 'Applications')].map((folder) => path.join(folder, app)).find(exists);
    return bundle ? [{ id, name, file: '/usr/bin/open', args: ['-a', bundle] }] : [];
  });
}

let editors: EditorLaunch[] | null = null;
/** The editors found, looked for once. */
export const installedEditors = () => { editors ??= findEditors(); return editors; };

/** Opens a folder in one of the editors found, on its own: it stays open when Open Space stops. */
export function openInEditor(folder: string, kind: EditorKind): Promise<void> {
  const editor = installedEditors().find((each) => each.id === kind);
  if (!editor) return Promise.reject(new Error(st.editor.failed(EDITOR_PLACES[kind].name)));
  // Open Space's own Electron may have set it: the editor, an Electron app too, would then run as plain Node
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  return new Promise((resolve, reject) => {
    const child = spawn(editor.file, [...editor.args, folder], { detached: true, stdio: 'ignore', env });
    child.once('error', () => reject(new Error(st.editor.failed(editor.name))));
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

/** A web page in the default browser; only an https address (they come from Claude Code, not from the page). */
export function openWebPage(address: string) {
  if (!/^https:\/\//.test(address)) return;
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  execFile(opener, [address], () => {});
}
