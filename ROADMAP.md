# Perch roadmap

Living list of what's shipped, what's next, and what we've explicitly
chosen not to build. Check items off as they land and move "up next"
items into "shipped" with the commit SHA. The "Won't do" section is
the load-bearing one — keeps scope conversations from getting
re-litigated.

## Shipped

- [x] MVP dashboard with five action-oriented buckets (`a8fb7d4`)
- [x] Strict TypeScript + 20 unit tests covering bucketing and transform
- [x] Team scope — broader view across tracked orgs (`08dc4d9`)
- [x] Fix: teammate PRs you already reviewed land in Team, not Other (`0fcc398`)
- [x] Fix: `e` shortcut reliably toggles the detail drawer (`1791e77`)
- [x] Fix: drop PRs from archived repos across all fetch paths (`82b0551`)
- [x] GitHub Actions deploy workflow with Node 24 opt-in
      (`e1b6afa`, `d96c116`)
- [x] Build version surfaced in Settings (SHA + branch + built-at)
      (`7786c32`, dirty-probe skipped in CI in `62a36c1`)
- [x] Live-update prompt when a new build is deployed (`4a1d483`, copy
      polish in `61886e1`)
- [x] Tab badge + "new since last visit" indicator (`7299d85`)
- [x] PR comments + reviews + diff stats in the detail drawer,
      matching Claude Design's timeline pattern (`9467e6c`)
- [x] Inline review comments in the timeline with `path:line` label;
      also fixed dropping empty-body COMMENTED reviews that had
      inline-only feedback (`22e1a1d`)
- [x] ROADMAP + CLAUDE.md onboarding docs (`45def94`)
- [x] Real GitHub avatars for row reviewers with breathing-room
      spacing (`a6579d2`)
- [x] Row indicators live next to the title instead of pinned to the
      far right on wide screens (`d13ec78`)
- [x] Hover tooltip on the approval chip with reviewer-by-reviewer
      breakdown (`ae63b83`)
- [x] Real viewer avatar in the sidebar card (`9b164d9`)
- [x] "Recently merged" bucket — last 7 days of PRs you authored or
      reviewed, collapsed by default at the bottom
- [x] Rename "In review" → "My PRs in review" so the scope is
      obvious; hide Blocked / Ready / In review when empty so quiet
      days don't render ceremonial blank sections (Waiting-on-me and
      Stale still show when empty as positive signals)
- [x] Comment count chip on each row with hover tooltip
- [x] Clicking a row opens the detail drawer
- [x] Render comment bodies as proper Markdown (react-markdown +
      remark-gfm) so bot HTML wrappers don't leak into the timeline
- [x] PR description in the drawer timeline (attached to the
      "opened this PR" event)
- [x] "Needs reviewers" bucket — surfaces team PRs with fewer than
      two reviewers that the viewer hasn't touched, so you can pick
      one up to review
- [x] Sidebar Views/Repositories no longer show a click cursor for
      entries that aren't actually wired up

## Up next

- [ ] **Click a repo in the sidebar to scope the view.** The sidebar
  already lists repos with counts; make them filter pills that narrow
  every bucket to the selected repo.

## Ideas / parking lot

- Persist react-query cache to `localStorage` so the first paint after
  reload is instant (shows stale data while refetching).
- Remember collapsed bucket state in `localStorage`.
- Richer filter DSL in the `/` input: `repo:foo`, `author:@me`,
  `label:bug`.
- Stronger "attention needed" signal — title flash or a one-shot chime
  when a PR moves into Waiting-on-me.
- Show diff-stats summary (`+284 / -106`) inline on each PR row.
- "Dismiss" / "snooze" a PR client-side to temporarily hide noise.
- Jump-to-bucket keyboard shortcuts (`1`..`5`).

## Won't do (out of spec)

These are explicitly deferred; revisit if the tool graduates from MVP.

- Write actions: approve / comment / merge from Perch. Clicking a row
  opens the real GitHub page instead.
- OAuth flow. Personal Access Token is the auth model.
- Multi-user support / shared inboxes.
- Desktop / push notifications. The tab badge + favicon cover most of
  the value.
- Routing between multiple pages. Single layout with conditional
  panels.
