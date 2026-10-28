import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchPipeline,
  pipelineDuration,
  summarizeJobs,
  type PipelineJob,
} from './pipeline';

const job = (
  status: string,
  conclusion: string | null = null,
): PipelineJob => ({
  id: 1,
  name: 'Tests',
  status,
  conclusion,
  html_url: '',
  steps: [],
  started_at: null,
  completed_at: null,
});
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('pipeline progress', () => {
  it('counts terminal jobs as complete without treating failure or skipped as success', () => {
    expect(
      summarizeJobs([
        job('completed', 'success'),
        job('completed', 'failure'),
        job('completed', 'skipped'),
        job('in_progress'),
        job('waiting'),
        job('queued'),
      ]),
    ).toEqual({ total: 6, completed: 3, running: 1, queued: 2 });
    expect(summarizeJobs([])).toEqual({
      total: 0,
      completed: 0,
      running: 0,
      queued: 0,
    });
  });
  it('measures elapsed time and freezes completed durations', () => {
    expect(
      pipelineDuration(
        '2026-10-28T10:00:00Z',
        null,
        Date.parse('2026-10-28T10:01:12Z'),
      ),
    ).toBe('1m 12s');
    expect(
      pipelineDuration('2026-10-28T10:00:00Z', '2026-10-28T10:00:18Z'),
    ).toBe('18s');
    expect(pipelineDuration(null, null)).toBe('');
    expect(pipelineDuration('invalid', null)).toBe('');
  });
  it('paginates jobs and loads only the latest run of each workflow', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          workflow_runs: [
            { id: 1, workflow_id: 10, status: 'completed' },
            { id: 2, workflow_id: 10, status: 'in_progress' },
            { id: 3, workflow_id: 20, status: 'queued' },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          jobs: Array.from({ length: 100 }, (_, id) => ({
            ...job('completed', 'success'),
            id,
          })),
        }),
      )
      .mockResolvedValueOnce(Response.json({ jobs: [job('in_progress')] }))
      .mockResolvedValueOnce(Response.json({ jobs: [] }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const runs = await fetchPipeline('secret-token', 'owner/repo', 'abc');
    expect(runs.map((run) => run.id)).toEqual([2, 3]);
    expect(runs[0].jobs).toHaveLength(101);
    expect(fetchMock.mock.calls[1][0]).toContain('runs/2/jobs?filter=latest');
    expect(fetchMock.mock.calls[2][0]).toContain('page=2');
  });
  it('does not expose response bodies on permission failures', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('secret-token', { status: 403 }),
      ) as unknown as typeof fetch;
    await expect(
      fetchPipeline('secret-token', 'owner/repo', 'abc'),
    ).rejects.toThrow('Check Actions read access');
    await expect(
      fetchPipeline('secret-token', 'owner/repo', 'abc'),
    ).rejects.not.toThrow('secret-token');
  });
});
