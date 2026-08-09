import assert from "node:assert/strict";
import test from "node:test";

import {
  presentTaskArtifacts,
  taskAgentName,
  taskState,
  taskSummary,
} from "../src/utils/taskPresentation.ts";
import type { Message } from "../src/types.ts";

const baseMessage: Message = {
  id: "message-1",
  role: "assistant",
  text: "Finished the requested update.",
  usedCodex: true,
};

test("task presentation separates changes and removes duplicate output", () => {
  const result = presentTaskArtifacts(
    [
      {
        id: "output",
        title: "Claude output",
        summary: "Result",
        content: "Finished   the requested update.",
        content_type: "text",
        source: "claude",
      },
      {
        id: "diff",
        title: "Change review",
        summary: "One file changed",
        content: "diff --git a/a b/a",
        content_type: "diff",
        source: "git_diff",
        changed_files: ["a"],
      },
    ],
    baseMessage.text,
  );

  assert.deepEqual(result.outputs, []);
  assert.deepEqual(
    result.changes.map((artifact) => artifact.id),
    ["diff"],
  );
});

test("a provider diff without changed files remains output", () => {
  const result = presentTaskArtifacts(
    [
      {
        id: "provider-diff",
        title: "Generated patch",
        summary: "Suggested change",
        content: "diff --git a/a b/a",
        content_type: "diff",
        source: "claude",
      },
    ],
    "Different assistant summary",
  );

  assert.deepEqual(result.changes, []);
  assert.deepEqual(
    result.outputs.map((artifact) => artifact.id),
    ["provider-diff"],
  );
});

test("task state follows streaming and terminal failures", () => {
  assert.equal(taskState({ ...baseMessage, streaming: true }), "running");
  assert.equal(taskState({ ...baseMessage, codexStatus: "failed" }), "failed");
  assert.equal(taskState({ ...baseMessage, codexStatus: "cancelled" }), "failed");
  assert.equal(taskState({ ...baseMessage, codexStatus: "completed" }), "completed");
});

test("task labels use stored evidence instead of the current selector", () => {
  assert.equal(
    taskAgentName({
      ...baseMessage,
      artifacts: [
        {
          id: "output",
          title: "Claude output",
          summary: "Result",
          content: "Done",
          content_type: "text",
          source: "claude",
        },
      ],
    }),
    "Claude",
  );
  assert.equal(taskAgentName(baseMessage), "Coding agent");
  assert.equal(
    taskAgentName({
      ...baseMessage,
      text: "Compare Claude with another model",
      codingHarness: "codex",
    }),
    "Codex",
  );
});

test("task summaries use a compact first line", () => {
  assert.equal(taskSummary({ ...baseMessage, text: "First line\n\nMore detail" }), "First line");
  assert.equal(taskSummary({ ...baseMessage, text: "**Finished** the task" }), "Finished the task");
  assert.equal(
    taskSummary({ ...baseMessage, text: "", streaming: true }),
    "Working on the request",
  );
});
