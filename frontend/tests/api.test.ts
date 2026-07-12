import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, fetchHealth } from "../src/services/api.ts";

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
