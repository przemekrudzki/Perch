import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Check, ExternalLink } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  DiffFile,
  DiffFileKind,
  DiffHunk,
  DiffRow,
} from '../types/diff';
import type { DashboardPR, TimelineEvent } from '../types/dashboard';
import { Avatar } from './primitives';
import { usePRDiff } from '../hooks/usePRDiff';
import { useUIStore } from '../store';
import { loadViewedFiles, setFileViewed } from '../lib/viewedFiles';

interface Props {
  pr: DashboardPR;
  /**
   * Drives the lazy fetch — DiffTab only requests the diff once the
   * user actually opens the tab.
   */
  active: boolean;
}

/**
 * Diff tab for the PR detail drawer. Renders the file list, sticky
 * "currently viewing" bar, and unified-diff per file. Inline review
 * comments anchor to (path, new-side line). v0 — read-only; the
 * "+ on each diff line" gutter affordance from the design lives in
 * the future write phase.
 */
export function DiffTab({ pr, active }: Props): JSX.Element {
  const token = useUIStore((s) => s.token);
  const query = usePRDiff({
    token,
    repoNameWithOwner: pr.repoNameWithOwner,
    pullNumber: pr.number,
    changedFiles: pr.changedFiles,
    enabled: active,
  });

  if (!active) return <div />;

  if (query.isLoading) {
    return (
      <DiffStatus>Loading diff…</DiffStatus>
    );
  }
  if (query.isError) {
    return (
      <DiffStatus tone="err">
        Couldn't load diff. {query.error?.message ?? 'Unknown error'}
        <div style={{ marginTop: 6 }}>
          <a
            href={pr.url + '/files'}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--info)' }}
          >
            View on GitHub <ExternalLink size={11} style={{ verticalAlign: -1 }} />
          </a>
        </div>
      </DiffStatus>
    );
  }
  const data = query.data;
  if (!data || data.files.length === 0) {
    return <DiffStatus>No file changes returned for this PR.</DiffStatus>;
  }

  return <DiffTabBody pr={pr} files={data.files} totalFiles={data.total} />;
}

// ─── Body (post-load) ────────────────────────────────────────────────

