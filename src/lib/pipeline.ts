import { planRerun, type GhWorkflowRun } from './rerun';

export interface PipelineStep {
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  number: number;
}
export interface PipelineJob extends Omit<PipelineStep, 'number'> {
  id: number;
  html_url: string;
  steps: PipelineStep[];
}
export interface PipelineRun extends GhWorkflowRun {
  conclusion: string | null;
  html_url: string;
  jobs: PipelineJob[];
}

export function summarizeJobs(jobs: PipelineJob[]) {
  return {
    total: jobs.length,
    completed: jobs.filter((job) => job.status === 'completed').length,
    running: jobs.filter((job) => job.status === 'in_progress').length,
    queued: jobs.filter(
      (job) => !['completed', 'in_progress'].includes(job.status),
    ).length,
  };
}

export function pipelineDuration(
  start: string | null,
  end: string | null,
  now = Date.now(),
): string {
  if (!start || !Number.isFinite(Date.parse(start))) return '';
  const seconds = Math.max(
    0,
    Math.floor(((end ? Date.parse(end) : now) - Date.parse(start)) / 1000),
  );
  if (!Number.isFinite(seconds)) return '';
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export async function fetchPipeline(
  token: string,
  repo: string,
  sha: string,
  signal?: AbortSignal,
): Promise<PipelineRun[]> {
  const base = `https://api.github.com/repos/${repo}/actions`;
  async function pages<T>(path: string, key: string): Promise<T[]> {
    const all: T[] = [];
    for (let page = 1; ; page++) {
      const response = await fetch(
        `${base}/${path}&per_page=100&page=${page}`,
        {
          signal,
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
        },
      );
      // Never expose a response body: it can contain credentials or request data.
      if (!response.ok)
        throw new Error(
          `Couldn't load GitHub Actions (${response.status}).${response.status === 403 ? ' Check Actions read access and your API rate limit.' : ''}`,
        );
      const data = (await response.json()) as Record<string, T[]>;
      const items = data[key];
      if (!Array.isArray(items))
        throw new Error('Unexpected GitHub Actions response');
      all.push(...items);
      if (items.length < 100) return all;
    }
  }
  const runs = await pages<PipelineRun>(
    `runs?head_sha=${encodeURIComponent(sha)}`,
    'workflow_runs',
  );
  const plan = planRerun(runs);
  const latest = new Set(
    [...plan.targets, ...plan.inProgress].map((run) => run.id),
  );
  const result: PipelineRun[] = [];
  for (const run of runs.filter((candidate) => latest.has(candidate.id))) {
    const jobs = await pages<PipelineJob>(
      `runs/${run.id}/jobs?filter=latest`,
      'jobs',
    );
    result.push({ ...run, jobs });
  }
  return result;
}
