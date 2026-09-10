import { usePRConversation } from '../hooks/usePRConversation';
import { ErrorBanner } from './ErrorBanner';
import { useEffect, useRef, useState } from 'react';
import {
  X,
  ExternalLink,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  RotateCw,
  Send,
  PenLine,
  Maximize2,
  Minimize2,
  PanelLeft,
  MessageSquare,
  GitMerge,
} from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { DashboardPR, TimelineEvent } from '../types/dashboard';
import {
  Avatar,
  DraftChip,
  LabelPill,
  TONE_STYLE,
} from './primitives';
import { DiffTab, prefersReducedMotion } from './DiffTab';
import { CommitsTab } from './CommitsTab';
import { useSubmitReview } from '../hooks/useSubmitReview';
import { useRerunPipeline } from '../hooks/useRerunPipeline';
import { useSetDraftState } from '../hooks/useSetDraftState';
import { useMergePullRequest } from '../hooks/useMergePullRequest';
import { isEditableTarget } from '../hooks/useKeyboardNav';
import { isReadyToMerge } from '../lib/bucketing';
import { jiraTicketUrl } from '../lib/jira';
import { reviewActionEnabled, type ReviewEvent } from '../lib/reviewActions';
import { DIFF_FONT_MAX, DIFF_FONT_MIN, redactToken } from '../lib/storage';
import { useUIStore } from '../store';

interface Props {
  pr: DashboardPR;
  onClose: () => void;
  /** 0-based index of this PR in the nav list, or -1 if not present. */
  navIndex: number;
  /** Total PRs in the nav list (deduped, collapsed buckets excluded). */
  navTotal: number;
  /** Previous PR id, or null at the start of the list. */
  prevId: string | null;
  /** Next PR id, or null at the end of the list. */
  nextId: string | null;
  /** Switch the modal to a different PR without closing. */
  onNavigate: (id: string) => void;
}

type DrawerTab = 'timeline' | 'commits' | 'diff';
const DRAWER_TABS: DrawerTab[] = ['timeline', 'commits', 'diff'];

// Centered modal layout (experimenting). Sized generously for Diff
// readability — since the modal floats over the bucket list with a
// dim backdrop, we don't need to leave horizontal room behind it.
// Caps at 1100px wide / 92vh tall, scales down to 92vw / 92vh on
// smaller monitors. Maximized, it drops the px cap entirely and fills
// the viewport bar a 2vw/2vh gutter — a px ceiling would just re-impose
// the squeeze on the 4K displays this mode exists for. Long code lines
// already scroll horizontally per-file, so extra width is pure gain.
const MODAL_WIDTH = 'min(1100px, 92vw)';
const MODAL_HEIGHT = 'min(900px, 92vh)';
const MODAL_WIDTH_MAX = '96vw';
const MODAL_HEIGHT_MAX = '96vh';

