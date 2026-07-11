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
  return job.latest_status || updates[updates.length - 1] || "Codex is still working.";
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

type WatchCodexJobOptions = {
  loadJob?: (jobId: string) => Promise<CodexJob>;
  initialDelayMs?: number;
  pollIntervalMs?: number;
};

export async function watchCodexJob(
  jobId: string,
  handlers: CodexJobHandlers,
  options: WatchCodexJobOptions = {},
): Promise<void> {
  const loadJob = options.loadJob || fetchCodexJob;
  await wait(options.initialDelayMs ?? 1000);
  while (handlers.isCurrent?.() !== false) {
    try {
      const job = await loadJob(jobId);
      if (handlers.isCurrent?.() === false) return;
      if (job.status === "queued" || job.status === "running") {
        handlers.onProgress(job, codexJobProgress(job));
        await wait(options.pollIntervalMs ?? 1500);
        continue;
      }
      if (job.status === "done") {
        handlers.onDone(job, job.result || "Codex background task completed.");
        return;
      }
      handlers.onFailed(job, job.error || "Codex background task failed.");
      return;
    } catch (error) {
      handlers.onError(error instanceof Error ? error.message : "Failed to poll Codex job");
      return;
    }
  }
}
