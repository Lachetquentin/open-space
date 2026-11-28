// Claude Code's versions: the one the npm registry calls latest (Preferences.claudeUpdateCheck, server/claude-latest.ts)
// against the one installed (`claude --version`).

/** Where the latest published Claude Code is read, only once the user turned the check on. */
export const CLAUDE_LATEST_URL = 'https://registry.npmjs.org/@anthropic-ai/claude-code/latest';

/** x.y.z, with an optional pre-release (-beta.1) and build (+abc) part */
const VERSION = /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-([0-9A-Za-z.-]{1,64}))?(?:\+[0-9A-Za-z.-]{1,64})?$/;

/** The parts of a version, or null for anything else (an empty string, a word, an over-long value). */
export function parseVersion(text: unknown): { numbers: [number, number, number]; pre: string } | null {
  if (typeof text !== 'string') return null;
  const match = VERSION.exec(text.trim());
  if (!match) return null;
  return { numbers: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? '' };
}

/** `a` is a later version than `b`; false when either cannot be read. A pre-release comes before its release. */
export function isNewerVersion(a: unknown, b: unknown): boolean {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index++) {
    if (left.numbers[index] !== right.numbers[index]) return left.numbers[index] > right.numbers[index];
  }
  if (left.pre === right.pre) return false;
  if (!left.pre) return true;
  if (!right.pre) return false;
  return left.pre.localeCompare(right.pre, 'en', { numeric: true }) > 0;
}
