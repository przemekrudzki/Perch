import { describe, expect, it } from 'vitest';
import {
  splitDiffRows,
  isGeneratedPath,
  parsePatch,
  transformDiffFile,
  type GhPullFile,
} from './diff';

describe('parsePatch', () => {
  it('returns no hunks for an empty / null patch', () => {
    expect(parsePatch('')).toEqual([]);
    expect(parsePatch(null)).toEqual([]);
    expect(parsePatch(undefined)).toEqual([]);
  });

  it('parses a single hunk with adds, dels, and context', () => {
    const patch = [
      '@@ -1,3 +1,4 @@',
      ' line one',
      '-line two',
      '+line two prime',
      '+line two-and-a-half',
      ' line three',
    ].join('\n');
    const hunks = parsePatch(patch);
    expect(hunks).toHaveLength(1);
    const h = hunks[0]!;
    expect(h.header).toBe('@@ -1,3 +1,4 @@');
    expect(h.rows).toEqual([
      { kind: 'ctx', ln: 1, rn: 1, text: 'line one' },
      { kind: 'del', ln: 2, rn: null, text: 'line two' },
      { kind: 'add', ln: null, rn: 2, text: 'line two prime' },
      { kind: 'add', ln: null, rn: 3, text: 'line two-and-a-half' },
      { kind: 'ctx', ln: 3, rn: 4, text: 'line three' },
    ]);
  });

  it('handles a freshly added file (`-0,0 +1,N`)', () => {
    const patch = [
      '@@ -0,0 +1,3 @@',
      '+import foo from "./foo";',
      '+',
      '+export const bar = foo();',
    ].join('\n');
    const hunks = parsePatch(patch);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.rows.map((r) => r.kind)).toEqual(['add', 'add', 'add']);
    expect(hunks[0]!.rows.map((r) => r.rn)).toEqual([1, 2, 3]);
    expect(hunks[0]!.rows.every((r) => r.ln === null)).toBe(true);
  });

  it('parses multiple hunks with their own counters', () => {
    const patch = [
      '@@ -10,2 +10,3 @@ first context',
      ' a',
      '+b',
      ' c',
      '@@ -50,2 +51,2 @@ second context',
      '-x',
      '+y',
      ' z',
    ].join('\n');
    const hunks = parsePatch(patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]!.rows[0]).toMatchObject({ kind: 'ctx', ln: 10, rn: 10 });
    expect(hunks[1]!.rows[0]).toMatchObject({ kind: 'del', ln: 50, rn: null });
    // Second hunk new-line counter starts at 51 per the header.
    expect(hunks[1]!.rows[1]).toMatchObject({ kind: 'add', rn: 51 });
  });

  it('skips `\\ No newline at end of file` metadata lines', () => {
    const patch = [
      '@@ -1,2 +1,2 @@',
      ' first',
      '-second',
      '\\ No newline at end of file',
      '+second prime',
      '\\ No newline at end of file',
    ].join('\n');
    const hunks = parsePatch(patch);
    expect(hunks[0]!.rows.map((r) => r.kind)).toEqual(['ctx', 'del', 'add']);
    expect(hunks[0]!.rows[2]!.text).toBe('second prime');
  });

  it('treats lines before the first hunk header as preamble (no rows)', () => {
    // Some upstream tools emit `--- a/x` / `+++ b/x` headers — those
    // lines start with - / + but predate any @@. Confirm we don't
    // misclassify them as adds/dels.
    const patch = [
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -1,1 +1,1 @@',
      '-old',
      '+new',
    ].join('\n');
    const hunks = parsePatch(patch);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.rows.map((r) => r.kind)).toEqual(['del', 'add']);
  });
});

