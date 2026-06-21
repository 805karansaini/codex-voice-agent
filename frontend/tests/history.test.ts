import assert from "node:assert/strict";
import test from "node:test";

import {
  historyRowsToMessages,
  mergeBackendHistoryWithLocalMessages,
} from "../src/utils/history.ts";
import type { ChatArtifact, CodexTimelineEvent, HistoryRow, Message } from "../src/types.ts";

test("historyRowsToMessages keeps only chat message roles", () => {
  const rows = [
    { id: "user-1", role: "user", text: "hello" },
    { id: "assistant-1", role: "assistant", text: "hi" },
    { id: "system-1", role: "system", text: "hidden" },
  ] as HistoryRow[];

  assert.deepEqual(
    historyRowsToMessages(rows).map((message) => message.id),
    ["user-1", "assistant-1"],
  );
});

test("historyRowsToMessages keeps user-facing background Codex requests", () => {
  const messages = historyRowsToMessages([
    {
      id: "direct-request",
      role: "user",
      text: "List all files in the current repository.",
      meta: { direct_codex: true, background_job_id: "job-1", user_visible: true },
    },
    {
      id: "internal-request",
      role: "user",
      text: "Internal voice handoff",
      meta: { direct_codex: true, background_job_id: "job-2" },
    },
  ] as HistoryRow[]);

  assert.deepEqual(
    messages.map((message) => message.id),
    ["direct-request"],
  );
});

test("historyRowsToMessages preserves artifact and Codex metadata", () => {
  const artifact: ChatArtifact = {
    id: "artifact-1",
    title: "Diff",
    summary: "Changed files",
    content: "diff --git",
    content_type: "diff",
    source: "git_diff",
  };
  const event: CodexTimelineEvent = {
    method: "turn/completed",
    summary: "Done",
    turn_id: "turn-1",
  };

  const [message] = historyRowsToMessages([
    {
      id: "assistant-1",
      role: "assistant",
      text: "Done",
      meta: {
        artifacts: [artifact],
        codex_events: [event],
        codex_status: "completed",
        codex_turn_id: "turn-1",
        codex_thread_id: "thread-1",
        workdir: "/tmp/project",
      },
    },
  ]);

  assert.equal(message.usedCodex, true);
  assert.deepEqual(message.artifacts, [artifact]);
  assert.deepEqual(message.codexEvents, [event]);
  assert.equal(message.codexStatus, "completed");
  assert.equal(message.codexTurnId, "turn-1");
  assert.equal(message.codexThreadId, "thread-1");
  assert.equal(message.workdir, "/tmp/project");
});

test("historyRowsToMessages preserves Gemini Live usage estimates", () => {
  const [message] = historyRowsToMessages([
    {
      id: "assistant-1",
      role: "assistant",
      text: "Done",
      meta: {
        gemini_live_usage: {
          estimated: true,
          input_text_chars: 12,
          output_text_chars: 8,
          input_audio_bytes: 3200,
          output_audio_bytes: 6400,
          estimated_input_tokens: 3,
          estimated_output_tokens: 2,
          estimated_total_tokens: 5,
          estimated_cost_usd: 0.000001,
        },
      },
    },
  ]);

  assert.equal(message.geminiLiveUsage?.estimated_total_tokens, 5);
  assert.equal(message.geminiLiveUsage?.input_audio_bytes, 3200);
});

test("historyRowsToMessages marks direct Codex and tool-call rows as Codex-backed", () => {
  const messages = historyRowsToMessages([
    {
      id: "direct",
      role: "assistant",
      text: "Direct",
      meta: { direct_codex: true },
    },
    {
      id: "tool",
      role: "assistant",
      text: "Tool",
      meta: { tool_calls: [{}] },
    },
    {
      id: "plain",
      role: "assistant",
      text: "Plain",
      meta: {},
    },
  ]);

  assert.deepEqual(
    messages.map((message) => [message.id, message.usedCodex]),
    [
      ["direct", true],
      ["tool", true],
      ["plain", false],
    ],
  );
});

test("mergeBackendHistoryWithLocalMessages prefers backend history over stale local messages", () => {
  const rows = [
    {
      id: "assistant-1",
      role: "assistant",
      text: "Backend text",
    },
  ] as HistoryRow[];
  const localMessages = [
    {
      id: "assistant-1",
      role: "assistant",
      text: "Stale local text",
    },
  ] as Message[];

  assert.deepEqual(mergeBackendHistoryWithLocalMessages(rows, localMessages), [
    {
      id: "assistant-1",
      role: "assistant",
      text: "Backend text",
      artifacts: [],
      usedCodex: false,
      workdir: undefined,
      codexEvents: [],
      codexStatus: undefined,
      codexTurnId: undefined,
      codexThreadId: undefined,
      geminiLiveUsage: undefined,
    },
  ]);
});

test("mergeBackendHistoryWithLocalMessages keeps pending local messages", () => {
  const rows = [{ id: "user-1", role: "user", text: "Saved" }] as HistoryRow[];
  const localMessages = [
    { id: "user-1", role: "user", text: "Saved" },
    { id: "assistant-stream", role: "assistant", text: "Typing", streaming: true },
  ] as Message[];

  assert.deepEqual(
    mergeBackendHistoryWithLocalMessages(rows, localMessages).map((message) => message.id),
    ["user-1", "assistant-stream"],
  );
});

test("mergeBackendHistoryWithLocalMessages removes a completed background job placeholder", () => {
  const rows = [
    {
      id: "completed-job-message",
      role: "assistant",
      text: "Completed output",
      meta: { background_job_id: "job-1", direct_codex: true },
    },
  ] as HistoryRow[];
  const localMessages = [
    {
      id: "streaming-placeholder",
      role: "assistant",
      text: "Codex is writing its response.",
      streaming: true,
      backgroundJobId: "job-1",
    },
  ] as Message[];

  assert.deepEqual(
    mergeBackendHistoryWithLocalMessages(rows, localMessages).map((message) => message.id),
    ["completed-job-message"],
  );
});

test("mergeBackendHistoryWithLocalMessages replaces local direct Codex messages with history", () => {
  const rows = [
    {
      id: "saved-request",
      role: "user",
      text: "Run the task",
      meta: { direct_codex: true, background_job_id: "job-1", user_visible: true },
    },
    {
      id: "saved-result",
      role: "assistant",
      text: "Completed output",
      meta: { direct_codex: true, background_job_id: "job-1" },
    },
  ] as HistoryRow[];
  const localMessages = [
    {
      id: "local-request",
      role: "user",
      text: "Run the task",
      backgroundJobId: "job-1",
    },
    {
      id: "local-result",
      role: "assistant",
      text: "Codex is working.",
      streaming: true,
      backgroundJobId: "job-1",
    },
  ] as Message[];

  assert.deepEqual(
    mergeBackendHistoryWithLocalMessages(rows, localMessages).map((message) => message.id),
    ["saved-request", "saved-result"],
  );
});

test("mergeBackendHistoryWithLocalMessages keeps a placeholder while its request is the only saved row", () => {
  const rows = [
    {
      id: "job-request",
      role: "user",
      text: "Run the task",
      meta: { background_job_id: "job-1", direct_codex: true },
    },
  ] as HistoryRow[];
  const localMessages = [
    {
      id: "streaming-placeholder",
      role: "assistant",
      text: "Codex is working.",
      streaming: true,
      backgroundJobId: "job-1",
    },
  ] as Message[];

  assert.deepEqual(
    mergeBackendHistoryWithLocalMessages(rows, localMessages).map((message) => message.id),
    ["streaming-placeholder"],
  );
});
