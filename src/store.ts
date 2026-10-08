import type { DiffView } from './types/diff';
import { create } from 'zustand';
import { clampDiffFontSize, storage, type Scope, type Theme } from './lib/storage';
import type { CommitSortOrder } from './types/commits';
import type { DashboardUser } from './types/dashboard';

interface UIState {
  token: string | null;
  theme: Theme;
  scope: Scope;
  orgs: string[];
  selectedPRId: string | null;
  detailOpen: boolean;
  settingsOpen: boolean;
  helpOpen: boolean;
  searchQuery: string;
  authorFilter: DashboardUser | null;
  collapsedBuckets: Set<string>;
  notificationsEnabled: boolean;
  /** Modal escapes its 1100x900 cap. Persisted — big-diff readers stay big. */
  diffMaximized: boolean;
  /** Diff type size in px, clamped to [DIFF_FONT_MIN, DIFF_FONT_MAX]. Persisted. */
  diffFontSize: number;
  /** File rail visible in the Diff tab. Persisted. */
  diffRailOpen: boolean;
  diffView: DiffView;
  setDiffView: (view: DiffView) => void;
  /** Remembered order for the Commits tab. */
  commitSortOrder: CommitSortOrder;
  setToken: (token: string | null) => void;
  setTheme: (theme: Theme) => void;
  setScope: (scope: Scope) => void;
  setOrgs: (orgs: string[]) => void;
  setSelectedPRId: (id: string | null) => void;
  setDetailOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setHelpOpen: (open: boolean) => void;
  setSearchQuery: (q: string) => void;
  setAuthorFilter: (author: DashboardUser | null) => void;
  toggleBucket: (id: string) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  toggleDiffMaximized: () => void;
  toggleDiffRail: () => void;
  /** Step the diff font size by `delta`, clamping at both ends. */
  adjustDiffFontSize: (delta: number) => void;
  setCommitSortOrder: (order: CommitSortOrder) => void;
}

export const useUIStore = create<UIState>((set) => ({
  token: storage.getToken(),
  theme: storage.getTheme(),
  scope: storage.getScope(),
  orgs: storage.getOrgs(),
  selectedPRId: null,
  detailOpen: false,
  settingsOpen: false,
  helpOpen: false,
  searchQuery: '',
  authorFilter: null,
  notificationsEnabled: storage.getNotifications(),
  diffMaximized: storage.getDiffMaximized(),
  diffFontSize: storage.getDiffFontSize(),
  diffRailOpen: storage.getDiffRailOpen(),
  diffView: storage.getDiffView(),
  setDiffView: (diffView) => {
    storage.setDiffView(diffView);
    set({ diffView });
  },
  commitSortOrder: storage.getCommitSortOrder(),
  // Start with "Recently merged" folded since it's historical and not
  // the attention-first signal.
  collapsedBuckets: new Set<string>(['merged']),
  setToken: (token) => {
    if (token) storage.setToken(token);
    else storage.clearToken();
    set({ token });
  },
  setTheme: (theme) => {
    storage.setTheme(theme);
    document.documentElement.dataset.theme = theme;
    set({ theme });
  },
  setNotificationsEnabled: (enabled) => {
    storage.setNotifications(enabled);
    set({ notificationsEnabled: enabled });
  },
  setScope: (scope) => {
    storage.setScope(scope);
    set((state) => ({
      scope,
      // Author filtering is a Team-view lens. Avoid carrying a hidden
      // teammate filter into the narrower Inbox dataset.
      authorFilter: state.scope === scope ? state.authorFilter : null,
    }));
  },
  setOrgs: (orgs) => {
    storage.setOrgs(orgs);
    set({ orgs });
  },
  toggleDiffMaximized: () =>
    set((s) => {
      const diffMaximized = !s.diffMaximized;
      storage.setDiffMaximized(diffMaximized);
      return { diffMaximized };
    }),
  toggleDiffRail: () =>
    set((s) => {
      const diffRailOpen = !s.diffRailOpen;
      storage.setDiffRailOpen(diffRailOpen);
      return { diffRailOpen };
    }),
  adjustDiffFontSize: (delta) =>
    set((s) => {
      const diffFontSize = clampDiffFontSize(s.diffFontSize + delta);
      if (diffFontSize === s.diffFontSize) return s;
      storage.setDiffFontSize(diffFontSize);
      return { diffFontSize };
    }),
  setCommitSortOrder: (commitSortOrder) => {
    storage.setCommitSortOrder(commitSortOrder);
    set({ commitSortOrder });
  },
  setSelectedPRId: (id) => set({ selectedPRId: id }),
  setDetailOpen: (open) => set({ detailOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setHelpOpen: (open) => set({ helpOpen: open }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setAuthorFilter: (authorFilter) => set({ authorFilter }),
  toggleBucket: (id) =>
    set((s) => {
      const next = new Set(s.collapsedBuckets);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { collapsedBuckets: next };
    }),
}));

// Initialize the theme on import
if (typeof document !== 'undefined') {
  document.documentElement.dataset.theme = storage.getTheme();
}
