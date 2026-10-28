import {
  CircleCheck,
  CircleX,
  Clock3,
  Loader2,
  MinusCircle,
  ExternalLink,
} from 'lucide-react';
import type { DashboardPR } from '../types/dashboard';
import { usePipeline } from '../hooks/usePipeline';
import {
  pipelineDuration,
  summarizeJobs,
  type PipelineStep,
} from '../lib/pipeline';
import { CIStatusChip } from './primitives';

function status(item: Pick<PipelineStep, 'status' | 'conclusion'>) {
  if (item.status === 'completed') {
    if (item.conclusion === 'success')
      return { label: 'Passed', color: 'var(--ok)', Icon: CircleCheck };
    if (['skipped', 'neutral', 'cancelled'].includes(item.conclusion ?? ''))
      return {
        label: item.conclusion!,
        color: 'var(--fg-2)',
        Icon: MinusCircle,
      };
    return {
      label: item.conclusion ?? 'Completed',
      color: 'var(--err)',
      Icon: CircleX,
    };
  }
  return item.status === 'in_progress'
    ? { label: 'Running', color: 'var(--warn)', Icon: Loader2 }
    : {
        label: item.status === 'waiting' ? 'Waiting' : 'Queued',
        color: 'var(--fg-2)',
        Icon: Clock3,
      };
}
function StatusIcon({
  item,
}: {
  item: Pick<PipelineStep, 'status' | 'conclusion'>;
}) {
  const { Icon, color } = status(item);
  return (
    <Icon
      size={15}
      color={color}
      aria-hidden
      style={{ flexShrink: 0 }}
      className={item.status === 'in_progress' ? 'ci-running' : undefined}
    />
  );
}
function Progress({ completed, total }: { completed: number; total: number }) {
  return (
    <div
      role="progressbar"
      aria-label="Jobs completed"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={completed}
      style={{
        height: 4,
        background: 'var(--bg-4)',
        borderRadius: 'var(--r-1)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: `${total ? (completed / total) * 100 : 0}%`,
          height: '100%',
          background: 'var(--ok)',
        }}
      />
    </div>
  );
}
export function PipelineChip({ pr }: { pr: DashboardPR }) {
  const query = usePipeline(pr);
  const summary = summarizeJobs(query.data?.flatMap((run) => run.jobs) ?? []);
  if (pr.ciStatus !== 'pending' || query.error || !summary.total)
    return <CIStatusChip state={pr.ciStatus} compact />;
  return (
    <span
      title={`${summary.completed} of ${summary.total} GitHub Actions jobs complete; ${summary.running} running; ${summary.queued} queued. Job count is not time remaining.`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        whiteSpace: 'nowrap',
        color: 'var(--warn)',
        fontSize: 11,
      }}
    >
      <CIStatusChip state={pr.ciStatus} compact />
      <span className="mono">
        CI · {summary.completed}/{summary.total}
      </span>
      <span style={{ width: 40 }}>
        <Progress {...summary} />
      </span>
    </span>
  );
}
export function PipelineChecks({ pr }: { pr: DashboardPR }) {
  const query = usePipeline(pr, true);
  return (
    <div style={{ padding: 20 }}>
      {query.isLoading && <p role="status">Loading GitHub Actions…</p>}
      {query.error && (
        <div role="alert" style={{ color: 'var(--err)', marginBottom: 16 }}>
          {query.error.message}{' '}
          <button onClick={() => void query.refetch()}>Retry</button>
        </div>
      )}
      {query.data?.length === 0 && (
        <p style={{ color: 'var(--fg-2)' }}>
          No GitHub Actions runs found for this commit. External CI progress is
          available on{' '}
          <a href={`${pr.url}/checks`} target="_blank" rel="noreferrer">
            GitHub
          </a>
          .
        </p>
      )}
      {query.data?.map((run) => {
        const summary = summarizeJobs(run.jobs);
        return (
          <section key={run.id} style={{ marginBottom: 24 }}>
            <div
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                flexWrap: 'wrap',
                marginBottom: 14,
              }}
            >
              <StatusIcon item={run} />
              <strong style={{ fontWeight: 500 }}>
                {run.name ?? 'Workflow'}
              </strong>
              <span style={{ color: status(run).color, fontSize: 12 }}>
                {status(run).label}
              </span>
              <a
                href={run.html_url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${run.name ?? 'workflow'} on GitHub`}
                style={{ marginLeft: 'auto', color: 'var(--fg-2)' }}
              >
                <ExternalLink size={14} />
              </a>
            </div>
            {!!summary.total && (
              <>
                <Progress {...summary} />
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 8,
                    color: 'var(--fg-2)',
                    fontSize: 12,
                    margin: '8px 0 18px',
                  }}
                >
                  <span>
                    {summary.completed} of {summary.total} jobs complete
                  </span>
                  <span>
                    {summary.running} running · {summary.queued} queued
                  </span>
                </div>
              </>
            )}
            {!summary.total && (
              <p style={{ color: 'var(--fg-2)' }}>No jobs reported yet.</p>
            )}
            {run.jobs.map((job) => (
              <details
                key={job.id}
                open={job.status === 'in_progress'}
                style={{ borderBottom: '1px solid var(--line-1)' }}
              >
                <summary
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'center',
                    padding: '12px 0',
                    cursor: 'pointer',
                    flexWrap: 'wrap',
                  }}
                >
                  <StatusIcon item={job} />
                  <span style={{ overflowWrap: 'anywhere', flex: 1 }}>
                    {job.name}
                  </span>
                  <span
                    className="mono"
                    style={{ fontSize: 12, color: 'var(--fg-2)' }}
                  >
                    {status(job).label}{' '}
                    {pipelineDuration(job.started_at, job.completed_at) &&
                      `· ${pipelineDuration(job.started_at, job.completed_at)}`}
                  </span>
                </summary>
                <div style={{ padding: '0 0 12px 25px' }}>
                  {job.steps.map((step) => (
                    <div
                      key={step.number}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 9,
                        padding: '7px 0',
                        fontSize: 12,
                      }}
                    >
                      <StatusIcon item={step} />
                      <span style={{ flex: 1, overflowWrap: 'anywhere' }}>
                        {step.name}
                      </span>
                      <span className="mono" style={{ color: 'var(--fg-2)' }}>
                        {pipelineDuration(step.started_at, step.completed_at) ||
                          status(step).label}
                      </span>
                    </div>
                  ))}
                  {!job.steps.length && (
                    <span style={{ color: 'var(--fg-2)', fontSize: 12 }}>
                      No step details reported.
                    </span>
                  )}
                </div>
              </details>
            ))}
          </section>
        );
      })}
      {!!query.data?.length && (
        <div style={{ color: 'var(--fg-2)', fontSize: 12 }}>
          Job completion, not time remaining.{' '}
          {query.isFetching
            ? 'Updating…'
            : `Updated ${new Date(query.dataUpdatedAt).toLocaleTimeString()}`}
        </div>
      )}
    </div>
  );
}
