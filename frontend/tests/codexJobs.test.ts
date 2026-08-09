import assert from "node:assert/strict";
import test from "node:test";

import { codexJobProgress, watchCodexJob } from "../src/services/codexJobs.ts";
import type { CodexJob } from "../src/types.ts";

function job(status: CodexJob["status"], patch: Partial<CodexJob> = {}): CodexJob {
  return {
    id: "job-1",
    task: "Run tests",
    workdir: "/tmp/project",
    status,
    result: "",
    error: "",
    codex_events: [],
    created_at: "2026-07-11T00:00:00Z",
    updated_at: "2026-07-11T00:00:00Z",
    ...patch,
  };
}

test("codexJobProgress uses the latest available progress message", () => {
  assert.equal(
    codexJobProgress(job("running", { latest_status: "Running checks" })),
    "Running checks",
  );
  assert.equal(
    codexJobProgress(job("running", { progress_updates: ["Started", "Building"] })),
    "Building",
  );
});

test("codexJobProgress names the selected provider in fallback status", () => {
  assert.equal(codexJobProgress(job("running", { harness: "claude" })), "Claude is still working.");
  assert.equal(codexJobProgress(job("running", { harness: "codex" })), "Codex is still working.");
});

test("watchCodexJob reports progress and one terminal result", async () => {
  const responses = [
    job("running", { latest_status: "Building" }),
    job("done", { result: "Passed" }),
  ];
  const events: string[] = [];

  await watchCodexJob(
    "job-1",
    {
      onProgress: (_job, message) => events.push(`progress:${message}`),
      onDone: (_job, result) => events.push(`done:${result}`),
      onFailed: (_job, message) => events.push(`failed:${message}`),
      onError: (message) => events.push(`error:${message}`),
    },
    {
      loadJob: async () => responses.shift() || job("failed", { error: "unexpected poll" }),
      initialDelayMs: 0,
      pollIntervalMs: 0,
    },
  );

  assert.deepEqual(events, ["progress:Building", "done:Passed"]);
});

test("watchCodexJob reports one failed terminal result", async () => {
  const events: string[] = [];

  await watchCodexJob(
    "job-1",
    {
      onProgress: () => events.push("progress"),
      onDone: () => events.push("done"),
      onFailed: (_job, message) => events.push(`failed:${message}`),
      onError: (message) => events.push(`error:${message}`),
    },
    {
      loadJob: async () => job("failed", { error: "workspace rejected the change" }),
      initialDelayMs: 0,
    },
  );

  assert.deepEqual(events, ["failed:workspace rejected the change"]);
});

test("watchCodexJob retries a transient polling failure", async () => {
  let attempts = 0;
  const events: string[] = [];

  await watchCodexJob(
    "job-1",
    {
      onProgress: () => undefined,
      onDone: (_job, result) => events.push(`done:${result}`),
      onFailed: (_job, message) => events.push(`failed:${message}`),
      onError: (message) => events.push(`error:${message}`),
    },
    {
      loadJob: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary disconnect");
        return job("done", { result: "Recovered" });
      },
      initialDelayMs: 0,
      retryDelayMs: 0,
      maxConsecutiveErrors: 2,
    },
  );

  assert.equal(attempts, 2);
  assert.deepEqual(events, ["done:Recovered"]);
});

test("watchCodexJob reports an error after the retry budget is exhausted", async () => {
  let attempts = 0;
  const events: string[] = [];

  await watchCodexJob(
    "job-1",
    {
      onProgress: () => undefined,
      onDone: () => undefined,
      onFailed: () => undefined,
      onError: (message) => events.push(message),
    },
    {
      loadJob: async () => {
        attempts += 1;
        throw new Error("still offline");
      },
      initialDelayMs: 0,
      retryDelayMs: 0,
      maxConsecutiveErrors: 2,
    },
  );

  assert.equal(attempts, 2);
  assert.deepEqual(events, ["still offline"]);
});

test("watchCodexJob suppresses a late result after its scope is invalidated", async () => {
  let current = true;
  let markLoadStarted!: () => void;
  let resolveJob!: (value: CodexJob) => void;
  const loadStarted = new Promise<void>((resolve) => {
    markLoadStarted = resolve;
  });
  const pendingJob = new Promise<CodexJob>((resolve) => {
    resolveJob = resolve;
  });
  const events: string[] = [];

  const watching = watchCodexJob(
    "job-1",
    {
      isCurrent: () => current,
      onProgress: () => events.push("progress"),
      onDone: () => events.push("done"),
      onFailed: () => events.push("failed"),
      onError: () => events.push("error"),
    },
    {
      loadJob: async () => {
        markLoadStarted();
        return pendingJob;
      },
      initialDelayMs: 0,
    },
  );

  await loadStarted;
  current = false;
  resolveJob(job("done", { result: "Too late" }));
  await watching;

  assert.deepEqual(events, []);
});
