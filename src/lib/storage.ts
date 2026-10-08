import type { DiffView } from '../types/diff';
import type { CommitSortOrder } from '../types/commits';

const TOKEN_KEY = 'perch.token';
const THEME_KEY = 'perch.theme';
const SCOPE_KEY = 'perch.scope';
const ORGS_KEY = 'perch.orgs';
const NOTIFICATIONS_KEY = 'perch.notifications';
const DIFF_MAXIMIZED_KEY = 'perch.diff.maximized';
const DIFF_FONT_SIZE_KEY = 'perch.diff.fontSize';
const DIFF_RAIL_OPEN_KEY = 'perch.diff.railOpen';
const COMMITS_SORT_ORDER_KEY = 'perch.commits.sortOrder';

export type Theme = 'dark' | 'light';
export type Scope = 'inbox' | 'all';

/** Diff type size bounds. Below 11 the gutter numbers stop being legible;
 *  above 16 the fixed 40px line-number columns start clipping. */
export const DIFF_FONT_MIN = 11;
export const DIFF_FONT_MAX = 16;
export const DIFF_FONT_DEFAULT = 13;

export function clampDiffFontSize(size: number): number {
  if (!Number.isFinite(size)) return DIFF_FONT_DEFAULT;
  return Math.min(DIFF_FONT_MAX, Math.max(DIFF_FONT_MIN, Math.round(size)));
}

/** Line height that keeps the shipped 11.5/18 rhythm as type scales up. */
export function diffLineHeight(fontSize: number): number {
  return fontSize + 8;
}

export const storage = {
  getToken(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  setToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
  },
  clearToken(): void {
    localStorage.removeItem(TOKEN_KEY);
  },
  getTheme(): Theme {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' ? 'light' : 'dark';
  },
  setTheme(theme: Theme): void {
    localStorage.setItem(THEME_KEY, theme);
  },
  getScope(): Scope {
    return localStorage.getItem(SCOPE_KEY) === 'all' ? 'all' : 'inbox';
  },
  setScope(scope: Scope): void {
    localStorage.setItem(SCOPE_KEY, scope);
  },
  getOrgs(): string[] {
    const raw = localStorage.getItem(ORGS_KEY);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((s): s is string => typeof s === 'string');
      }
    } catch {
      /* ignore malformed */
    }
    return [];
  },
  setOrgs(orgs: string[]): void {
    localStorage.setItem(ORGS_KEY, JSON.stringify(orgs));
  },
  getNotifications(): boolean {
    try {
      return localStorage.getItem(NOTIFICATIONS_KEY) === 'true';
    } catch {
      return false;
    }
  },
  setNotifications(enabled: boolean): void {
    localStorage.setItem(NOTIFICATIONS_KEY, enabled ? 'true' : 'false');
  },
  getDiffMaximized(): boolean {
    try {
      return localStorage.getItem(DIFF_MAXIMIZED_KEY) === 'true';
    } catch {
      return false;
    }
  },
  setDiffMaximized(maximized: boolean): void {
    localStorage.setItem(DIFF_MAXIMIZED_KEY, maximized ? 'true' : 'false');
  },
  getDiffFontSize(): number {
    try {
      const raw = localStorage.getItem(DIFF_FONT_SIZE_KEY);
      if (raw == null) return DIFF_FONT_DEFAULT;
      return clampDiffFontSize(Number(raw));
    } catch {
      return DIFF_FONT_DEFAULT;
    }
  },
  setDiffFontSize(size: number): void {
    localStorage.setItem(DIFF_FONT_SIZE_KEY, String(clampDiffFontSize(size)));
  },
  getDiffView(): DiffView {
    try {
      return localStorage.getItem('perch.diff.view') === 'split' ? 'split' : 'unified';
    } catch {
      return 'unified';
    }
  },
  setDiffView(view: DiffView): void {
    localStorage.setItem('perch.diff.view', view);
  },
  getDiffRailOpen(): boolean {
    // Defaults to open: an unset key must not read as "collapsed".
    try {
      return localStorage.getItem(DIFF_RAIL_OPEN_KEY) !== 'false';
    } catch {
      return true;
    }
  },
  setDiffRailOpen(open: boolean): void {
    localStorage.setItem(DIFF_RAIL_OPEN_KEY, open ? 'true' : 'false');
  },
  getCommitSortOrder(): CommitSortOrder {
    try {
      return localStorage.getItem(COMMITS_SORT_ORDER_KEY) === 'oldest'
        ? 'oldest'
        : 'newest';
    } catch {
      return 'newest';
    }
  },
  setCommitSortOrder(order: CommitSortOrder): void {
    localStorage.setItem(COMMITS_SORT_ORDER_KEY, order);
  },
};

/** Redact a token for logging/error display. */
export function redactToken(token: string): string {
  if (!token) return '';
  if (token.length <= 8) return '••••';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}