function DiffTabBody({
  pr,
  files,
  totalFiles,
}: {
  pr: DashboardPR;
  files: DiffFile[];
  totalFiles: number;
}): JSX.Element {
  const [hideGenerated, setHideGenerated] = useState(true);
  const [viewedSet, setViewedSet] = useState<Set<string>>(() =>
    loadViewedFiles(pr.id)
  );
  const [activePath, setActivePath] = useState<string>(() => files[0]!.path);

  // Ref on the scrolling container so we can compute scroll offsets
  // for click-to-scroll without falling back to `scrollIntoView`,
  // which doesn't account for the sticky file bar at the top of the
  // pane.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Suppresses the IntersectionObserver from clobbering `activePath`
  // while we're animating to a clicked target. Tiny window — the
  // smooth scroll lands fast.
  const suppressSpyRef = useRef(false);

  const visibleFiles = useMemo(
    () => (hideGenerated ? files.filter((f) => !f.generated) : files),
    [files, hideGenerated]
  );
  const hiddenCount = hideGenerated
    ? files.filter((f) => f.generated).length
    : 0;

  // Group inline review comments by `${path}::${line}` (new-side line)
  // so we can drop them under the matching diff row.
  const inlineComments = useMemo(
    () => groupInlineComments(pr.timeline),
    [pr.timeline]
  );

  const activeFile =
    visibleFiles.find((f) => f.path === activePath) ?? visibleFiles[0]!;
  const activeIdx = visibleFiles.indexOf(activeFile);

  const toggleViewed = (path: string): void => {
    setViewedSet((prev) => {
      const next = new Set(prev);
      const isViewed = next.has(path);
      if (isViewed) next.delete(path);
      else next.add(path);
      setFileViewed(pr.id, path, !isViewed);
      return next;
    });
  };

  // Scroll the pane to a file's card. The sticky bar covers the top
  // ~36px, so we offset the target's offsetTop by that much.
  const STICKY_BAR_HEIGHT = 36;
  const scrollToFile = (path: string): void => {
    const container = scrollRef.current;
    if (!container) return;
    const id = `f-${cssIdSafe(path)}`;
    const el = container.querySelector<HTMLElement>(`[data-file-anchor="${id}"]`);
    if (!el) return;
    suppressSpyRef.current = true;
    const top = el.offsetTop - STICKY_BAR_HEIGHT;
    container.scrollTo({ top, behavior: 'smooth' });
    // Release the spy lock after the smooth scroll has had time to
    // settle. 600ms is conservative — most scrolls land in 300ms.
    window.setTimeout(() => {
      suppressSpyRef.current = false;
    }, 600);
  };

  const handleSelect = (path: string): void => {
    setActivePath(path);
    scrollToFile(path);
  };

  const goPrev = (): void => {
    if (activeIdx > 0) handleSelect(visibleFiles[activeIdx - 1]!.path);
  };
  const goNext = (): void => {
    if (activeIdx < visibleFiles.length - 1)
      handleSelect(visibleFiles[activeIdx + 1]!.path);
  };

  // Scroll-spy: track which file is currently topmost in the scroll
  // pane and reflect it in `activePath`. Uses scroll position (not
  // IntersectionObserver) so the threshold matches the sticky bar
  // exactly — IO's `rootMargin` is fiddly with sticky positioning.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let raf = 0;
    const onScroll = (): void => {
      if (suppressSpyRef.current) return;
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const cards = container.querySelectorAll<HTMLElement>(
          '[data-file-anchor]'
        );
        let bestPath: string | null = null;
        let bestTop = -Infinity;
        const cutoff = container.scrollTop + STICKY_BAR_HEIGHT + 4;
        for (const c of cards) {
          const top = c.offsetTop;
          if (top <= cutoff && top > bestTop) {
            bestTop = top;
            bestPath = c.dataset['filePath'] ?? null;
          }
        }
        if (bestPath && bestPath !== activePath) {
          setActivePath(bestPath);
        }
      });
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [activePath, visibleFiles]);

  // If the active file gets hidden by the generated filter, snap to
  // the first visible one — otherwise the sticky bar would point at a
  // file that's no longer in the DOM.
  useEffect(() => {
    if (visibleFiles.length === 0) return;
    if (!visibleFiles.some((f) => f.path === activePath)) {
      setActivePath(visibleFiles[0]!.path);
    }
  }, [visibleFiles, activePath]);

  return (
    <div
      style={{
        display: 'flex',
        // Left rail (file list) + right pane (diff content). Both
        // scroll independently. The rail stays in view as the user
        // moves through long files, and gives more vertical space to
        // the diff itself than a top-of-pane file list did.
        flexDirection: 'row',
        flex: 1,
        minHeight: 0,
        background: 'var(--bg-0)',
      }}
    >
      <FilePane
        files={files}
        visibleFiles={visibleFiles}
        activePath={activePath}
        onSelect={handleSelect}
        viewedSet={viewedSet}
        onToggleViewed={toggleViewed}
        hideGenerated={hideGenerated}
        onToggleGenerated={() => setHideGenerated((v) => !v)}
        hiddenCount={hiddenCount}
        commentCount={(path) =>
          countCommentsForPath(inlineComments, path)
        }
      />

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          minHeight: 0,
          minWidth: 0,
        }}
        data-diff-scroll
      >
        <StickyFileBar
          file={activeFile}
          idx={activeIdx}
          total={visibleFiles.length}
          onPrev={goPrev}
          onNext={goNext}
        />
        {visibleFiles.map((f) => (
          <FileCard
            key={f.path}
            file={f}
            prUrl={pr.url}
            inlineComments={inlineComments}
            viewed={viewedSet.has(f.path)}
            onToggleViewed={() => toggleViewed(f.path)}
          />
        ))}
        <DiffFooter
          shownCount={visibleFiles.length}
          fetchedCount={files.length}
          totalChanged={totalFiles}
          hiddenGenerated={hiddenCount}
          onShowGenerated={() => setHideGenerated(false)}
          prUrl={pr.url}
        />
      </div>
    </div>
  );
}

// ─── File pane (left rail, full-height) ─────────────────────────────

const FILE_PANE_WIDTH = 280;

