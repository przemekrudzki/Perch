/**
 * Domain types for the Diff tab. Independent of GitHub's REST shape —
 * `parsePatch` and `transformDiffFile` in `src/lib/diff.ts` map the
 * REST response onto these.
 */

export type DiffRowKind = 'ctx' | 'add' | 'del';

export interface DiffRow {
  kind: DiffRowKind;
  /** Old-side line number (null for adds). */
  ln: number | null;
  /** New-side line number (null for deletes). */
  rn: number | null;
  text: string;
}

export interface DiffHunk {
  /** The raw `@@ -L,N +L,N @@ context` header. */
  header: string;
  rows: DiffRow[];
}

export type DiffFileKind = 'modified' | 'added' | 'deleted' | 'renamed';

export interface DiffFile {
  /** Current path (post-rename for renames). */
  path: string;
  /** Previous path, populated for renamed files only. */
  fromPath?: string;
  kind: DiffFileKind;
  adds: number;
  dels: number;
  /** True for files GitHub returned without a patch (PNG, lockfiles, etc.). */
  binary: boolean;
  /** True when our heuristic flags the path as machine-generated. */
  generated: boolean;
  /**
   * True when GitHub truncated the patch (3000-line per-file cap, or
   * for the rare patches GitHub omits for size). The `hunks` array
   * may still contain a partial diff in that case.
   */
  truncated: boolean;
  hunks: DiffHunk[];
}

export interface PRDiffResult {
  files: DiffFile[];
  /**
   * GitHub's `/files` endpoint paginates at 100 per page. When `total`
   * exceeds `files.length` we know we truncated; the UI surfaces this
   * as a "showing N of M files" footer link.
   */
  total: number;
}

export type DiffView = 'unified' | 'split';
