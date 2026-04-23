import { X, ExternalLink } from 'lucide-react';
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

interface Props {
  pr: DashboardPR;
  onClose: () => void;
}

export function PRDetail({ pr, onClose }: Props) {
  const mergeableTone =
    pr.mergeable === 'MERGEABLE'
      ? 'ok'
      : pr.mergeable === 'CONFLICTING'
        ? 'err'
        : 'warn';

  return (
    <aside
      role="dialog"
      aria-label={`Pull request ${pr.repoNameWithOwner} #${pr.number}`}
      style={{
        width: 480,
        height: '100%',
        background: 'var(--bg-1)',
        borderLeft: '1px solid var(--line-2)',
        boxShadow: '-24px 0 60px rgba(0,0,0,0.3)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
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
          onClick={onClose}
          aria-label="Close"
          title="Close (Esc)"
          style={{
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
          }}
        >
          <X size={14} />
        </button>
      </div>

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
            tone={pr.approvalState === 'approved' ? 'ok' : pr.approvalState === 'changes' ? 'err' : 'warn'}
            value={
              pr.approvalState === 'changes'
                ? 'Changes requested'
                : pr.approvalState === 'approved'
                  ? `${pr.approvalCount}/${Math.max(pr.reviewerCount, pr.approvalCount)} approved`
                  : `${pr.approvalCount}/${Math.max(pr.reviewerCount, pr.approvalCount) || '—'} approvals`
            }
            sub={
              pr.reviewers[0]
                ? `latest: @${pr.reviewers[0].login}`
                : 'no reviews yet'
            }
          />
          <StatusCard
            label="CI"
            tone={
              pr.ciStatus === 'success'
                ? 'ok'
                : pr.ciStatus === 'failure'
                  ? 'err'
                  : pr.ciStatus === 'pending'
                    ? 'warn'
                    : 'neutral'
            }
            value={
              pr.ciStatus === 'success'
                ? 'Passing'
                : pr.ciStatus === 'failure'
                  ? 'Failing'
                  : pr.ciStatus === 'pending'
                    ? 'Running'
                    : 'No checks'
            }
            sub=""
          />
          <StatusCard
            label="Mergeable"
            tone={mergeableTone}
            value={
              pr.mergeable === 'MERGEABLE'
                ? 'Clean'
                : pr.mergeable === 'CONFLICTING'
                  ? 'Conflicts'
                  : 'Unknown'
            }
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
            {pr.commitCount}{' '}
            {pr.commitCount === 1 ? 'commit' : 'commits'}
          </span>
          <span>
            {pr.reviewers.length}{' '}
            {pr.reviewers.length === 1 ? 'reviewer' : 'reviewers'}
          </span>
        </div>
      </div>

      <div
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

      <div
        style={{
          padding: 10,
          borderTop: '1px solid var(--line-1)',
          background: 'var(--bg-2)',
          display: 'flex',
          gap: 6,
        }}
      >
        <a
          href={pr.url}
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
          }}
        >
          <ExternalLink size={12} />
          Open on GitHub
        </a>
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
    </aside>
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
        }}
      >
        <Avatar user={event.author} size={16} />
        <span style={{ color: 'var(--fg-0)', fontWeight: 500 }}>
          @{event.author.login}
        </span>
        <span style={{ color: 'var(--fg-2)' }}>{meta.verb}</span>
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
            }}
            title={locationLabel}
          >
            {locationLabel}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span
          className="mono"
          style={{ color: 'var(--fg-3)', fontSize: 10.5 }}
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
              margin: '4px 0',
              paddingLeft: 10,
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