function FilePane({
  files,
  visibleFiles,
  activePath,
  onSelect,
  viewedSet,
  onToggleViewed,
  hideGenerated,
  onToggleGenerated,
  hiddenCount,
  commentCount,
}: {
  files: DiffFile[];
  visibleFiles: DiffFile[];
  activePath: string;
  onSelect: (path: string) => void;
  viewedSet: Set<string>;
  onToggleViewed: (path: string) => void;
  hideGenerated: boolean;
  onToggleGenerated: () => void;
  hiddenCount: number;
  commentCount: (path: string) => number;
}): JSX.Element {
  return (
    <div
      style={{
        width: FILE_PANE_WIDTH,
        flexShrink: 0,
        borderRight: '1px solid var(--line-2)',
        background: 'var(--bg-1)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div
        style={{
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'var(--bg-2)',
          borderBottom: '1px solid var(--line-2)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 600, color: 'var(--fg-1)', fontSize: 11 }}>
          Files
        </span>
        <span className="mono" style={{ color: 'var(--fg-3)', fontSize: 11 }}>
          {visibleFiles.length}
          {hideGenerated && hiddenCount > 0 && (
            <span style={{ color: 'var(--fg-4)' }}>/{files.length}</span>
          )}
        </span>
        <span style={{ flex: 1 }} />
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 10.5,
            color: 'var(--fg-2)',
            cursor: 'pointer',
          }}
          title={
            hiddenCount > 0
              ? `${hiddenCount} generated file${hiddenCount === 1 ? '' : 's'} hidden`
              : 'Hide generated files (lockfiles, dist/, snapshots, etc.)'
          }
        >
          <input
            type="checkbox"
            checked={hideGenerated}
            onChange={onToggleGenerated}
            style={{
              width: 11,
              height: 11,
              margin: 0,
              accentColor: 'var(--accent)',
              cursor: 'pointer',
            }}
          />
          Hide generated
        </label>
      </div>
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          minHeight: 0,
        }}
      >
        {visibleFiles.map((f) => (
          <FileRow
            key={f.path}
            file={f}
            active={f.path === activePath}
            viewed={viewedSet.has(f.path)}
            commentCount={commentCount(f.path)}
            onClick={() => onSelect(f.path)}
            onToggleViewed={(e) => {
              e.stopPropagation();
              onToggleViewed(f.path);
            }}
          />
        ))}
        {visibleFiles.length === 0 && (
          <div
            style={{
              padding: 14,
              textAlign: 'center',
              color: 'var(--fg-3)',
              fontSize: 11,
            }}
          >
            All {files.length} file{files.length === 1 ? '' : 's'} hidden by
            the generated filter.
          </div>
        )}
      </div>
    </div>
  );
}

function FileRow({
  file,
  active,
  viewed,
  commentCount,
  onClick,
  onToggleViewed,
}: {
  file: DiffFile;
  active: boolean;
  viewed: boolean;
  commentCount: number;
  onClick: () => void;
  onToggleViewed: (e: React.MouseEvent) => void;
}): JSX.Element {
  const path = file.path;
  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
  const base = slash >= 0 ? path.slice(slash + 1) : path;

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 28,
        padding: '0 12px',
        cursor: 'pointer',
        background: active ? 'var(--bg-3)' : 'transparent',
        borderLeft: active
          ? '2px solid var(--accent)'
          : '2px solid transparent',
        opacity: viewed ? 0.55 : 1,
      }}
    >
      <KindGlyph kind={file.kind} />
      <span
        className="mono"
        style={{
          fontSize: 11.5,
          flex: 1,
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          direction: 'rtl',
          textAlign: 'left',
        }}
        title={path}
      >
        <span style={{ color: 'var(--fg-3)' }}>{dir}</span>
        <span
          style={{
            color: viewed ? 'var(--fg-2)' : 'var(--fg-0)',
            fontWeight: 500,
          }}
        >
          {base}
        </span>
      </span>
      {commentCount > 0 && (
        <span
          title={`${commentCount} comment${commentCount === 1 ? '' : 's'}`}
          style={{
            fontSize: 10,
            color: 'var(--info)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {commentCount}
        </span>
      )}
      {file.binary && <BinTag>BIN</BinTag>}
      {file.generated && (
        <span title="Generated" style={{ fontSize: 9.5, color: 'var(--fg-3)' }}>
          gen
        </span>
      )}
      {file.truncated && (
        <span style={{ fontSize: 9.5, color: 'var(--warn)' }}>truncated</span>
      )}
      {!file.binary && !file.truncated && (file.adds > 0 || file.dels > 0) && (
        <ChangeBar adds={file.adds} dels={file.dels} />
      )}
      <ViewedCheckbox viewed={viewed} onClick={onToggleViewed} />
    </div>
  );
}

