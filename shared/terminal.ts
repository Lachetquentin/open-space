export const TERMINALS = ['cmd', 'powershell', 'git-bash'] as const;
export type TerminalKind = (typeof TERMINALS)[number];
export interface TerminalChoice { id: TerminalKind; name: string; path: string }

/** The code editors a session's folder can be opened in, when found on this computer (server/desktop.ts findEditors). */
export const EDITORS = ['vscode', 'cursor'] as const;
export type EditorKind = (typeof EDITORS)[number];
export interface EditorChoice { id: EditorKind; name: string }
