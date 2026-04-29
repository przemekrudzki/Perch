# CLAUDE.md — Perch project guide

Context and conventions for Claude (or any agent) working in this repo.
For the user-facing overview, see [`README.md`](README.md). For planned
work, see [`ROADMAP.md`](ROADMAP.md).

## What this is

Perch is a single-user, client-only GitHub PR inbox. Everything runs in
the browser. There is no backend, no database, no SSR. The Personal
Access Token lives in `localStorage`; GraphQL calls go straight to
`api.github.com`.

Keep that boundary intact. If a feature needs server-side code, flag
it explicitly — don't sneak it in.

## Stack and tooling

- **Vite + React 18 + TypeScript (strict)**
- **Tailwind CSS v4** (but most components use inline styles with CSS
  custom properties — see below)
- **graphql-request** for GitHub's GraphQL API
- **@tanstack/react-query** for fetching + 60s polling
- **zustand** for UI state, **date-fns** for time, **lucide-react** for
  icons
- **Bun** is the only package manager. Do not run `npm install` or
  `yarn` — if something fails under Bun, flag it, don't switch tools.

## Scripts

```bash
bun dev              # Vite dev server on :5173
bun run build        # Strict tsc + Vite build → dist/
bun run typecheck    # tsc -b --noEmit
bun test             # Vitest run (bucketing + transform tests)
bun run test:watch   # Watch mode
```

Before asserting a change works:

- `bun test` must pass
- `bun run typecheck` must pass
- `bun run build` must succeed

Do **not** claim a task is done without these green.

## Project layout

```
src/
  lib/          Pure logic: GraphQL client, transform, bucketing,
                storage, seen-set.
  hooks/        usePRs (react-query), useKeyboardNav, useNewPRs,
                useTitleAndFavicon, useVersionCheck.
  components/   All React components. Dashboard is the orchestrator.
                primitives.tsx holds shared chips / avatar / kbd.
  types/        github.ts (GraphQL response), dashboard.ts (domain
                DashboardPR), env.d.ts (build-time globals).
  store.ts      Zustand UI store (token, theme, scope, selection).
  version.ts    Exposes the baked-in __APP_VERSION__ constant.
```

New logic worth unit-testing (bucketing, transform) goes next to the
source as `*.test.ts`. Other code is trusted-by-types; the spec
explicitly keeps integration/UI tests out of scope.

## Design conventions

**Tokens, not ad-hoc values.** Colors, radii, and the primary row
height live in CSS custom properties defined in `src/index.css`
(`--bg-0`, `--fg-0`, `--accent`, `--ok`, `--err`, `--warn`, `--violet`,
`--row-h`, `--r-1/2/3`, etc.). Always use the variables, never
hardcoded hex.

**Dark is primary, light is a parallel palette.** Theme is driven by
`data-theme="light"` on `<html>`. Never hardcode a single-theme color.

**Inline styles with CSS vars.** Most components use
`style={{ background: 'var(--bg-1)' }}` rather than Tailwind utility
classes, matching the design handoff. Tailwind v4 is installed for
future flexibility, but don't add utility classes to existing
components unless replacing an obvious inline duplication. Stay
consistent with the file you're editing.

**Typography.** Geist Sans for UI, Geist Mono for SHAs / numbers /
identifiers — use the `.mono` and `.num` classes defined in
`src/index.css`.

## Data flow invariants

- GraphQL response → `transformDashboard` (`src/lib/transform.ts`) →
  `DashboardPR[]` → `bucketize` (`src/lib/bucketing.ts`) → UI.
- `transform.ts` is where filters like "drop archived repos" live, so
  every entry path (viewer-authored, review-requested, team-scope) is
  covered.
- `bucketing.ts` is a pure function with unit tests. Changes there
  require updating tests.
- Components never touch raw GraphQL types; they consume `DashboardPR`.

## Deploy workflow

- Pushing to `main` triggers `.github/workflows/deploy.yml`: install →
  test → build → rsync `dist/` to the VPS.
- **Tests gate the deploy.** A red `bun test` = no rsync.
- The live site is `perch.przemek.dev`, served by Caddy from
  `/var/www/perch` with auto-TLS.
- The running app polls `/version.json` every 60s and prompts users to
  reload when the deployed SHA diverges from the one baked into their
  bundle.

## Working style for agents

- **Auto-push after every commit.** The user authorized this — after
  any successful `git commit`, run `git push`. Don't ask. (Exception:
  destructive remote ops like force-push, branch delete, creating
  releases — still confirm.)
- **Don't add docs or scaffolding the user didn't ask for.** Prefer
  editing existing files to creating new ones.
- **No emojis in code or commit messages** unless the user explicitly
  requests them.
- **Commit messages:** imperative mood, explain the *why* in the body
  (not just the *what*). End with the `Co-Authored-By:` trailer.
- **Scope discipline.** See `ROADMAP.md` for "Won't do" items. Bug
  fixes don't need surrounding refactors; features don't need
  speculative abstractions.

## Things that regularly bite

- **`viewer.pullRequests` ignores `archived:false`.** It's a direct
  field, not a search. Filter archived repos in `transformDashboard`.
- **GitHub has three comment mechanisms.** Don't assume one fetch
  covers them all:
  - `pr.comments` → general PR-level IssueComments
  - `pr.reviews.nodes.body` → review-level summary text
  - `pr.reviews.nodes.comments` → inline diff comments with `path`
    and `line`
  A reviewer leaving only inline nits creates a review with
  `state=COMMENTED` and an *empty* body. Never drop such reviews
  without checking their inline comments too.
- **Query cost is cumulative.** Each PR fragment currently pulls
  ~reviews(20) × comments(10) + issueComments(20) + 10 labels + 10
  review requests + 5 assignees. Four top-level search queries
  (viewer.pullRequests, reviewRequested, teamPrs when Team scope is
  on, and recentlyMerged) multiply that. Before adding more nested
  connections, think about the rate-limit budget.
- **Reviewer counts exclude the PR author and `[bot]` accounts.**
  `transform.ts` filters both out of `approvalCount` / `reviewerCount`
  / the `reviewers` array surfaced on each row. Bots still appear in
  the timeline (so users can read what they said), but they don't
  inflate "1/2 approved" style chips. See `countsAsReviewer` /
  `isBotLogin` in `src/lib/transform.ts`.
- **Merged vs open PRs.** `viewer.pullRequests` and `reviewRequested`
  only return OPEN PRs. Merged PRs arrive via the separate
  `recentlyMerged` search. They short-circuit bucketing (first rule
  in `bucketOf`) so they never get evaluated against open-PR rules
  like "blocked" or "ready". If you add new bucket rules, remember
  `isMerged` wins before anything else.
- **Vite's `define` globals need a matching `declare const` in
  `src/types/env.d.ts`.** Don't forget to add Vite client types
  reference (`/// <reference types="vite/client" />`) if you introduce
  `import.meta.env`.
- **`tsconfig.node.json` needs `"types": ["node"]`** because
  `vite.config.ts` uses Node built-ins (`node:child_process`,
  `process.env`).
- **PAT is sensitive.** Redact it in any error surface that shows the
  original message. `src/lib/storage.ts` has the helper.
- **Bun's test runner picks up `*.test.ts`.** Don't name unrelated
  fixture files `*.test.ts`.