function BinTag({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <span
      style={{
        fontSize: 9.5,
        color: 'var(--fg-3)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}
    >
      {children}
    </span>
  );
}

function ViewedCheckbox({
  viewed,
  onClick,
}: {
  viewed: boolean;
  onClick: (e: React.MouseEvent) => void;
}): JSX.Element {
  return (
    <span
      onClick={onClick}
      title={viewed ? 'Mark as unviewed' : 'Mark as viewed'}
      style={{
        width: 12,
        height: 12,
        borderRadius: 2,
        border: `1px solid ${viewed ? 'var(--ok)' : 'var(--line-3)'}`,
        background: viewed ? 'var(--ok)' : 'transparent',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        cursor: 'pointer',
      }}
    >
      {viewed && <Check size={9} color="var(--bg-1)" strokeWidth={3} />}
    </span>
  );
}

function KindGlyph({ kind }: { kind: DiffFileKind }): JSX.Element {
  const map: Record<DiffFileKind, { c: string; l: string }> = {
    modified: { c: 'var(--info)', l: 'M' },
    added: { c: 'var(--ok)', l: 'A' },
    deleted: { c: 'var(--err)', l: 'D' },
    renamed: { c: 'var(--violet)', l: 'R' },
  };
  const m = map[kind];
  return (
    <span
      style={{
        width: 14,
        height: 14,
        borderRadius: 3,
        background: 'transparent',
        border: `1px solid ${m.c}`,
        color: m.c,
        fontSize: 9,
        fontWeight: 700,
        fontFamily: 'var(--font-mono)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {m.l}
    </span>
  );
}

function ChangeBar({
  adds,
  dels,
}: {
  adds: number;
  dels: number;
}): JSX.Element {
  const total = adds + dels;
  const aw = total ? Math.max(2, Math.round((adds / total) * 24)) : 0;
  const dw = total ? Math.max(2, 24 - aw) : 0;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        className="mono num"
        style={{
          fontSize: 10.5,
          color: 'var(--ok)',
          minWidth: 26,
          textAlign: 'right',
        }}
      >
        +{adds}
      </span>
      <span
        className="mono num"
        style={{ fontSize: 10.5, color: 'var(--err)', minWidth: 26 }}
      >
        −{dels}
      </span>
      <span
        style={{
          display: 'inline-flex',
          height: 6,
          width: 28,
          borderRadius: 1,
          overflow: 'hidden',
          background: 'var(--bg-3)',
        }}
      >
        {adds > 0 && (
          <span style={{ width: aw, background: 'var(--ok)' }} />
        )}
        {dels > 0 && (
          <span style={{ width: dw, background: 'var(--err)' }} />
        )}
      </span>
    </span>
  );
}

// ─── Sticky "now viewing" bar ───────────────────────────────────────

function StickyFileBar({
  file,
  idx,
  total,
  onPrev,
  onNext,
}: {
  file: DiffFile;
  idx: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}): JSX.Element {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 4,
        padding: '8px 12px',
        background: 'var(--bg-2)',
        borderBottom: '1px solid var(--line-2)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <KindGlyph kind={file.kind} />
      <span
        className="mono"
        style={{
          fontSize: 11.5,
          color: 'var(--fg-0)',
          fontWeight: 500,
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={file.path}
      >
        {file.path}
      </span>
      {!file.binary && !file.truncated && (file.adds > 0 || file.dels > 0) && (
        <ChangeBar adds={file.adds} dels={file.dels} />
      )}
      <span
        className="mono"
        style={{ fontSize: 10.5, color: 'var(--fg-3)' }}
      >
        {Math.min(idx + 1, total)}/{total}
      </span>
      <span style={{ display: 'inline-flex', gap: 2 }}>
        <button
          onClick={onPrev}
          title="Previous file"
          disabled={idx <= 0}
          style={iconBtn(idx <= 0)}
        >
          ‹
        </button>
        <button
          onClick={onNext}
          title="Next file"
          disabled={idx >= total - 1}
          style={iconBtn(idx >= total - 1)}
        >
          ›
        </button>
      </span>
    </div>
  );
}

function iconBtn(disabled: boolean): CSSProperties {
  return {
    width: 22,
    height: 20,
    borderRadius: 3,
    border: 'none',
    background: 'transparent',
    color: disabled ? 'var(--fg-4)' : 'var(--fg-2)',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: 14,
    lineHeight: 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}

// ─── File card (header + body) ──────────────────────────────────────

function FileCard({
  file,
  prUrl,
  inlineComments,
  viewed,
  onToggleViewed,
}: {
  file: DiffFile;
  prUrl: string;
  inlineComments: Map<string, TimelineEvent[]>;
  viewed: boolean;
  onToggleViewed: () => void;
}): JSX.Element {
  return (
    <article
      id={`f-${cssIdSafe(file.path)}`}
      data-file-anchor={`f-${cssIdSafe(file.path)}`}
      data-file-path={file.path}
      style={{
        borderTop: '1px solid var(--line-2)',
        background: 'var(--bg-1)',
        opacity: viewed ? 0.7 : 1,
        scrollMarginTop: 36,
      }}
    >
      <header
        style={{
          padding: '10px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'var(--bg-1)',
          borderBottom: '1px solid var(--line-1)',
        }}
      >
        <KindGlyph kind={file.kind} />
        <span
          className="mono"
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--fg-0)',
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={file.fromPath ? `${file.fromPath} → ${file.path}` : file.path}
        >
          {file.kind === 'renamed' && file.fromPath && (
            <>
              <span style={{ color: 'var(--fg-3)' }}>{file.fromPath}</span>
              <span style={{ color: 'var(--fg-4)' }}> → </span>
            </>
          )}
          {file.path}
        </span>
        {!file.binary && !file.truncated && (file.adds > 0 || file.dels > 0) && (
          <ChangeBar adds={file.adds} dels={file.dels} />
        )}
        <ViewedCheckbox
          viewed={viewed}
          onClick={(e) => {
            e.stopPropagation();
            onToggleViewed();
          }}
        />
      </header>
      <FileBody file={file} prUrl={prUrl} inlineComments={inlineComments} />
    </article>
  );
}

function FileBody({
  file,
  prUrl,
  inlineComments,
}: {
  file: DiffFile;
  prUrl: string;
  inlineComments: Map<string, TimelineEvent[]>;
}): JSX.Element {
  if (file.binary) {
    return (
      <div
        style={{
          padding: '24px 14px',
          textAlign: 'center',
          color: 'var(--fg-2)',
          fontSize: 12,
        }}
      >
        <div
          style={{
            margin: '0 auto 12px auto',
            width: 80,
            height: 60,
            border: '1px dashed var(--line-3)',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--fg-3)',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
          }}
        >
          BIN
        </div>
        Binary file · diff not rendered
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--fg-3)' }}>
          <a
            href={`${prUrl}/files`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--info)', textDecoration: 'none' }}
          >
            View on GitHub <ExternalLink size={10} style={{ verticalAlign: -1 }} />
          </a>
        </div>
      </div>
    );
  }
  if (file.kind === 'renamed' && file.hunks.length === 0) {
    return (
      <div
        style={{
          padding: '14px 14px',
          textAlign: 'center',
          color: 'var(--fg-2)',
          fontSize: 12,
        }}
      >
        <span style={{ color: 'var(--violet)', fontWeight: 600 }}>Renamed</span>{' '}
        with no content change
      </div>
    );
  }
  if (file.truncated) {
    return (
      <div
        style={{
          padding: '20px 14px',
          textAlign: 'center',
          color: 'var(--warn)',
          fontSize: 12,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          Patch withheld by GitHub
        </div>
        <div style={{ color: 'var(--fg-2)', fontSize: 11.5 }}>
          {file.adds.toLocaleString()} additions, {file.dels.toLocaleString()}{' '}
          deletions.
          <a
            href={`${prUrl}/files`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'var(--info)',
              marginLeft: 6,
              textDecoration: 'none',
            }}
          >
            View on GitHub <ExternalLink size={10} style={{ verticalAlign: -1 }} />
          </a>
        </div>
      </div>
    );
  }
  if (file.hunks.length === 0) {
    return (
      <div
        style={{
          padding: '14px 14px',
          textAlign: 'center',
          color: 'var(--fg-3)',
          fontSize: 12,
        }}
      >
        Empty patch.
      </div>
    );
  }
  // The hunks container scrolls horizontally as a unit, so when a
  // single line is wider than the drawer all rows in this file slide
  // together and the line-number gutter stays aligned with the code.
  return (
    <div style={{ overflowX: 'auto' }}>
      {file.hunks.map((h, i) => (
        <Hunk
          key={`${file.path}-${i}`}
          hunk={h}
          path={file.path}
          inlineComments={inlineComments}
        />
      ))}
    </div>
  );
}

// ─── Hunk + diff lines ──────────────────────────────────────────────

function Hunk({
  hunk,
  path,
  inlineComments,
}: {
  hunk: DiffHunk;
  path: string;
  inlineComments: Map<string, TimelineEvent[]>;
}): JSX.Element {
  return (
    <div>
      <div
        style={{
          padding: '4px 12px 4px 96px',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--fg-3)',
          background: 'var(--bg-2)',
          borderTop: '1px solid var(--line-1)',
          borderBottom: '1px solid var(--line-1)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={hunk.header}
      >
        {hunk.header}
      </div>
      {hunk.rows.map((row, i) => {
        // Comments are anchored per-side: a comment on a deletion
        // (old-side line 30) and a comment on the matching addition
        // (new-side line 30) are distinct threads even though they
        // share a numeric line. Add rows are new-side, del rows are
        // old-side, and context rows match new-side too (the GitHub
        // UX is that "comment on a context line" anchors right).
        let key: string | null = null;
        if (row.kind === 'add' && row.rn != null) {
          key = `${path}::new:${row.rn}`;
        } else if (row.kind === 'del' && row.ln != null) {
          key = `${path}::old:${row.ln}`;
        } else if (row.kind === 'ctx' && row.rn != null) {
          key = `${path}::new:${row.rn}`;
        }
        const thread = key ? inlineComments.get(key) : undefined;
        return (
          <div key={i}>
            <DiffLineEl row={row} />
            {thread && thread.length > 0 && <InlineThread events={thread} />}
          </div>
        );
      })}
    </div>
  );
}

function DiffLineEl({ row }: { row: DiffRow }): JSX.Element {
  const isAdd = row.kind === 'add';
  const isDel = row.kind === 'del';
  const bg = isAdd
    ? 'rgba(78,201,168,0.07)'
    : isDel
      ? 'rgba(236,106,94,0.06)'
      : 'transparent';
  const gutterBg = isAdd
    ? 'rgba(78,201,168,0.10)'
    : isDel
      ? 'rgba(236,106,94,0.08)'
      : 'var(--bg-1)';
  const sign = isAdd ? '+' : isDel ? '−' : ' ';
  const signColor = isAdd
    ? 'var(--ok)'
    : isDel
      ? 'var(--err)'
      : 'var(--fg-4)';
  return (
    <div
      style={{
        // `auto` (not `1fr`) on the text column + `min-width: 100%`
        // on the row so short lines still fill the row background,
        // long lines push past the container width and trigger
        // horizontal scroll on the parent.
        display: 'grid',
        gridTemplateColumns: '40px 40px 16px auto',
        minWidth: '100%',
        width: 'max-content',
        fontFamily: 'var(--font-mono)',
        fontSize: 11.5,
        lineHeight: '18px',
        background: bg,
      }}
    >
      <span style={lineNumStyle(gutterBg)}>{row.ln ?? ''}</span>
      <span style={lineNumStyle(gutterBg)}>{row.rn ?? ''}</span>
      <span
        style={{
          textAlign: 'center',
          color: signColor,
          userSelect: 'none',
          fontWeight: 600,
        }}
      >
        {sign}
      </span>
      <span
        style={{
          paddingLeft: 8,
          paddingRight: 14,
          color: 'var(--fg-0)',
          whiteSpace: 'pre',
        }}
      >
        {row.text || ' '}
      </span>
    </div>
  );
}

function lineNumStyle(bg: string): CSSProperties {
  return {
    textAlign: 'right',
    paddingRight: 8,
    color: 'var(--fg-3)',
    fontVariantNumeric: 'tabular-nums',
    userSelect: 'none',
    borderRight: '1px solid var(--line-1)',
    background: bg,
  };
}

// ─── Inline comment thread (read-only) ──────────────────────────────

function InlineThread({
  events,
}: {
  events: TimelineEvent[];
}): JSX.Element {
  return (
    <div
      style={{
        margin: '4px 12px 8px 96px',
        border: '1px solid var(--line-2)',
        borderRadius: 6,
        background: 'var(--bg-2)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {events.map((entry, i) => (
        <div
          key={entry.id}
          style={{
            padding: '10px 12px',
            borderBottom:
              i < events.length - 1 ? '1px solid var(--line-1)' : 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Avatar user={entry.author} size={18} />
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--fg-0)',
              }}
            >
              @{entry.author.login}
            </span>
            <span style={{ flex: 1 }} />
            <span
              className="mono"
              style={{ fontSize: 10.5, color: 'var(--fg-3)' }}
            >
              {formatDistanceToNowStrict(new Date(entry.at), {
                addSuffix: true,
              })}
            </span>
          </div>
          {entry.body && (
            <div
              style={{
                marginTop: 6,
                fontSize: 12.5,
                color: 'var(--fg-1)',
                lineHeight: 1.5,
              }}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {entry.body}
              </ReactMarkdown>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Footer + tiny status states ────────────────────────────────────

function DiffFooter({
  shownCount,
  fetchedCount,
  totalChanged,
  hiddenGenerated,
  onShowGenerated,
  prUrl,
}: {
  shownCount: number;
  fetchedCount: number;
  totalChanged: number;
  hiddenGenerated: number;
  onShowGenerated: () => void;
  prUrl: string;
}): JSX.Element {
  const truncatedFetch = totalChanged > fetchedCount;
  return (
    <div
      style={{
        padding: '20px 14px',
        textAlign: 'center',
        color: 'var(--fg-3)',
        fontSize: 11,
        background: 'var(--bg-0)',
      }}
    >
      End of diff · <span className="mono">{shownCount}</span> file
      {shownCount !== 1 ? 's' : ''}
      {hiddenGenerated > 0 && (
        <>
          {' '}
          ·{' '}
          <a
            onClick={onShowGenerated}
            style={{
              color: 'var(--info)',
              cursor: 'pointer',
              textDecoration: 'none',
            }}
          >
            Show {hiddenGenerated} generated
          </a>
        </>
      )}
      {truncatedFetch && (
        <>
          {' '}
          · Showing first {fetchedCount} of {totalChanged} changed files —{' '}
          <a
            href={`${prUrl}/files`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--info)', textDecoration: 'none' }}
          >
            view full set on GitHub
          </a>
        </>
      )}
    </div>
  );
}

function DiffStatus({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'err';
}): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-0)',
        color: tone === 'err' ? 'var(--err)' : 'var(--fg-2)',
        fontSize: 12,
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div>{children}</div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function groupInlineComments(
  timeline: TimelineEvent[]
): Map<string, TimelineEvent[]> {
  const out = new Map<string, TimelineEvent[]>();
  for (const e of timeline) {
    if (e.kind !== 'inline-comment') continue;
    if (!e.path || e.line == null) continue;
    // Default to the new side when transform didn't carry an explicit
    // side — matches GitHub's own default for review comments.
    const side: 'old' | 'new' = e.side === 'old' ? 'old' : 'new';
    const key = `${e.path}::${side}:${e.line}`;
    const list = out.get(key);
    if (list) list.push(e);
    else out.set(key, [e]);
  }
  // Sort each thread by time so the original comment shows first.
  for (const list of out.values()) {
    list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }
  return out;
}

function countCommentsForPath(
  inlineComments: Map<string, TimelineEvent[]>,
  path: string
): number {
  let n = 0;
  const prefix = `${path}::`;
  for (const [k, list] of inlineComments) {
    if (k.startsWith(prefix)) n += list.length;
  }
  return n;
}

function cssIdSafe(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_');
}
