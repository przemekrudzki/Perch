# Perch

A personal GitHub pull-request inbox. Reorganizes your PRs by the question
_"what needs my attention / what's blocked / what's ready?"_ instead of by
repo. Single-user, client-only, no backend.

Open tabs notice new deploys within ~60 seconds and prompt the user to
refresh, so you never stare at a stale build for long.

## Stack

- Vite + React + TypeScript (strict)
- Tailwind CSS v4
- graphql-request for the GitHub GraphQL API
- @tanstack/react-query for fetching, caching, 60s auto-refresh
- zustand for UI state
- date-fns, lucide-react
- **Bun** as the package manager and script runner

## Prerequisites

- [Bun](https://bun.sh) 1.3+
- A GitHub **Personal Access Token** with scopes:
  - `repo`
  - `read:org`
  - `read:user`

The token is stored in your browser's `localStorage` only. It is never sent
anywhere except `api.github.com`.

## Getting started

```bash
bun install
bun dev
```

Open [http://localhost:5173](http://localhost:5173). On first load Perch
shows a token-setup screen:

1. Click **Create a token on GitHub** — this opens GitHub's token page with
   the correct scopes pre-selected.
2. Paste the token into the input.
3. Click **Test connection** to verify the token can read your viewer.
4. Click **Continue** to save the token and enter the dashboard.

Reset or replace the token from the **Settings** modal (`,` key, or the gear
icon in the header).

## Scripts

| Command | Purpose |
| --- | --- |
| `bun dev` | Start the Vite dev server on port 5173 |
| `bun run build` | Type-check (strict) and build to `dist/` |
| `bun run preview` | Preview the production build |
| `bun run typecheck` | Strict TypeScript check, no emit |
| `bun test` | Run the bucketing unit tests once |
| `bun run test:watch` | Watch the bucketing unit tests |

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `j` / `k` | Select next / previous PR |
| `↵` | Open selected PR on GitHub (new tab) |
| `e` | Toggle PR detail drawer |
| `/` | Focus the filter input |
| `r` | Manual refresh |
| `,` | Open settings |
| `?` | Toggle shortcut help |
| `Esc` | Close drawer / modal |

## Scope: Inbox vs Team

By default Perch shows only the PRs you authored plus the PRs where you are
a requested reviewer — the focused inbox.

If you add one or more **tracked orgs** in Settings, a segmented control
appears in the header:

- **Inbox** — the default scope. Your PRs + review-requested.
- **Team** — everything above, plus all open PRs in the tracked orgs.

Team PRs you have no relation to land in a dedicated "Team" bucket so they
don't dilute the signal of the action-oriented buckets.

## How bucketing works

PRs are assigned to exactly one bucket, evaluated in priority order (first
match wins):

1. **Waiting on me** — you're a requested reviewer and haven't approved or
   requested changes since the request. Always visible (empty state is a
   positive "all caught up" signal).
2. **Blocked** — you're the author and a reviewer requested changes, or CI
   is failing. Hidden when empty.
3. **Ready to merge** — you're the author, at least one approval, CI green,
   `MERGEABLE`, not draft. Hidden when empty.
4. **My PRs in review** — you're the author and the PR doesn't match the
   above. Hidden when empty.
5. **Stale** — a PR you're involved with that hasn't been updated in 7+
   days.
6. **Team** — broader-scope PRs where you have no direct relation (only
   populates in Team scope).
7. **Other** — rare; shown only when non-empty.
8. **Recently merged** — PRs you authored or reviewed that merged in
   the last 7 days. Historical, not attention-demanding — collapsed by
   default and tucked at the bottom.

The logic lives in a pure function at [`src/lib/bucketing.ts`](src/lib/bucketing.ts).
Tests are in [`src/lib/bucketing.test.ts`](src/lib/bucketing.test.ts).

## Project layout

```
src/
  lib/
    github.ts          # GraphQL client + query
    bucketing.ts       # pure bucketing logic
    bucketing.test.ts  # unit tests
    transform.ts       # raw GraphQL -> DashboardPR
    storage.ts         # token + theme persistence
  hooks/
    usePRs.ts          # react-query hook (60s refetch)
    useKeyboardNav.ts  # global keyboard handler
  components/
    Dashboard.tsx      # top-level orchestrator
    Sidebar.tsx        # left nav
    Header.tsx         # title bar (filter, refresh, settings, theme)
    HeadlineBand.tsx   # stats strip
    BucketSection.tsx  # collapsible bucket
    PRRow.tsx          # single row
    PRDetail.tsx       # right-side detail drawer
    TokenSetup.tsx     # first-run token screen
    Settings.tsx       # settings modal (theme, token reset, rate limit)
    HelpOverlay.tsx    # keyboard shortcut overlay
    LoadingSkeleton.tsx
    ErrorBanner.tsx
    primitives.tsx     # Avatar, Kbd, ApprovalChip, CIStatusChip, labels
  types/
    github.ts          # GraphQL response types
    dashboard.ts       # DashboardPR + bucket types
  store.ts             # zustand UI store
  App.tsx
  main.tsx
  index.css            # design tokens (dark + light)
```

## Data flow

- [`usePRs`](src/hooks/usePRs.ts) runs the
  [`PRDashboard` GraphQL query](src/lib/github.ts) with react-query's
  `refetchInterval: 60_000`.
- The raw response is flattened by
  [`transformDashboard`](src/lib/transform.ts) into `DashboardPR` domain
  objects — pre-computed `approvalCount`, `ciStatus`, `waitingTimeMs`, etc.
- [`bucketize`](src/lib/bucketing.ts) groups the flat list into five ordered
  buckets. PRs that appear in both `viewer.pullRequests` and
  `review-requested:@me` results are deduped by id.

## Theming

Dark mode is primary; a light theme is shipped as a parallel palette driven
by a `data-theme` attribute on `<html>`. Toggle from the header, persisted
in `localStorage`.

## Security notes

- The token lives only in `localStorage`. Clearing it from Settings removes
  it immediately.
- Error messages redact the token before display.
- No token is hardcoded or committed to the repo.

## Scope

This is the MVP: inbox view with auto-refresh and a detail drawer. Actions
on PRs (approve, comment, merge) aren't supported — clicking a row opens
the real GitHub page in a new tab. See [`instructions.md`](instructions.md)
for the original spec.
