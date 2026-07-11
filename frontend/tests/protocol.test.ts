import assert from "node:assert/strict";
import test from "node:test";

import { parseServerEvent, parseServerEventJson } from "../src/types/protocol.ts";

test("parseServerEvent accepts and normalizes a valid server event", () => {
  assert.deepEqual(
    parseServerEvent({
      type: "tool_result",
      result: "Task started",
      codex_turn_id: null,
      artifact: null,
      codex_events: [],
    }),
    { type: "tool_result", result: "Task started", codex_events: [] },
  );
});

test("parseServerEvent rejects invalid known fields", () => {
  assert.equal(parseServerEvent({ type: "delta", text: { invalid: true } }), null);
  assert.equal(
    parseServerEvent({
      type: "turn_complete",
      gemini_live_usage: { estimated: true, estimated_cost_usd: "invalid" },
    }),
    null,
  );
  assert.equal(
    parseServerEvent({ type: "codex_event", event: { method: 42, status: "running" } }),
    null,
  );
});

test("parseServerEvent rejects unknown event types and missing required fields", () => {
  assert.equal(parseServerEvent({ type: "unknown_event", message: "ignored" }), null);
  assert.equal(parseServerEvent({ type: "assistant_audio_delta" }), null);
  assert.equal(
    parseServerEvent({
      type: "turn_complete",
      user_text: "hello",
      assistant_text: "hi",
      workdir: "/tmp/project",
    }),
    null,
  );
});

test("parseServerEvent preserves every background artifact and removes nested nulls", () => {
  const artifact = {
    id: "artifact-1",
    chat_id: null,
    message_id: null,
    title: "Result",
    summary: "Summary",
    content: "Content",
    content_type: "markdown",
    source: "codex",
    workdir: null,
    created_at: "2026-07-11T00:00:00Z",
    changed_files: null,
  };
  assert.deepEqual(
    parseServerEvent({
      type: "background_job_completed",
      result: "Done",
      background_job_id: "job-1",
      artifacts: [artifact],
      handoff: { id: "handoff-1", workdir: null, codex_status: "completed" },
    }),
    {
      type: "background_job_completed",
      result: "Done",
      background_job_id: "job-1",
      artifacts: [
        {
          id: "artifact-1",
          title: "Result",
          summary: "Summary",
          content: "Content",
          content_type: "markdown",
          source: "codex",
          created_at: "2026-07-11T00:00:00Z",
        },
      ],
      handoff: { id: "handoff-1", codex_status: "completed" },
    },
  );
});

test("parseServerEventJson rejects invalid JSON and missing event types", () => {
  assert.equal(parseServerEventJson("not-json"), null);
  assert.equal(parseServerEventJson('{"text":"missing type"}'), null);
});
