import type {
  DiffFile,
  DiffFileKind,
  DiffHunk,
  DiffRow,
  PRDiffResult,
} from '../types/diff';

/**
 * Heuristics for the "Hide generated" toggle. Best-effort — GitHub's
 * REST `/files` endpoint doesn't tell us whether a file was machine-
 * generated, so we look at the path. If a project has its own
 * conventions, add patterns here; the cost of a false-positive is
 * "user has to uncheck the toggle once".
 */
const GENERATED_PATTERNS: RegExp[] = [
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|Cargo\.lock|Gemfile\.lock|poetry\.lock|composer\.lock|Pipfile\.lock|go\.sum)$/,
  /\.lock$/,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)__generated__\//,
  /\.generated\.[a-z]+$/i,
  /\.min\.(js|css|map)$/i,
  /\.snap$/,
];

export function isGeneratedPath(path: string): boolean {
  return GENERATED_PATTERNS.some((re) => re.test(path));
}

/** Map GitHub's status string onto our four-way `DiffFileKind`. */
function mapStatus(status: string): DiffFileKind {
  switch (status) {
    case 'added':
      return 'added';
    case 'removed':
      return 'deleted';
    case 'renamed':
      return 'renamed';
    case 'modified':
    case 'changed':
    case 'copied':
    default:
      return 'modified';
  }
}

/**
 * Parse a unified-diff `patch` string into hunks.
 *
 * GitHub's REST endpoint returns each file's patch in this form:
 *
 *   @@ -118,12 +118,18 @@ context
 *    unchanged line
 *   -removed line
 *   +added line
 *
 * Hunk header line numbers are 1-based; we walk both old and new
 * counters as we emit rows. Lines starting with `\` (e.g. `\ No
 * newline at end of file`) are diff metadata, not content — skip.
 */
export function parsePatch(patch: string | null | undefined): DiffHunk[] {
  if (!patch) return [];

  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  // We split on \n and don't trim — context lines may legitimately be
  // blank, and an `\` metadata line is its own thing.
  const lines = patch.split('\n');
  for (const raw of lines) {
    if (raw.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (!m) {
        current = null;
        continue;
      }
      oldLine = parseInt(m[1] ?? '0', 10);
      newLine = parseInt(m[2] ?? '0', 10);
      current = { header: raw, rows: [] };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (raw.startsWith('\\')) continue;

    if (raw.startsWith('+')) {
      current.rows.push(makeRow('add', null, newLine, raw.slice(1)));
      newLine += 1;
    } else if (raw.startsWith('-')) {
      current.rows.push(makeRow('del', oldLine, null, raw.slice(1)));
      oldLine += 1;
    } else {
      // Context. Patches usually prefix context lines with a leading
      // space, but we accept bare lines too as a small kindness for
      // hand-edited fixtures and weirder upstream formatters.
      const text = raw.startsWith(' ') ? raw.slice(1) : raw;
      current.rows.push(makeRow('ctx', oldLine, newLine, text));
      oldLine += 1;
      newLine += 1;
    }
  }
  return hunks;
}

function makeRow(
  kind: DiffRow['kind'],
  ln: number | null,
  rn: number | null,
  text: string
): DiffRow {
  return { kind, ln, rn, text };
}

/** Shape of one entry in GitHub's `GET /pulls/{n}/files` response. */
export interface GhPullFile {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

/** Build a `DiffFile` from one element of the REST response. */
export function transformDiffFile(file: GhPullFile): DiffFile {
  const kind = mapStatus(file.status);
  const adds = file.additions ?? 0;
  const dels = file.deletions ?? 0;
  const hunks = parsePatch(file.patch);
  // GitHub omits `patch` for binary files. The same omission *can*
  // happen for very large patches, so distinguish: if there are
  // recorded line changes, it's "patch withheld" (we treat as
  // truncated); if zero line changes, it's binary.
  const hasPatch = typeof file.patch === 'string' && file.patch.length > 0;
  const binary = !hasPatch && adds === 0 && dels === 0 && kind !== 'renamed';
  const truncated =
    !hasPatch && (adds > 0 || dels > 0) && kind !== 'renamed';
  return {
    path: file.filename,
    ...(file.previous_filename ? { fromPath: file.previous_filename } : {}),
    kind,
    adds,
    dels,
    binary,
    generated: isGeneratedPath(file.filename),
    truncated,
    hunks,
  };
}

/**
 * Fetch the file list + patches for one PR. Uses GitHub's REST API
 * because GraphQL doesn't expose patch text. Same PAT, same scopes.
 *
 * For PRs with more than 100 changed files we only fetch the first
 * 100 and let the caller surface the partial state via the returned
 * `total`. v0 doesn't paginate — it's rare and the UX trade-off
 * (latency vs. completeness) deserves an explicit decision later.
 */
export async function fetchPRDiff(
  token: string,
  repoNameWithOwner: string,
  pullNumber: number,
  totalChangedFiles: number
): Promise<PRDiffResult> {
  const url = `https://api.github.com/repos/${repoNameWithOwner}/pulls/${pullNumber}/files?per_page=100`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'perch-dashboard',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `GitHub /pulls/${pullNumber}/files: ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`
    );
  }
  const json = (await res.json()) as GhPullFile[];
  const files = json.map(transformDiffFile);
  return { files, total: totalChangedFiles };
}

/** Pair consecutive deletions/additions within each change block.
 * Context rows anchor both sides; unmatched changes leave an empty cell.
 */
export function splitDiffRows(rows: DiffRow[]): { old: DiffRow | null; new: DiffRow | null }[] {
  const result: { old: DiffRow | null; new: DiffRow | null }[] = [];
  let old: DiffRow[] = [];
  let next: DiffRow[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(old.length, next.length); i++) {
      result.push({ old: old[i] ?? null, new: next[i] ?? null });
    }
    old = [];
    next = [];
  };
  for (const row of rows) {
    if (row.kind === 'ctx') {
      flush();
      result.push({ old: row, new: row });
    } else if (row.kind === 'del') {
      old.push(row);
    } else {
      next.push(row);
    }
  }
  flush();
  return result;
}
