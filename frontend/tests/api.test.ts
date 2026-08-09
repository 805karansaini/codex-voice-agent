import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiError,
  describeRequestFailure,
  enqueueCodexJob,
  fetchCodingHarnesses,
  fetchHealth,
  NO_RESPONSE_STATUS,
  TIMEOUT_STATUS,
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

test("a network failure is reported as an unreachable backend", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };

  try {
    await assert.rejects(fetchHealth(), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, NO_RESPONSE_STATUS);
      assert.match(error.message, /Could not reach the Vodex backend/);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a request that outlives its timeout is reported as a timeout", () => {
  const timeout = new Error("The operation was aborted due to timeout");
  timeout.name = "TimeoutError";

  const described = describeRequestFailure(timeout);
  assert.ok(described instanceof ApiError);
  assert.equal(described.status, TIMEOUT_STATUS);
  assert.match(described.message, /did not respond in time/);
});

test("a deliberate cancellation is passed through untouched", () => {
  const aborted = new Error("The user aborted a request");
  aborted.name = "AbortError";

  assert.equal(describeRequestFailure(aborted), aborted);
});

test("a non-JSON success response is reported as a request failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("<html>proxy error</html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });

  try {
    await assert.rejects(fetchHealth(), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.match(error.message, /unreadable response/);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
