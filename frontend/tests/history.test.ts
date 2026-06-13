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
    ["user-1", "assistant-1"]
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
    ]
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
