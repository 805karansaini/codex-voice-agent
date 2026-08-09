import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiError,
  enqueueCodexJob,
  fetchCodingHarnesses,
  fetchHealth,
} from "../src/services/api.ts";

test("coding agent discovery returns Claude and Codex options", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        harnesses: [
          { id: "codex", displayName: "Codex", available: true, authenticated: true, models: [] },
          {
            id: "claude",
            displayName: "Claude",
            available: true,
            authenticated: false,
            models: [],
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  try {
    const harnesses = await fetchCodingHarnesses();
    assert.deepEqual(
      harnesses.map((item) => item.id),
      ["codex", "claude"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("background coding jobs send the selected Claude harness", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (_input, init) => {
    const body = init?.body;
    if (typeof body !== "string") throw new Error("Expected a JSON request body");
    const parsed: unknown = JSON.parse(body);
    assert.ok(parsed && typeof parsed === "object" && !Array.isArray(parsed));
    requestBody = parsed as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        id: "job-1",
        task: "run tests",
        workdir: "/tmp/project",
        harness: "claude",
        status: "queued",
        result: "",
        error: "",
        codex_events: [],
        created_at: "now",
        updated_at: "now",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    await enqueueCodexJob({
      task: "run tests",
      workdir: "/tmp/project",
      projectId: "project-1",
      chatId: "chat-1",
      harness: "claude",
      model: "sonnet",
      reasoningEffort: "high",
    });
    assert.equal(requestBody.harness, "claude");
    assert.equal(requestBody.model, "sonnet");
    assert.equal(requestBody.reasoning_effort, "high");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("API errors preserve the HTTP status and backend detail", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ detail: "Project folder not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });

  try {
    await assert.rejects(fetchHealth(), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 404);
      assert.equal(error.message, "Project folder not found");
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
