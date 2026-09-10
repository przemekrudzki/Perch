import type { DashboardPR } from '../types/dashboard';

export interface PRFilters {
  query: string;
  authorLogin: string | null;
}

/** Apply the dashboard's composable, client-side view filters. */
export function filterPRs(
  prs: readonly DashboardPR[],
  { query, authorLogin }: PRFilters
): DashboardPR[] {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedAuthor = authorLogin?.trim().toLowerCase() || null;

  if (!normalizedQuery && !normalizedAuthor) return [...prs];

  return prs.filter((pr) => {
    if (
      normalizedAuthor &&
      pr.author.login.toLowerCase() !== normalizedAuthor
    ) {
      return false;
    }

    if (!normalizedQuery) return true;

    return (
      String(pr.number) === normalizedQuery.replace(/^#/, '') ||
      pr.title.toLowerCase().includes(normalizedQuery) ||
      pr.repoNameWithOwner.toLowerCase().includes(normalizedQuery) ||
      pr.author.login.toLowerCase().includes(normalizedQuery) ||
      pr.labels.some((label) =>
        label.name.toLowerCase().includes(normalizedQuery)
      )
    );
  });
}
