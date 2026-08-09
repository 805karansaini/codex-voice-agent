import type { CodexJob } from "../types";
import { fetchCodexJob } from "./api.ts";

export type CodexJobHandlers = {
  isCurrent?: () => boolean;
  onProgress: (job: CodexJob, message: string) => void;
  onDone: (job: CodexJob, result: string) => void;
  onFailed: (job: CodexJob, message: string) => void;
  onError: (message: string) => void;
};

export function codexJobProgress(job: CodexJob): string {
  const updates = job.progress_updates || [];
  const provider = job.harness === "claude" ? "Claude" : "Codex";
  return job.latest_status || updates[updates.length - 1] || `${provider} is still working.`;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

type WatchCodexJobOptions = {
  loadJob?: (jobId: string) => Promise<CodexJob>;
  initialDelayMs?: number;
  pollIntervalMs?: number;
  retryDelayMs?: number;
  maxConsecutiveErrors?: number;
};

export async function watchCodexJob(
  jobId: string,
  handlers: CodexJobHandlers,
  options: WatchCodexJobOptions = {},
): Promise<void> {
  const loadJob = options.loadJob || fetchCodexJob;
  const pollIntervalMs = options.pollIntervalMs ?? 1500;
  const retryDelayMs = options.retryDelayMs ?? pollIntervalMs;
  const maxConsecutiveErrors = Math.max(1, options.maxConsecutiveErrors ?? 3);
  let consecutiveErrors = 0;
  await wait(options.initialDelayMs ?? 1000);
  while (handlers.isCurrent?.() !== false) {
    try {
      const job = await loadJob(jobId);
      consecutiveErrors = 0;
      if (handlers.isCurrent?.() === false) return;
      if (job.status === "queued" || job.status === "running") {
        handlers.onProgress(job, codexJobProgress(job));
        await wait(pollIntervalMs);
        continue;
      }
      if (job.status === "done") {
        const provider = job.harness === "claude" ? "Claude" : "Codex";
        handlers.onDone(job, job.result || `${provider} background task completed.`);
        return;
      }
      const provider = job.harness === "claude" ? "Claude" : "Codex";
      handlers.onFailed(job, job.error || `${provider} background task failed.`);
      return;
    } catch (error) {
      if (handlers.isCurrent?.() === false) return;
      consecutiveErrors += 1;
      if (consecutiveErrors >= maxConsecutiveErrors) {
        handlers.onError(
          error instanceof Error ? error.message : "Failed to poll coding agent job",
        );
        return;
      }
      await wait(retryDelayMs);
    }
  }
}
