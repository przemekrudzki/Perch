import type {
  GqlDashboardResponse,
  GqlLabel,
  GqlPullRequest,
  GqlUser,
  ReviewState,
} from '../types/github';
import type {
  ApprovalState,
  CIStatus,
  DashboardLabel,
  DashboardPR,
  DashboardReviewer,
  DashboardUser,
  LabelTone,
  TimelineEvent,
  TimelineEventKind,
} from '../types/dashboard';

const AV_KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

/** Deterministic gradient picker from login — matches design's 8 avatar gradients. */
export function avatarKey(login: string): string {
  if (!login) return 'a';
  let hash = 0;
  for (let i = 0; i < login.length; i++) {
    hash = (hash * 31 + login.charCodeAt(i)) >>> 0;
  }
  return AV_KEYS[hash % AV_KEYS.length]!;
}

function toUser(u: GqlUser | null | undefined): DashboardUser {
  if (!u) return { login: 'ghost', av: 'a' };
  return {
    login: u.login,
    avatarUrl: u.avatarUrl,
    av: avatarKey(u.login),
  };
}

const WARN_HEX = /^(d|e|f)/i;
const BLOCKED_NAMES = new Set(['blocked', 'do-not-merge', 'dnm']);

function hexLuma(hex: string): number {
  const h = hex.replace('#', '');
  if (h.length !== 6) return 0.5;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Map a GitHub label color to one of our semantic tones. */
function labelTone(label: GqlLabel): LabelTone {
  const name = label.name.toLowerCase();
  if (BLOCKED_NAMES.has(name)) return 'err';
  if (name.includes('bug')) return 'err';
  if (name.includes('perf') || name.includes('enhancement')) return 'ok';
  if (name.includes('qa') || name.includes('needs-')) return 'warn';
  if (name.includes('doc')) return 'info';
  if (name.includes('lti')) return 'violet';

  const hex = label.color || '888888';
  const l = hexLuma(hex);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  if (r > g + 40 && r > b + 40) return 'err';
  if (g > r + 20 && g > b) return 'ok';
  if (b > r + 30 && b > g) return 'info';
  if (r > 200 && g > 140 && b < 120 && WARN_HEX.test(hex)) return 'warn';
  if (l > 0.75) return 'warn';
  return 'neutral';
}

function toLabel(l: GqlLabel): DashboardLabel {
  return {
    name: l.name,
    color: l.color,
    tone: labelTone(l),
  };
}

function mapCI(state: string | null | undefined): CIStatus {
  switch (state) {
    case 'SUCCESS':
      return 'success';
    case 'FAILURE':
    case 'ERROR':
      return 'failure';
    case 'PENDING':
    case 'EXPECTED':
      return 'pending';
    default:
      return 'none';
  }
}

/** Latest review-state per reviewer login (submitted reviews only). */
function latestReviewByLogin(
  pr: GqlPullRequest
): Map<string, { state: ReviewState; submittedAt: string | null }> {
  const map = new Map<string, { state: ReviewState; submittedAt: string | null }>();
  for (const r of pr.reviews.nodes) {
    if (!r.author) continue;
    const prev = map.get(r.author.login);
    if (!prev) {
      map.set(r.author.login, { state: r.state, submittedAt: r.submittedAt });
      continue;
    }
    const prevT = prev.submittedAt ? Date.parse(prev.submittedAt) : 0;
    const curT = r.submittedAt ? Date.parse(r.submittedAt) : 0;
    if (curT >= prevT) {
      map.set(r.author.login, { state: r.state, submittedAt: r.submittedAt });
    }
  }
  return map;
}

/**
 * Transform a raw GraphQL PR into the flattened dashboard shape.
 * `reviewRequestedSet` is the set of PR ids where the viewer is currently requested.
 */
export function transformPR(
  pr: GqlPullRequest,
  viewerLogin: string,
  reviewRequestedSet: Set<string>
): DashboardPR {
  const latestByLogin = latestReviewByLogin(pr);
  const approvedLogins = new Set<string>();
  const changesLogins = new Set<string>();

  for (const [login, r] of latestByLogin) {
    if (r.state === 'APPROVED') approvedLogins.add(login);
    if (r.state === 'CHANGES_REQUESTED') changesLogins.add(login);
  }

  const requestedUserLogins: string[] = [];
  for (const req of pr.reviewRequests.nodes) {
    const rr = req.requestedReviewer;
    if (!rr) continue;
    if ((rr as { __typename?: string }).__typename === 'User') {
      const u = rr as unknown as GqlUser;
      requestedUserLogins.push(u.login);
    }
  }

  const allReviewerLogins = new Set<string>([
    ...requestedUserLogins,
    ...latestByLogin.keys(),
  ]);

  const approvalCount = approvedLogins.size;
  const reviewerCount = allReviewerLogins.size;

  let approvalState: ApprovalState;
  if (changesLogins.size > 0) approvalState = 'changes';
  else if (approvalCount > 0 && approvalCount >= reviewerCount && reviewerCount > 0)
    approvalState = 'approved';
  else approvalState = 'pending';

  const viewerLatest = latestByLogin.get(viewerLogin);
  let viewerReviewState: DashboardPR['viewerReviewState'] = 'none';
  if (viewerLatest) {
    if (viewerLatest.state === 'APPROVED') viewerReviewState = 'approved';
    else if (viewerLatest.state === 'CHANGES_REQUESTED') viewerReviewState = 'changes';
    else if (viewerLatest.state === 'COMMENTED') viewerReviewState = 'commented';
    else viewerReviewState = 'pending';
  }

  const viewerIsRequestedReviewer =
    reviewRequestedSet.has(pr.id) || requestedUserLogins.includes(viewerLogin);

  const author = toUser(pr.author);
  const viewerIsAuthor = pr.author?.login === viewerLogin;

  const reviewers: DashboardReviewer[] = [];
  const seen = new Set<string>();
  for (const login of requestedUserLogins) {
    if (seen.has(login)) continue;
    seen.add(login);
    reviewers.push({
      ...toUser({ login }),
      state: 'requested',
    });
  }
  for (const [login, r] of latestByLogin) {
    if (seen.has(login)) continue;
    seen.add(login);
    let s: DashboardReviewer['state'] = 'pending';
    if (r.state === 'APPROVED') s = 'approved';
    else if (r.state === 'CHANGES_REQUESTED') s = 'changes';
    else if (r.state === 'COMMENTED') s = 'commented';
    reviewers.push({
      ...toUser({ login }),
      state: s,
      submittedAt: r.submittedAt ?? undefined,
    });
  }

  const ciState =
    pr.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null;
  const ciStatus = mapCI(ciState);

  const updatedMs = Date.parse(pr.updatedAt);
  const waitingTimeMs = Math.max(0, Date.now() - updatedMs);
  const escalate = viewerIsRequestedReviewer && waitingTimeMs > 24 * 60 * 60 * 1000;

  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    isDraft: pr.isDraft,
    mergeable: pr.mergeable,
    updatedAt: pr.updatedAt,
    createdAt: pr.createdAt,
    repoNameWithOwner: pr.repository.nameWithOwner,
    author,
    viewerIsAuthor,
    viewerIsRequestedReviewer,
    approvalCount,
    reviewerCount,
    approvalState,
    viewerReviewState,
    ciStatus,
    labels: pr.labels.nodes.map(toLabel),
    reviewers,
    waitingTimeMs,
    escalate,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    commitCount: pr.commits.totalCount,
    timeline: buildTimeline(pr, author),
  };
}

