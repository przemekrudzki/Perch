# Perch roadmap

Living list of what's shipped, what's next, and what we've explicitly
chosen not to build. Check items off as they land and move "up next"
items into "shipped" with the commit SHA.

## Shipped

- [x] MVP dashboard with five action-oriented buckets (`a8fb7d4`)
- [x] Strict TypeScript + 18 unit tests covering bucketing and transform
- [x] Team scope — broader view across tracked orgs (`08dc4d9`)
- [x] Fix: teammate PRs you already reviewed land in Team, not Other (`0fcc398`)
- [x] Fix: `e` shortcut reliably toggles the detail drawer (`1791e77`)
- [x] Fix: drop PRs from archived repos across all fetch paths (`82b0551`)
- [x] GitHub Actions deploy workflow (`e1b6afa`)
- [x] Build version surfaced in Settings (SHA + branch + built-at) (`7786c32`)
- [x] Live-update prompt when a new build is deployed (`4a1d483`, copy
      polish in `61886e1`)
- [x] Tab badge + "new since last visit" indicator (`7299d85`)

## Up next

- [ ] **PR comments + diff stats in the detail drawer.** Add
  `reviews.nodes.comments`, `additions`, `deletions` to the GraphQL
  fragment. Wire into the drawer's timeline section (currently mock).
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