describe('transformDiffFile', () => {
  function makeFile(over: Partial<GhPullFile>): GhPullFile {
    return {
      filename: 'src/foo.ts',
      status: 'modified',
      additions: 0,
      deletions: 0,
      ...over,
    };
  }

  it('flags binary when patch is missing and there are no recorded line changes', () => {
    const out = transformDiffFile(
      makeFile({ filename: 'docs/diagram.png', additions: 0, deletions: 0 })
    );
    expect(out.binary).toBe(true);
    expect(out.truncated).toBe(false);
  });

  it('flags truncated when patch is missing but additions/deletions are non-zero', () => {
    const out = transformDiffFile(
      makeFile({ additions: 1500, deletions: 1500 })
    );
    expect(out.binary).toBe(false);
    expect(out.truncated).toBe(true);
  });

  it('renamed files with no content change are neither binary nor truncated', () => {
    const out = transformDiffFile(
      makeFile({
        status: 'renamed',
        filename: 'src/bar.ts',
        previous_filename: 'src/foo.ts',
        additions: 0,
        deletions: 0,
      })
    );
    expect(out.kind).toBe('renamed');
    expect(out.binary).toBe(false);
    expect(out.truncated).toBe(false);
    expect(out.fromPath).toBe('src/foo.ts');
  });

  it('parses the patch when present', () => {
    const out = transformDiffFile(
      makeFile({
        additions: 1,
        deletions: 1,
        patch: '@@ -1,1 +1,1 @@\n-old\n+new',
      })
    );
    expect(out.hunks).toHaveLength(1);
    expect(out.hunks[0]!.rows).toEqual([
      { kind: 'del', ln: 1, rn: null, text: 'old' },
      { kind: 'add', ln: null, rn: 1, text: 'new' },
    ]);
  });
});

describe('isGeneratedPath', () => {
  it('matches common lockfiles and generated dirs', () => {
    expect(isGeneratedPath('package-lock.json')).toBe(true);
    expect(isGeneratedPath('pnpm-lock.yaml')).toBe(true);
    expect(isGeneratedPath('packages/foo/yarn.lock')).toBe(true);
    expect(isGeneratedPath('Cargo.lock')).toBe(true);
    expect(isGeneratedPath('go.sum')).toBe(true);
    expect(isGeneratedPath('dist/index.js')).toBe(true);
    expect(isGeneratedPath('packages/x/dist/index.js')).toBe(true);
    expect(isGeneratedPath('src/__generated__/api.ts')).toBe(true);
    expect(isGeneratedPath('src/api.generated.ts')).toBe(true);
    expect(isGeneratedPath('public/bundle.min.js')).toBe(true);
    expect(isGeneratedPath('__snapshots__/Component.test.ts.snap')).toBe(true);
  });

  it('does not flag normal source files', () => {
    expect(isGeneratedPath('src/foo.ts')).toBe(false);
    expect(isGeneratedPath('README.md')).toBe(false);
    expect(isGeneratedPath('package.json')).toBe(false);
    expect(isGeneratedPath('docs/locked-down-rooms.md')).toBe(false);
  });
});

describe('splitDiffRows', () => {
  it('aligns context and replacements without pairing across context boundaries', () => {
    const [hunk] = parsePatch('@@ -1,5 +1,5 @@\n start\n-old one\n-old two\n+new one\n middle\n-last\n+last one\n+last two');
    const pairs = splitDiffRows(hunk.rows);
    expect(pairs.map((pair) => [pair.old?.text ?? null, pair.new?.text ?? null])).toEqual([
      ['start', 'start'],
      ['old one', 'new one'],
      ['old two', null],
      ['middle', 'middle'],
      ['last', 'last one'],
      [null, 'last two'],
    ]);
    expect(pairs[1].old?.ln).toBe(2);
    expect(pairs[1].new?.rn).toBe(2);
    expect(pairs[4].old?.ln).toBe(5);
    expect(pairs[4].new?.rn).toBe(4);
  });

  it('handles added and deleted files, empty hunks, and preserves whitespace', () => {
    expect(splitDiffRows([])).toEqual([]);
    const [added] = parsePatch('@@ -0,0 +1,2 @@\n+  indented\n+');
    expect(splitDiffRows(added.rows).map((pair) => [pair.old, pair.new?.text])).toEqual([
      [null, '  indented'], [null, ''],
    ]);
    const [deleted] = parsePatch('@@ -1,1 +0,0 @@\n-gone');
    expect(splitDiffRows(deleted.rows)).toEqual([{ old: deleted.rows[0], new: null }]);
  });
});