/**
 * Assemble the drawer timeline: opened + reviews (approved / changes /
 * commented-with-body) + general issue comments, sorted ascending.
 */
function buildTimeline(
  pr: GqlPullRequest,
  author: DashboardUser
): TimelineEvent[] {
  const events: TimelineEvent[] = [
    {
      id: `${pr.id}-opened`,
      kind: 'opened',
      author,
      at: pr.createdAt,
    },
  ];

  for (const r of pr.reviews.nodes) {
    if (!r.author || !r.submittedAt) continue;
    let kind: TimelineEventKind | null = null;
    switch (r.state) {
      case 'APPROVED':
        kind = 'review-approved';
        break;
      case 'CHANGES_REQUESTED':
        kind = 'review-changes';
        break;
      case 'COMMENTED':
        // Only surface inline-review summaries that had an actual body;
        // empty COMMENTED reviews are typically created when a reviewer
        // left inline nits and nothing to say at the top level.
        if (r.body.trim().length === 0) continue;
        kind = 'review-comment';
        break;
      default:
        continue; // PENDING, DISMISSED
    }
    events.push({
      id: `${pr.id}-review-${r.author.login}-${r.submittedAt}`,
      kind,
      author: toUser(r.author),
      at: r.submittedAt,
      body: r.body.trim() || undefined,
    });
  }

  for (const c of pr.comments.nodes) {
    if (!c.author || !c.body) continue;
    events.push({
      id: c.id,
      kind: 'comment',
      author: toUser(c.author),
      at: c.createdAt,
      body: c.body,
    });
  }

  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return events;
}

/**
 * Transform the whole dashboard response. Dedupes PRs that appear across
 * viewer.pullRequests, reviewRequested, and (optionally) teamPrs (by id).
 */
export function transformDashboard(res: GqlDashboardResponse): {
  viewer: { login: string; avatarUrl: string };
  prs: DashboardPR[];
  rateLimit: { remaining: number; resetAt: string };
} {
  const viewerLogin = res.viewer.login;
  const requestedIds = new Set<string>(
    res.reviewRequested.nodes.filter((n) => n && n.id).map((n) => n.id)
  );

  const byId = new Map<string, GqlPullRequest>();
  const addNode = (pr: GqlPullRequest | null | undefined): void => {
    if (!pr || !pr.id) return;
    // Drop PRs from archived repos. `search` already filters these via
    // `archived:false`, but the direct `viewer.pullRequests` field does not.
    if (pr.repository?.isArchived) return;
    if (!byId.has(pr.id)) byId.set(pr.id, pr);
  };
  for (const pr of res.viewer.pullRequests.nodes) addNode(pr);
  for (const pr of res.reviewRequested.nodes) addNode(pr);
  if (res.teamPrs) {
    for (const pr of res.teamPrs.nodes) addNode(pr);
  }

  const prs = Array.from(byId.values()).map((pr) =>
    transformPR(pr, viewerLogin, requestedIds)
  );

  return {
    viewer: { login: viewerLogin, avatarUrl: res.viewer.avatarUrl },
    prs,
    rateLimit: res.rateLimit,
  };
}
