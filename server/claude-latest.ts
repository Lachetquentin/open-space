// The latest Claude Code on the npm registry (Preferences.claudeUpdateCheck): asked at launch, every 6 h, and as soon
// as the user turns the check on; never while it is off. Nothing is installed from here: the page offers `claude update`.
import { CLAUDE_LATEST_URL, parseVersion } from '../shared/claude-version.ts';
import { isJson } from './json.ts';

export const CLAUDE_LATEST_EVERY_MS = 6 * 60 * 60 * 1000;
/** after a failed request, one more try this much later (not stacked, and not repeated: the 6 h tick comes next) */
export const CLAUDE_LATEST_RETRY_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 10_000;

type Fetch = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface ClaudeLatestDeps {
  /** the user's choice, read each time */
  enabled: () => boolean;
  /** told each time the latest known version changes */
  onChange: (version: string | null) => void;
  log: (what: string, error: unknown) => void;
  fetch?: Fetch;
}

export class ClaudeLatest {
  /** the latest version the registry gave, kept through a failed request */
  version: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private deps: ClaudeLatestDeps;

  constructor(deps: ClaudeLatestDeps) {
    this.deps = deps;
  }

  /** Follows the preference: asks now and every 6 h once it is on; once it is off, stops asking and forgets what it knew. */
  apply() {
    if (!this.deps.enabled()) {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      if (this.retry) clearTimeout(this.retry);
      this.retry = null;
      if (this.version === null) return;
      this.version = null;
      this.deps.onChange(null);
      return;
    }
    if (this.timer) return;
    this.timer = setInterval(() => { void this.check(); }, CLAUDE_LATEST_EVERY_MS);
    this.timer.unref?.();
    void this.check();
  }

  private async check(retrying = false) {
    if (!this.deps.enabled()) return;
    try {
      const fetcher: Fetch = this.deps.fetch ?? fetch;
      const response = await fetcher(CLAUDE_LATEST_URL, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`registry.npmjs.org answered ${response.status}`);
      const body = await response.json();
      const version = isJson(body) && typeof body.version === 'string' && parseVersion(body.version) ? body.version.trim() : null;
      if (!version) throw new Error('no version in the registry’s answer');
      // turned off while the request was out: its answer is dropped
      if (!this.deps.enabled() || version === this.version) return;
      this.version = version;
      this.deps.onChange(version);
    } catch (error) {
      this.deps.log('cannot read the latest Claude Code version', error);
      if (retrying || this.retry) return;
      this.retry = setTimeout(() => { this.retry = null; void this.check(true); }, CLAUDE_LATEST_RETRY_MS);
      this.retry.unref?.();
    }
  }
}