export function PRDetail({
  pr: summary,
  onClose,
  navIndex,
  navTotal,
  prevId,
  nextId,
  onNavigate,
}: Props) {
  const token = useUIStore((s) => s.token);
  const conversation = usePRConversation(summary.id, summary.updatedAt);
  const pr = { ...summary, timeline: conversation.data ?? [] };
  const [activeTab, setActiveTab] = useState<DrawerTab>('timeline');
  // Deliberately unpersisted: chrome you popped open for one PR
  // shouldn't still be open on the next one.
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [armedVerdict, setArmedVerdict] = useState<ReviewEvent | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  // j/k navigation swaps `pr` in place rather than remounting, so the
  // collapsible chrome has to be reset by hand — otherwise you land on
  // the next PR with someone else's Approve still armed.
  useEffect(() => {
    setDetailsExpanded(false);
    setReviewOpen(false);
    setArmedVerdict(null);
  }, [pr.id]);

  const maximized = useUIStore((s) => s.diffMaximized);
  const toggleMaximized = useUIStore((s) => s.toggleDiffMaximized);
  const railOpen = useUIStore((s) => s.diffRailOpen);
  const toggleRail = useUIStore((s) => s.toggleDiffRail);
  const fontSize = useUIStore((s) => s.diffFontSize);
  const adjustFontSize = useUIStore((s) => s.adjustDiffFontSize);

  const isDiff = activeTab === 'diff';
  const isCommits = activeTab === 'commits';
  const isReading = isDiff || isCommits;
  // Reading tabs collapse the composer behind "Review ▾"; Timeline
  // keeps it open, as it always has.
  const composerOpen = !isReading || reviewOpen;

  const mergeableTone =
    pr.mergeable === 'MERGEABLE'
      ? 'ok'
      : pr.mergeable === 'CONFLICTING'
        ? 'err'
        : 'warn';

  // Open + focus the composer with a verdict pre-selected. Deliberately
  // does *not* submit: an approval is public and notifies people, so a
  // bare keystroke arms the button rather than pressing it.
  function armReview(event: ReviewEvent): void {
    if (pr.isMerged) return;
    // Mirror reviewActionEnabled's authorship rule — no point arming a
    // verdict GitHub would reject.
    if (pr.viewerIsAuthor && event !== 'COMMENT') return;
    setReviewOpen(true);
    setArmedVerdict(event);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      // Maximize carries a modifier so it can fire even mid-sentence in
      // the composer, and so it never collides with the global handler
      // (which bails on meta/ctrl).
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        toggleMaximized();
        e.preventDefault();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;

      if (isDiff) {
        switch (e.key) {
          case '[':
            toggleRail();
            e.preventDefault();
            return;
          case '+':
          case '=':
            adjustFontSize(1);
            e.preventDefault();
            return;
          case '-':
            adjustFontSize(-1);
            e.preventDefault();
            return;
          default:
            break;
        }
      }

      switch (e.key) {
        case 'a':
          armReview('APPROVE');
          e.preventDefault();
          break;
        // Shift+R, not `r` — plain `r` is the global manual refresh.
        case 'R':
          armReview('REQUEST_CHANGES');
          e.preventDefault();
          break;
        case 'c':
          armReview('COMMENT');
          e.preventDefault();
          break;
        default:
          break;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const reduceMotion = prefersReducedMotion();

  return (
    <div
      // Backdrop. Click anywhere outside the panel to dismiss; Esc
      // is still wired through useKeyboardNav.
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(0, 0, 0, 0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // A 24px gutter would overflow a 96vh panel; when maximized the
        // panel's own vh sizing provides the breathing room.
        padding: maximized ? 0 : 24,
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Pull request ${pr.repoNameWithOwner} #${pr.number}`}
        // Stop clicks inside the panel from bubbling to the backdrop
        // and triggering close.
        onClick={(e) => e.stopPropagation()}
        style={{
          width: maximized ? MODAL_WIDTH_MAX : MODAL_WIDTH,
          height: maximized ? MODAL_HEIGHT_MAX : MODAL_HEIGHT,
          background: 'var(--bg-1)',
          border: '1px solid var(--line-2)',
          borderRadius: 10,
          boxShadow: '0 32px 80px rgba(0, 0, 0, 0.45)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transition: reduceMotion
            ? undefined
            : 'width 120ms ease, height 120ms ease',
        }}
      >
      <div
        style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--line-1)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span className="mono" style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
          {pr.repoNameWithOwner}
        </span>
        <span style={{ color: 'var(--fg-4)' }}>·</span>
        <span className="mono" style={{ fontSize: 11.5, color: 'var(--fg-2)' }}>
          #{pr.number}
        </span>
        <span style={{ flex: 1 }} />
        {navTotal > 1 && (
          <NavControls
            navIndex={navIndex}
            navTotal={navTotal}
            prevId={prevId}
            nextId={nextId}
            onNavigate={onNavigate}
          />
        )}
        {/* Diff view controls — only meaningful while reading code. */}
        {isDiff && (
          <>
            <FontStepper size={fontSize} onAdjust={adjustFontSize} />
            <IconToggle
              on={!railOpen}
              onClick={toggleRail}
              label={railOpen ? 'Hide file rail ([)' : 'Show file rail ([)'}
            >
              <PanelLeft size={13} />
            </IconToggle>
            <span
              aria-hidden
              style={{ width: 1, height: 18, background: 'var(--line-2)' }}
            />
          </>
        )}
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          title="Open on GitHub"
          style={{
            height: 24,
            padding: '0 8px',
            borderRadius: 4,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            color: 'var(--fg-2)',
            fontSize: 11,
            textDecoration: 'none',
          }}
        >
          <ExternalLink size={12} />
          Open
        </a>
        <button
          onClick={toggleMaximized}
          aria-label={maximized ? 'Restore size' : 'Maximize'}
          aria-pressed={maximized}
          title={maximized ? 'Restore (⇧⌘F)' : 'Maximize (⇧⌘F)'}
          style={headerIconBtnStyle}
        >
          {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
        <button
          onClick={onClose}
          aria-label="Close"
          title="Close (Esc)"
          style={headerIconBtnStyle}
        >
          <X size={14} />
        </button>
      </div>

      {/* Reading tabs collapse the ~200px info block to one line so the
          primary content keeps the modal's vertical space. */}
      {isReading && (
        <PRContextStrip
          pr={pr}
          expanded={detailsExpanded}
          onToggle={() => setDetailsExpanded((v) => !v)}
        />
      )}
      {(!isReading || detailsExpanded) && (
        <PRInfoBlock pr={pr} mergeableTone={mergeableTone} />
      )}

      <TabStrip
        activeTab={activeTab}
        onChange={setActiveTab}
        timelineCount={pr.timeline.length}
        commitCount={pr.commitCount}
        fileCount={pr.changedFiles}
      />

      {conversation.isLoading && <div role="status" style={{ padding: 12, color: 'var(--fg-2)' }}>Loading conversation…</div>}
      {conversation.error && <ErrorBanner tone="err" title="Couldn't load conversation" body={(conversation.error.message.split(token || '\0').join(token ? redactToken(token) : ''))} actionLabel="Retry" onAction={() => void conversation.refetch()} />}
      {activeTab === 'timeline' && (
        <div
          id="pr-panel-timeline"
          role="tabpanel"
          aria-labelledby="pr-tab-timeline"
          style={{
            padding: '14px 18px',
            overflow: 'auto',
            flex: 1,
          }}
          className="scroll-zone"
        >
          <SectionLabel>Timeline</SectionLabel>
          <Timeline events={pr.timeline} />

        <div style={{ height: 20 }} />

        <SectionLabel>Reviewers ({pr.reviewers.length})</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {pr.reviewers.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
              No reviewers yet.
            </div>
          )}
          {pr.reviewers.map((r, i) => {
            const { c, b } =
              r.state === 'changes'
                ? { c: 'var(--err)', b: 'requested changes' }
                : r.state === 'approved'
                  ? { c: 'var(--ok)', b: 'approved' }
                  : r.state === 'commented'
                    ? { c: 'var(--info)', b: 'commented' }
                    : r.state === 'requested'
                      ? { c: 'var(--fg-3)', b: 'review requested' }
                      : { c: 'var(--fg-3)', b: 'pending' };
            return (
              <div
                key={`${r.login}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '6px 10px',
                  borderRadius: 5,
                  background: 'var(--bg-2)',
                }}
              >
                <Avatar user={r} size={18} />
                <span
                  style={{ fontSize: 12, color: 'var(--fg-0)', fontWeight: 500 }}
                >
                  @{r.login}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: c }}>{b}</span>
                <span
                  className="mono"
                  style={{
                    fontSize: 10.5,
                    color: 'var(--fg-3)',
                    minWidth: 60,
                    textAlign: 'right',
                  }}
                >
                  {r.submittedAt
                    ? formatDistanceToNowStrict(new Date(r.submittedAt)) + ' ago'
                    : '—'}
                </span>
              </div>
            );
          })}
        </div>

        </div>
      )}
      {activeTab === 'commits' && (
        <div
          id="pr-panel-commits"
          role="tabpanel"
          aria-labelledby="pr-tab-commits"
          style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
        >
          <CommitsTab pr={pr} active />
        </div>
      )}
      {activeTab === 'diff' && (
        <div
          id="pr-panel-diff"
          role="tabpanel"
          aria-labelledby="pr-tab-diff"
          style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
        >
          <DiffTab pr={pr} active />
        </div>
      )}

      <div
        style={{
          padding: isReading ? '8px 16px' : 10,
          borderTop: '1px solid var(--line-1)',
          background: 'var(--bg-2)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {composerOpen && (
          <ReviewComposer
            key={pr.id}
            pr={pr}
            armed={armedVerdict}
            onArm={setArmedVerdict}
            textareaRef={composerRef}
          />
        )}
        {isReading ? (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {!pr.isMerged && (
              <button
                onClick={() => {
                  setReviewOpen((v) => !v);
                  if (!reviewOpen) {
                    requestAnimationFrame(() => composerRef.current?.focus());
                  }
                }}
                aria-expanded={reviewOpen}
                style={{
                  height: 30,
                  padding: '0 12px',
                  borderRadius: 6,
                  border: '1px solid var(--line-2)',
                  background: 'var(--bg-1)',
                  color: 'var(--fg-1)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 500,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                }}
              >
                <MessageSquare size={12} aria-hidden />
                Review
                {reviewOpen ? (
                  <ChevronDown size={11} aria-hidden />
                ) : (
                  <ChevronUp size={11} aria-hidden />
                )}
              </button>
            )}
            {!pr.isMerged && <ReviewHint viewerIsAuthor={pr.viewerIsAuthor} />}
            <span style={{ flex: 1 }} />
            <OpenOnGitHub url={pr.url} />
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <OpenOnGitHub url={pr.url} />
            <RerunButton key={pr.id} pr={pr} />
            <DraftToggleButton key={`draft-${pr.id}`} pr={pr} />
            <span style={{ flex: 1 }} />
            <button
              onClick={onClose}
              style={{
                height: 30,
                padding: '0 10px',
                borderRadius: 6,
                border: '1px solid var(--line-2)',
                background: 'var(--bg-1)',
                color: 'var(--fg-1)',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Close
            </button>
          </div>
        )}
      </div>
      </aside>
    </div>
  );
}

function OpenOnGitHub({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        height: 30,
        padding: '0 12px',
        borderRadius: 6,
        background: 'var(--accent)',
        color: 'var(--accent-fg)',
        fontSize: 12,
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        textDecoration: 'none',
        flexShrink: 0,
      }}
    >
      <ExternalLink size={12} />
      Open on GitHub
    </a>
  );
}

/** Slim-footer keyboard hint. Approve / request-changes are dead keys on
 *  your own PR, so the hint shrinks to what actually works. */
function ReviewHint({ viewerIsAuthor }: { viewerIsAuthor: boolean }) {
  const keyStyle: React.CSSProperties = {
    color: 'var(--fg-1)',
    fontFamily: 'var(--font-mono)',
  };
  return (
    <span
      style={{
        fontSize: 11,
        color: 'var(--fg-3)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      Press{' '}
      {!viewerIsAuthor && (
        <>
          <span style={keyStyle}>a</span> approve ·{' '}
          <span style={keyStyle}>⇧R</span> request changes ·{' '}
        </>
      )}
      <span style={keyStyle}>c</span> comment
    </span>
  );
}

const headerIconBtnStyle: React.CSSProperties = {
  height: 24,
  width: 24,
  borderRadius: 4,
  border: 'none',
  background: 'transparent',
  color: 'var(--fg-2)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

/** The full ~200px PR summary. Always on Timeline; opt-in on reading tabs. */
function PRInfoBlock({
  pr,
  mergeableTone,
}: {
  pr: DashboardPR;
  mergeableTone: keyof typeof TONE_STYLE;
}) {
  return (
    <div
      style={{
        padding: '16px 18px 14px 18px',
        borderBottom: '1px solid var(--line-1)',
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: 16,
          fontWeight: 600,
          letterSpacing: '-0.015em',
          color: 'var(--fg-0)',
          lineHeight: 1.35,
        }}
      >
        {pr.title}
      </h2>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginTop: 10,
          flexWrap: 'wrap',
        }}
      >
        <Avatar user={pr.author} size={18} />
        <span style={{ fontSize: 12, color: 'var(--fg-1)' }}>
          <span style={{ fontWeight: 500 }}>@{pr.author.login}</span>
          <span style={{ color: 'var(--fg-3)' }}> opened </span>
          <span className="mono" style={{ color: 'var(--fg-1)' }}>
            {formatDistanceToNowStrict(new Date(pr.createdAt), { addSuffix: true })}
          </span>
        </span>
        {pr.isDraft && <DraftChip />}
      </div>

      <BranchLine head={pr.headRefName} base={pr.baseRefName} />

      <PRUrlLine url={pr.url} jiraTicketKey={pr.jiraTicketKey} />

      {pr.labels.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {pr.labels.map((l, i) => (
            <LabelPill key={`${l.name}-${i}`} label={l} />
          ))}
        </div>
      )}

      <div
        style={{
          marginTop: 14,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 8,
        }}
      >
        <StatusCard
          label="Approval"
          tone={approvalTone(pr)}
          value={approvalValue(pr)}
          sub={
            pr.reviewers[0]
              ? `latest: @${pr.reviewers[0].login}`
              : 'no reviews yet'
          }
        />
        <StatusCard label="CI" tone={ciTone(pr)} value={ciValue(pr)} sub="" />
        <StatusCard
          label="Mergeable"
          tone={mergeableTone}
          value={mergeableValue(pr)}
          sub=""
        />
      </div>

      {/* File stats strip — matches design's slim mono row. */}
      <div
        style={{
          marginTop: 12,
          display: 'flex',
          gap: 16,
          alignItems: 'center',
          fontSize: 11.5,
          color: 'var(--fg-2)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        <span>
          {pr.changedFiles} {pr.changedFiles === 1 ? 'file' : 'files'}
        </span>
        <span style={{ color: 'var(--ok)' }}>+{pr.additions}</span>
        <span style={{ color: 'var(--err)' }}>−{pr.deletions}</span>
        <span style={{ flex: 1 }} />
        <span>
          {pr.commitCount} {pr.commitCount === 1 ? 'commit' : 'commits'}
        </span>
        <span>
          {pr.reviewers.length}{' '}
          {pr.reviewers.length === 1 ? 'reviewer' : 'reviewers'}
        </span>
      </div>
    </div>
  );
}

// Status derivations shared by the full info block's cards and the
// context strip's dots, so the two can never disagree.
function approvalTone(pr: DashboardPR): keyof typeof TONE_STYLE {
  return pr.approvalState === 'approved'
    ? 'ok'
    : pr.approvalState === 'changes'
      ? 'err'
      : 'warn';
}

function approvalValue(pr: DashboardPR): string {
  if (pr.approvalState === 'changes') return 'Changes requested';
  const denom = Math.max(pr.reviewerCount, pr.approvalCount);
  if (pr.approvalState === 'approved') {
    return `${pr.approvalCount}/${denom} approved`;
  }
  return `${pr.approvalCount}/${denom || '—'} approvals`;
}

/** Terse enough for the one-line strip. */
function approvalShort(pr: DashboardPR): string {
  if (pr.approvalState === 'changes') return 'Changes';
  const denom = Math.max(pr.reviewerCount, pr.approvalCount);
  if (pr.approvalState === 'approved') return 'Approved';
  return `${pr.approvalCount}/${denom || '—'}`;
}

function ciTone(pr: DashboardPR): keyof typeof TONE_STYLE {
  return pr.ciStatus === 'success'
    ? 'ok'
    : pr.ciStatus === 'failure'
      ? 'err'
      : pr.ciStatus === 'pending'
        ? 'warn'
        : 'neutral';
}

function ciValue(pr: DashboardPR): string {
  return pr.ciStatus === 'success'
    ? 'Passing'
    : pr.ciStatus === 'failure'
      ? 'Failing'
      : pr.ciStatus === 'pending'
        ? 'Running'
        : 'No checks';
}

function mergeableValue(pr: DashboardPR): string {
  return pr.mergeable === 'MERGEABLE'
    ? 'Clean'
    : pr.mergeable === 'CONFLICTING'
      ? 'Conflicts'
      : 'Unknown';
}

/** One-line replacement for the info block while a reading tab is up. */
function PRContextStrip({
  pr,
  expanded,
  onToggle,
}: {
  pr: DashboardPR;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      style={{
        padding: '9px 16px',
        borderBottom: '1px solid var(--line-1)',
        background: 'var(--bg-1)',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        minWidth: 0,
      }}
    >
      <Avatar user={pr.author} size={18} />
      <span
        title={pr.title}
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--fg-0)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 0,
          maxWidth: 340,
        }}
      >
        {pr.title}
      </span>
      <span
        className="mono"
        style={{ fontSize: 11, color: 'var(--fg-3)', flexShrink: 0 }}
      >
        {pr.headRefName} → {pr.baseRefName}
      </span>
      <span style={{ flexShrink: 0, display: 'inline-flex', gap: 12 }}>
        <span className="mono" style={{ fontSize: 11.5, color: 'var(--ok)' }}>
          +{pr.additions}
        </span>
        <span className="mono" style={{ fontSize: 11.5, color: 'var(--err)' }}>
          −{pr.deletions}
        </span>
      </span>
      <span
        aria-hidden
        style={{
          width: 1,
          height: 16,
          background: 'var(--line-2)',
          flexShrink: 0,
        }}
      />
      <span style={{ display: 'inline-flex', gap: 14, flexShrink: 0 }}>
        <StatusDot tone={approvalTone(pr)} label={approvalShort(pr)} />
        <StatusDot tone={ciTone(pr)} label={ciValue(pr)} />
        <StatusDot
          tone={
            pr.mergeable === 'MERGEABLE'
              ? 'ok'
              : pr.mergeable === 'CONFLICTING'
                ? 'err'
                : 'warn'
          }
          label={mergeableValue(pr)}
        />
      </span>
      <span style={{ flex: 1 }} />
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        title={expanded ? 'Hide full PR details' : 'Show full PR details'}
        style={{
          height: 24,
          padding: '0 8px',
          borderRadius: 5,
          border: '1px solid var(--line-2)',
          background: 'var(--bg-2)',
          color: 'var(--fg-2)',
          cursor: 'pointer',
          fontSize: 11,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          flexShrink: 0,
        }}
      >
        Details
        {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      </button>
    </div>
  );
}

function StatusDot({
  tone,
  label,
}: {
  tone: keyof typeof TONE_STYLE;
  label: string;
}) {
  const t = TONE_STYLE[tone];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: t.c,
          boxShadow: `0 0 0 3px ${t.b}`,
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 11.5, color: t.c, fontWeight: 500 }}>
        {label}
      </span>
    </span>
  );
}

/** `A− 13 A+` segmented control for the diff type size. */
function FontStepper({
  size,
  onAdjust,
}: {
  size: number;
  onAdjust: (delta: number) => void;
}) {
  const atMin = size <= DIFF_FONT_MIN;
  const atMax = size >= DIFF_FONT_MAX;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 24,
        borderRadius: 5,
        border: '1px solid var(--line-2)',
        background: 'var(--bg-2)',
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => onAdjust(-1)}
        disabled={atMin}
        title="Smaller diff type (−)"
        aria-label="Decrease diff font size"
        style={stepBtnStyle(atMin)}
      >
        A<span style={{ fontSize: 8 }}>−</span>
      </button>
      <span
        className="mono num"
        aria-live="polite"
        style={{
          fontSize: 10.5,
          color: 'var(--fg-2)',
          padding: '0 6px',
          borderLeft: '1px solid var(--line-1)',
          borderRight: '1px solid var(--line-1)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {size}
      </span>
      <button
        onClick={() => onAdjust(1)}
        disabled={atMax}
        title="Bigger diff type (+)"
        aria-label="Increase diff font size"
        style={stepBtnStyle(atMax)}
      >
        A<span style={{ fontSize: 11 }}>+</span>
      </button>
    </span>
  );
}

function stepBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    height: 22,
    padding: '0 7px',
    border: 'none',
    background: 'transparent',
    color: 'var(--fg-1)',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    fontSize: 11,
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'baseline',
    gap: 1,
    fontFamily: 'var(--font-sans)',
  };
}

function IconToggle({
  on,
  onClick,
  label,
  children,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={on}
      style={{
        height: 24,
        width: 26,
        borderRadius: 5,
        border: `1px solid ${on ? 'var(--accent)' : 'var(--line-2)'}`,
        background: on ? 'var(--accent)' : 'var(--bg-2)',
        color: on ? 'var(--accent-fg)' : 'var(--fg-2)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </button>
  );
}

function BranchLine({ head, base }: { head: string; base: string }) {
  return (
    <div
      style={{
        marginTop: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11.5,
        color: 'var(--fg-3)',
        fontFamily: 'var(--font-mono)',
        minWidth: 0,
      }}
    >
      <CopyableBranch name={head} />
      <span aria-hidden style={{ color: 'var(--fg-4)' }}>
        →
      </span>
      <span
        style={{
          color: 'var(--fg-2)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {base}
      </span>
    </div>
  );
}

function PRUrlLine({
  url,
  jiraTicketKey,
}: {
  url: string;
  jiraTicketKey: string | null;
}) {
  const [copied, setCopied] = useState<'github' | 'jira' | null>(null);
  const jiraUrl = jiraTicketKey ? jiraTicketUrl(jiraTicketKey) : null;

  async function copy(value: string, target: 'github' | 'jira') {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(target);
      window.setTimeout(
        () => setCopied((current) => (current === target ? null : current)),
        1200
      );
    } catch {
      /* ignore — clipboard may be blocked in some contexts */
    }
  }

  return (
    <div
      style={{
        marginTop: 4,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
        fontSize: 11.5,
        fontFamily: 'var(--font-mono)',
        minWidth: 0,
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          minWidth: 0,
        }}
      >
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title={url}
          style={{
            color: 'var(--accent)',
            textDecoration: 'none',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
        >
          {url.replace(/^https?:\/\//, '')}
        </a>
        <LinkCopyButton
          copied={copied === 'github'}
          label="PR URL"
          onClick={() => void copy(url, 'github')}
        />
      </span>

      {jiraTicketKey && jiraUrl && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            flexShrink: 0,
          }}
        >
          <span aria-hidden="true" style={{ color: 'var(--fg-3)' }}>
            ·
          </span>
          <a
            href={jiraUrl}
            target="_blank"
            rel="noreferrer"
            title={jiraUrl}
            style={{
              color: 'var(--accent)',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            Jira: {jiraTicketKey}
            <ExternalLink size={10} aria-hidden="true" />
          </a>
          <LinkCopyButton
            copied={copied === 'jira'}
            label="Jira URL"
            onClick={() => void copy(jiraUrl, 'jira')}
          />
        </span>
      )}
    </div>
  );
}

function LinkCopyButton({
  copied,
  label,
  onClick,
}: {
  copied: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={copied ? 'Copied' : `Copy ${label}`}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      style={{
        width: 20,
        height: 20,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        borderRadius: 4,
        background: 'transparent',
        color: copied ? 'var(--ok)' : 'var(--fg-3)',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}

function CopyableBranch({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);
  const command = `git checkout ${name}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore — clipboard may be blocked in some contexts */
    }
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        minWidth: 0,
      }}
    >
      <span
        style={{
          color: 'var(--fg-1)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={name}
      >
        {name}
      </span>
      <button
        type="button"
        onClick={copy}
        title={copied ? 'Copied' : `Copy "${command}"`}
        aria-label={copied ? 'Copied' : `Copy ${command}`}
        style={{
          width: 20,
          height: 20,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 'none',
          borderRadius: 4,
          background: 'transparent',
          color: copied ? 'var(--ok)' : 'var(--fg-3)',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
    </span>
  );
}

function NavControls({
  navIndex,
  navTotal,
  prevId,
  nextId,
  onNavigate,
}: {
  navIndex: number;
  navTotal: number;
  prevId: string | null;
  nextId: string | null;
  onNavigate: (id: string) => void;
}) {
  // Counter is `index + 1 / total`. When the selected PR has fallen
  // out of the nav list (rare — e.g. the bucket it was in just got
  // collapsed, or filters changed), index is -1; show "—" instead of
  // a misleading 0.
  const label =
    navIndex >= 0
      ? `${navIndex + 1}/${navTotal}`
      : `—/${navTotal}`;
  const prevDisabled = !prevId;
  const nextDisabled = !nextId;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        marginRight: 4,
      }}
    >
      <button
        onClick={() => prevId && onNavigate(prevId)}
        disabled={prevDisabled}
        title="Previous PR (k or ←)"
        aria-label="Previous PR"
        style={navBtnStyle(prevDisabled)}
      >
        <ChevronLeft size={14} />
      </button>
      <span
        className="mono num"
        style={{
          fontSize: 11,
          color: 'var(--fg-3)',
          minWidth: 44,
          textAlign: 'center',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {label}
      </span>
      <button
        onClick={() => nextId && onNavigate(nextId)}
        disabled={nextDisabled}
        title="Next PR (j or →)"
        aria-label="Next PR"
        style={navBtnStyle(nextDisabled)}
      >
        <ChevronRight size={14} />
      </button>
    </span>
  );
}

function navBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    height: 24,
    width: 24,
    border: 'none',
    borderRadius: 4,
    background: 'transparent',
    color: disabled ? 'var(--fg-4)' : 'var(--fg-2)',
    cursor: disabled ? 'default' : 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}

function TabStrip({
  activeTab,
  onChange,
  timelineCount,
  commitCount,
  fileCount,
}: {
  activeTab: DrawerTab;
  onChange: (tab: DrawerTab) => void;
  timelineCount: number;
  commitCount: number;
  fileCount: number;
}) {
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    const current = DRAWER_TABS.indexOf(activeTab);
    let next: DrawerTab | null = null;
    if (e.key === 'ArrowRight') {
      next = DRAWER_TABS[(current + 1) % DRAWER_TABS.length]!;
    } else if (e.key === 'ArrowLeft') {
      next = DRAWER_TABS[(current - 1 + DRAWER_TABS.length) % DRAWER_TABS.length]!;
    } else if (e.key === 'Home') {
      next = DRAWER_TABS[0]!;
    } else if (e.key === 'End') {
      next = DRAWER_TABS.at(-1)!;
    }
    if (!next) return;
    e.preventDefault();
    e.stopPropagation();
    onChange(next);
    requestAnimationFrame(() => document.getElementById(`pr-tab-${next}`)?.focus());
  }

  return (
    <div
      role="tablist"
      aria-label="Pull request details"
      onKeyDown={onKeyDown}
      style={{
        padding: '0 14px',
        display: 'flex',
        gap: 0,
        borderBottom: '1px solid var(--line-2)',
        background: 'var(--bg-1)',
      }}
    >
      <TabButton
        tab="timeline"
        label="Timeline"
        count={timelineCount}
        active={activeTab === 'timeline'}
        onClick={() => onChange('timeline')}
      />
      <TabButton
        tab="commits"
        label="Commits"
        count={commitCount}
        active={activeTab === 'commits'}
        onClick={() => onChange('commits')}
      />
      <TabButton
        tab="diff"
        label="Diff"
        count={fileCount}
        active={activeTab === 'diff'}
        onClick={() => onChange('diff')}
      />
    </div>
  );
}

function TabButton({
  tab,
  label,
  count,
  active,
  onClick,
}: {
  tab: DrawerTab;
  label: string;
  count: number | null;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      id={`pr-tab-${tab}`}
      role="tab"
      aria-selected={active}
      aria-controls={`pr-panel-${tab}`}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      style={{
        height: 36,
        padding: '0 12px',
        border: 'none',
        background: 'transparent',
        color: active ? 'var(--fg-0)' : 'var(--fg-2)',
        fontSize: 12,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        borderBottom: active
          ? '2px solid var(--accent)'
          : '2px solid transparent',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: -1,
      }}
    >
      {label}
      {count != null && (
        <span
          className="mono"
          style={{
            fontSize: 10,
            color: active ? 'var(--fg-1)' : 'var(--fg-3)',
            padding: '1px 5px',
            borderRadius: 3,
            background: active ? 'var(--bg-3)' : 'var(--bg-2)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        color: 'var(--fg-3)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        fontWeight: 600,
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function StatusCard({
  label,
  tone,
  value,
  sub,
}: {
  label: string;
  tone: keyof typeof TONE_STYLE;
  value: string;
  sub: string;
}) {
  const t = TONE_STYLE[tone];
  return (
    <div
      style={{
        padding: '8px 10px',
        border: `1px solid ${t.bd}`,
        background: t.b,
        borderRadius: 6,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: 'var(--fg-2)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 12,
          color: t.c,
          fontWeight: 600,
          marginTop: 2,
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontSize: 10.5,
            color: 'var(--fg-3)',
            marginTop: 2,
            fontFamily: 'var(--font-mono)',
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
        No activity yet.
      </div>
    );
  }
  return (
    <div style={{ position: 'relative' }}>
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: 11,
          top: 8,
          bottom: 8,
          width: 1,
          background: 'var(--line-2)',
        }}
      />
      {events.map((e) => (
        <TimelineItem key={e.id} event={e} />
      ))}
    </div>
  );
}

const EVENT_META: Record<
  TimelineEvent['kind'],
  { dot: string; verb: string }
> = {
  opened: { dot: 'var(--fg-3)', verb: 'opened this PR' },
  'review-approved': { dot: 'var(--ok)', verb: 'approved' },
  'review-changes': { dot: 'var(--err)', verb: 'requested changes' },
  'review-comment': { dot: 'var(--info)', verb: 'reviewed' },
  'inline-comment': { dot: 'var(--info)', verb: 'commented on' },
  comment: { dot: 'var(--info)', verb: 'commented' },
};

function TimelineItem({ event }: { event: TimelineEvent }) {
  const meta = EVENT_META[event.kind];
  const when = (() => {
    try {
      return formatDistanceToNowStrict(new Date(event.at)) + ' ago';
    } catch {
      return '';
    }
  })();
  const locationLabel =
    event.kind === 'inline-comment' && event.path
      ? `${event.path}${event.line != null ? `:${event.line}` : ''}`
      : null;
  return (
    <div style={{ position: 'relative', paddingLeft: 30, marginBottom: 12 }}>
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: 4,
          top: 4,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: 'var(--bg-1)',
          border: `2px solid ${meta.dot}`,
        }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          minWidth: 0,
        }}
      >
        <Avatar user={event.author} size={16} />
        <span
          style={{
            color: 'var(--fg-0)',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          @{event.author.login}
        </span>
        <span
          style={{
            color: 'var(--fg-2)',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {meta.verb}
        </span>
        {locationLabel && (
          <span
            className="mono"
            style={{
              color: 'var(--fg-1)',
              fontSize: 11,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
              flexShrink: 1,
            }}
            title={locationLabel}
          >
            {locationLabel}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span
          className="mono"
          style={{
            color: 'var(--fg-3)',
            fontSize: 10.5,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
          title={event.at}
        >
          {when}
        </span>
      </div>
      {event.body && <CommentBubble body={event.body} />}
    </div>
  );
}

function CommentBubble({ body }: { body: string }) {
  const cleaned = stripRawHtml(body);
  if (cleaned.length === 0) return null;
  return (
    <div
      style={{
        marginTop: 6,
        padding: '8px 10px',
        background: 'var(--bg-2)',
        border: '1px solid var(--line-1)',
        borderRadius: 5,
        fontSize: 12,
        color: 'var(--fg-1)',
        lineHeight: 1.5,
        wordBreak: 'break-word',
      }}
    >
      <CommentMarkdown body={cleaned} />
    </div>
  );
}

/**
 * Render a GitHub comment body as styled Markdown.
 * react-markdown v10 leaves raw HTML as text by default, so we strip
 * HTML comments (bot markers like `<!-- BUGBOT_REVIEW -->`) and tags
 * (like `<picture>` / `<img>` badges) before handing off to the
 * renderer. Markdown links, images, code, etc. still work.
 */
function stripRawHtml(body: string): string {
  return body
    .replace(/<!--[\s\S]*?-->/g, '') // comments, including multi-line
    .replace(/<\/?[a-zA-Z][^>]*>/g, '') // tags
    .replace(/\n{3,}/g, '\n\n') // collapse blank runs left by stripped blocks
    .trim();
}

function CommentMarkdown({ body }: { body: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => (
          <p style={{ margin: '0 0 6px 0' }}>{children}</p>
        ),
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent)' }}
          >
            {children}
          </a>
        ),
        ul: ({ children }) => (
          <ul style={{ margin: '0 0 6px 0', paddingLeft: 20 }}>{children}</ul>
        ),
        ol: ({ children }) => (
          <ol style={{ margin: '0 0 6px 0', paddingLeft: 20 }}>{children}</ol>
        ),
        li: ({ children }) => (
          <li style={{ margin: '2px 0' }}>{children}</li>
        ),
        blockquote: ({ children }) => (
          <blockquote
            style={{
              // Reset browser default 40px indent — drawer's narrow.
              margin: '4px 0',
              padding: '2px 0 2px 10px',
              borderLeft: '3px solid var(--line-3)',
              color: 'var(--fg-2)',
            }}
          >
            {children}
          </blockquote>
        ),
        code: ({ className, children, ...rest }) => {
          const isBlock = /language-/.test(className ?? '');
          return (
            <code
              className={className}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                background: isBlock ? 'transparent' : 'var(--bg-3)',
                padding: isBlock ? 0 : '1px 4px',
                borderRadius: 3,
              }}
              {...rest}
            >
              {children}
            </code>
          );
        },
        pre: ({ children }) => (
          <pre
            style={{
              margin: '6px 0',
              padding: '8px 10px',
              background: 'var(--bg-3)',
              border: '1px solid var(--line-1)',
              borderRadius: 5,
              overflow: 'auto',
              fontSize: 11,
              lineHeight: 1.5,
            }}
          >
            {children}
          </pre>
        ),
        img: ({ src, alt }) => (
          <img
            src={src}
            alt={alt ?? ''}
            style={{
              maxWidth: '100%',
              borderRadius: 4,
              margin: '4px 0',
            }}
          />
        ),
        h1: ({ children }) => (
          <h3 style={{ margin: '8px 0 4px 0', fontSize: 13 }}>{children}</h3>
        ),
        h2: ({ children }) => (
          <h3 style={{ margin: '8px 0 4px 0', fontSize: 13 }}>{children}</h3>
        ),
        h3: ({ children }) => (
          <h3 style={{ margin: '8px 0 4px 0', fontSize: 12.5 }}>{children}</h3>
        ),
        table: ({ children }) => (
          <div style={{ overflowX: 'auto', margin: '4px 0' }}>
            <table
              style={{
                borderCollapse: 'collapse',
                fontSize: 11,
              }}
            >
              {children}
            </table>
          </div>
        ),
        th: ({ children }) => (
          <th
            style={{
              border: '1px solid var(--line-2)',
              padding: '4px 6px',
              textAlign: 'left',
              background: 'var(--bg-3)',
            }}
          >
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td
            style={{
              border: '1px solid var(--line-2)',
              padding: '4px 6px',
            }}
          >
            {children}
          </td>
        ),
        hr: () => (
          <hr
            style={{
              border: 'none',
              borderTop: '1px solid var(--line-2)',
              margin: '6px 0',
            }}
          />
        ),
      }}
    >
      {body}
    </ReactMarkdown>
  );
}

/**
 * Re-run the PR's whole Actions pipeline for its head SHA — green runs
 * included. Exists mainly to revive branch sandboxes that get torn
 * down nightly, so it's offered regardless of CI state, except while
 * checks are running (GitHub 403s re-run of unfinished runs).
 */
function RerunButton({ pr }: { pr: DashboardPR }) {
  const token = useUIStore((s) => s.token);
  const mutation = useRerunPipeline();

  // Merged PRs are historical; their sandbox is gone for good and the
  // runs are likely past the 30-day re-run window anyway.
  if (pr.isMerged) return null;

  const running = pr.ciStatus === 'pending';
  const enabled = !running && !mutation.isPending;
  const title = running
    ? 'Checks are already running — GitHub cannot re-run unfinished workflows'
    : 'Re-run all workflows for the latest commit (e.g. to redeploy the branch sandbox)';

  const errorMessage = (() => {
    if (!mutation.error) return null;
    let msg = mutation.error.message;
    if (token) msg = msg.split(token).join(redactToken(token));
    if (/permission|forbidden|403|not authorized|scope|resource not accessible/i.test(msg)) {
      return `${msg} — your token may lack write access. Re-running workflows needs the "repo" scope (classic) or "Actions: Read and write" (fine-grained).`;
    }
    return msg;
  })();

  const statusText = errorMessage
    ? errorMessage
    : mutation.isSuccess
      ? mutation.data.started > 0
        ? `Re-run started (${mutation.data.started} ${mutation.data.started === 1 ? 'workflow' : 'workflows'})`
        : 'Pipeline already running'
      : null;

  return (
    <>
      <button
        type="button"
        onClick={() =>
          mutation.mutate({
            repoNameWithOwner: pr.repoNameWithOwner,
            headSha: pr.headSha,
          })
        }
        disabled={!enabled}
        title={title}
        style={{
          height: 30,
          padding: '0 12px',
          borderRadius: 6,
          border: '1px solid var(--line-2)',
          background: 'var(--bg-1)',
          color: 'var(--fg-1)',
          fontSize: 12,
          fontWeight: 600,
          cursor: enabled ? 'pointer' : 'not-allowed',
          opacity: enabled ? 1 : 0.45,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {mutation.isPending ? (
          <Loader2 size={12} className="spin" aria-hidden />
        ) : (
          <RotateCw size={12} aria-hidden />
        )}
        Re-run CI
      </button>
      {statusText && (
        <span
          role={errorMessage ? 'alert' : 'status'}
          style={{
            fontSize: 11,
            color: errorMessage ? 'var(--err)' : 'var(--ok)',
            lineHeight: 1.4,
            maxWidth: 360,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={statusText}
        >
          {statusText}
        </span>
      )}
    </>
  );
}

function DraftToggleButton({ pr }: { pr: DashboardPR }) {
  const token = useUIStore((s) => s.token);
  const mutation = useSetDraftState();

  // Draft state is meaningless once merged, and GitHub only lets the
  // author (or someone with write access) change it. Perch is a
  // single-user inbox, so we gate on authorship and never render a
  // button that is guaranteed to 403.
  if (pr.isMerged || !pr.viewerIsAuthor) return null;

  const toDraft = !pr.isDraft;
  const enabled = !mutation.isPending;
  const title = toDraft
    ? 'Convert back to a draft — GitHub dismisses the PR’s pending review requests'
    : 'Mark ready for review — reviewers get requested and the PR leaves draft state';

  const errorMessage = (() => {
    if (!mutation.error) return null;
    let msg = mutation.error.message;
    if (token) msg = msg.split(token).join(redactToken(token));
    if (/permission|forbidden|403|not authorized|scope|resource not accessible/i.test(msg)) {
      return `${msg} — your token may lack write access. Changing draft state needs the "repo" scope (classic) or "Pull requests: Read and write" (fine-grained).`;
    }
    return msg;
  })();

  return (
    <>
      <button
        type="button"
        onClick={() => mutation.mutate({ pullRequestId: pr.id, draft: toDraft })}
        disabled={!enabled}
        title={title}
        style={{
          height: 30,
          padding: '0 12px',
          borderRadius: 6,
          border: '1px solid var(--line-2)',
          background: 'var(--bg-1)',
          color: 'var(--fg-1)',
          fontSize: 12,
          fontWeight: 600,
          cursor: enabled ? 'pointer' : 'not-allowed',
          opacity: enabled ? 1 : 0.45,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {mutation.isPending ? (
          <Loader2 size={12} className="spin" aria-hidden />
        ) : toDraft ? (
          <PenLine size={12} aria-hidden />
        ) : (
          <Send size={12} aria-hidden />
        )}
        {toDraft ? 'Mark as Draft' : 'Mark as Ready'}
      </button>
      {errorMessage && (
        <span
          role="alert"
          style={{
            fontSize: 11,
            color: 'var(--err)',
            lineHeight: 1.4,
            maxWidth: 360,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={errorMessage}
        >
          {errorMessage}
        </span>
      )}
    </>
  );
}

const VERDICTS: { event: ReviewEvent; label: string; tone: 'ok' | 'err' | 'neutral' }[] = [
  { event: 'APPROVE', label: 'Approve', tone: 'ok' },
  { event: 'REQUEST_CHANGES', label: 'Request changes', tone: 'err' },
  { event: 'COMMENT', label: 'Comment', tone: 'neutral' },
];

function ReviewComposer({
  pr,
  armed,
  onArm,
  textareaRef,
}: {
  pr: DashboardPR;
  /** Verdict pre-selected by `a` / `⇧R` / `c`, submitted on ⌘↵. */
  armed: ReviewEvent | null;
  onArm: (event: ReviewEvent | null) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}) {
  const [body, setBody] = useState('');
  const [mergeConfirmationOpen, setMergeConfirmationOpen] = useState(false);
  const token = useUIStore((s) => s.token);
  const mutation = useSubmitReview();
  const mergeMutation = useMergePullRequest();

  // No review actions on merged PRs — they're historical, and GitHub
  // rejects approve/request-changes on a merged PR.
  if (pr.isMerged) return null;

  const pending = mutation.isPending;
  const actionPending = pending || mergeMutation.isPending;
  const activeEvent = mutation.variables?.event;

  function submit(event: ReviewEvent) {
    mutation.mutate(
      { pullRequestId: pr.id, event, body },
      {
        onSuccess: () => {
          setBody('');
          onArm(null);
        },
      },
    );
  }

  // ⌘↵ / Ctrl↵ fires the armed verdict. Plain ↵ has to keep inserting a
  // newline — this is a comment box first.
  function onTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!(e.metaKey || e.ctrlKey) || e.key !== 'Enter') return;
    const event = armed ?? 'COMMENT';
    if (pending || !reviewActionEnabled(event, body, pr.viewerIsAuthor)) return;
    submit(event);
    e.preventDefault();
  }

  // Redact the PAT from any error before display, then add a friendly
  // hint for the common "token lacks write scope" failure.
  const errorMessage = (() => {
    if (!mutation.error) return null;
    let msg = mutation.error.message;
    if (token) msg = msg.split(token).join(redactToken(token));
    if (/permission|forbidden|403|not authorized|scope|resource not accessible/i.test(msg)) {
      return `${msg} — your token may lack write access. It needs the "repo" scope (classic) or "Pull requests: Read and write" (fine-grained).`;
    }
    return msg;
  })();

  const mergeErrorMessage = (() => {
    if (!mergeMutation.error) return null;
    let msg = mergeMutation.error.message;
    if (token) msg = msg.split(token).join(redactToken(token));
    if (/permission|forbidden|403|not authorized|scope|resource not accessible/i.test(msg)) {
      return `${msg} — your token may lack write access. Merging needs the "repo" scope (classic) or "Pull requests: Read and write" (fine-grained).`;
    }
    return msg;
  })();

  const mergeEnabled = isReadyToMerge(pr) && !actionPending;
  const mergeTitle = pr.isDraft
    ? 'Draft pull requests cannot be merged'
    : pr.mergeable === 'CONFLICTING'
      ? 'Resolve merge conflicts before merging'
      : pr.mergeable !== 'MERGEABLE'
        ? 'GitHub is still calculating mergeability'
        : pr.approvalState === 'changes'
          ? 'Requested changes must be resolved before merging'
          : pr.approvalCount < 1
            ? 'At least one approval is required before merging'
            : pr.ciStatus !== 'success'
              ? 'All checks must pass before merging'
              : 'Merge this pull request';

  function openMergeConfirmation() {
    if (!mergeEnabled) return;
    mergeMutation.reset();
    setMergeConfirmationOpen(true);
  }

  function confirmMerge() {
    mergeMutation.mutate(
      {
        pullRequestId: pr.id,
        expectedHeadOid: pr.headSha,
        mergeMethod: pr.mergeMethod,
      },
      { onSuccess: () => setMergeConfirmationOpen(false) },
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={onTextareaKeyDown}
        aria-label="Review comment"
        placeholder="Leave a review comment (optional for Approve)… ⌘↵ to submit"
        rows={2}
        disabled={actionPending}
        style={{
          width: '100%',
          resize: 'vertical',
          padding: '8px 10px',
          borderRadius: 6,
          border: '1px solid var(--line-2)',
          background: 'var(--bg-1)',
          color: 'var(--fg-0)',
          fontSize: 12,
          fontFamily: 'var(--font-sans)',
          lineHeight: 1.5,
          boxSizing: 'border-box',
        }}
      />
      {errorMessage && (
        <div
          role="alert"
          style={{
            fontSize: 11.5,
            color: 'var(--err)',
            lineHeight: 1.4,
          }}
        >
          {errorMessage}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {VERDICTS.map(({ event, label, tone }) => {
          const enabled =
            !actionPending && reviewActionEnabled(event, body, pr.viewerIsAuthor);
          const isActive = pending && activeEvent === event;
          const needsBody = event !== 'APPROVE' && body.trim().length === 0;
          const blockedAsAuthor = pr.viewerIsAuthor && event !== 'COMMENT';
          const title = blockedAsAuthor
            ? 'GitHub does not allow approving or requesting changes on your own PR'
            : needsBody
              ? 'A comment is required for this action'
              : undefined;
          return (
            <button
              key={event}
              type="button"
              onClick={() => submit(event)}
              disabled={!enabled}
              title={title}
              style={verdictBtnStyle(tone, enabled, armed === event)}
            >
              {isActive && <Loader2 size={12} className="spin" aria-hidden />}
              {label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={openMergeConfirmation}
          disabled={!mergeEnabled}
          title={mergeTitle}
          style={verdictBtnStyle('ok', mergeEnabled, false)}
        >
          {mergeMutation.isPending ? (
            <Loader2 size={12} className="spin" aria-hidden />
          ) : (
            <GitMerge size={12} aria-hidden />
          )}
          Merge
        </button>
        {armed && (
          <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>
            <span className="mono" style={{ color: 'var(--fg-1)' }}>
              ⌘↵
            </span>{' '}
            to submit
          </span>
        )}
      </div>
      {mergeConfirmationOpen && (
        <MergeConfirmationDialog
          pr={pr}
          pending={mergeMutation.isPending}
          errorMessage={mergeErrorMessage}
          onCancel={() => {
            if (!mergeMutation.isPending) setMergeConfirmationOpen(false);
          }}
          onConfirm={confirmMerge}
        />
      )}
    </div>
  );
}

function MergeConfirmationDialog({
  pr,
  pending,
  errorMessage,
  onCancel,
  onConfirm,
}: {
  pr: DashboardPR;
  pending: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="presentation"
      onClick={onCancel}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' && !pending) onCancel();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="merge-confirmation-title"
        aria-describedby="merge-confirmation-description"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 620,
          maxWidth: '100%',
          padding: 18,
          borderRadius: 10,
          border: '1px solid var(--line-2)',
          background: 'var(--bg-1)',
          boxShadow: '0 24px 70px rgba(0, 0, 0, 0.5)',
        }}
      >
        <h2
          id="merge-confirmation-title"
          style={{ margin: 0, color: 'var(--fg-0)', fontSize: 15, fontWeight: 650 }}
        >
          Merge pull request?
        </h2>
        <div
          id="merge-confirmation-description"
        >
          <p
            style={{
              margin: '8px 0 0',
              color: 'var(--fg-1)',
              fontSize: 12.5,
              lineHeight: 1.5,
              whiteSpace: 'nowrap',
            }}
          >
            Merge{' '}
            <span className="mono" style={{ fontWeight: 700 }}>
              {pr.headRefName}
            </span>{' '}
            into{' '}
            <span className="mono" style={{ fontWeight: 700 }}>
              {pr.baseRefName}
            </span>
            {'?'}
          </p>
          <p
            style={{
              margin: '14px 0 0',
              color: 'var(--fg-2)',
              fontSize: 12.5,
              lineHeight: 1.5,
            }}
          >
            This will merge the exact head commit currently shown in Perch using a{' '}
            {pr.mergeMethod === 'MERGE'
              ? 'merge commit'
              : pr.mergeMethod === 'SQUASH'
                ? 'squash merge'
                : 'rebase merge'}.
          </p>
        </div>
        {errorMessage && (
          <div
            role="alert"
            style={{
              marginTop: 12,
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid var(--err-line)',
              background: 'var(--err-bg)',
              color: 'var(--err)',
              fontSize: 11.5,
              lineHeight: 1.45,
            }}
          >
            {errorMessage}
          </div>
        )}
        <div
          style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}
        >
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            disabled={pending}
            style={confirmationBtnStyle(false, !pending)}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            style={confirmationBtnStyle(true, !pending)}
          >
            {pending && <Loader2 size={12} className="spin" aria-hidden />}
            Merge PR
          </button>
        </div>
      </div>
    </div>
  );
}

function confirmationBtnStyle(primary: boolean, enabled: boolean): React.CSSProperties {
  return {
    height: 32,
    padding: '0 13px',
    borderRadius: 6,
    border: primary ? '1px solid var(--ok)' : '1px solid var(--line-2)',
    background: primary ? 'var(--ok)' : 'var(--bg-2)',
    color: primary ? 'var(--bg-0)' : 'var(--fg-1)',
    fontSize: 12,
    fontWeight: 600,
    cursor: enabled ? 'pointer' : 'not-allowed',
    opacity: enabled ? 1 : 0.55,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  };
}

function verdictBtnStyle(
  tone: 'ok' | 'err' | 'neutral',
  enabled: boolean,
  armed: boolean,
): React.CSSProperties {
  const color =
    tone === 'ok' ? 'var(--ok)' : tone === 'err' ? 'var(--err)' : 'var(--fg-1)';
  const border = tone === 'neutral' ? 'var(--line-2)' : color;
  const toneBg =
    tone === 'ok'
      ? 'var(--ok-bg)'
      : tone === 'err'
        ? 'var(--err-bg)'
        : 'var(--bg-3)';
  return {
    height: 30,
    padding: '0 12px',
    borderRadius: 6,
    border: `1px solid ${border}`,
    background: armed ? toneBg : 'var(--bg-1)',
    boxShadow: armed ? `0 0 0 1px ${border}` : undefined,
    color,
    fontSize: 12,
    fontWeight: 600,
    cursor: enabled ? 'pointer' : 'not-allowed',
    opacity: enabled ? 1 : 0.45,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  };
}
