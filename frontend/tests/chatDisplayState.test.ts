import assert from "node:assert/strict";
import test from "node:test";

import {
  codingAgentWorkingName,
  codingAgentWorkingTitle,
} from "../src/hooks/useChatDisplayState.ts";

test("Claude work uses the Claudex live status name", () => {
  assert.equal(codingAgentWorkingName("claude"), "Claudex");
  assert.equal(codingAgentWorkingName("codex"), "Codex");
  assert.equal(codingAgentWorkingTitle("claude", 28), "Claudex is working (0:28)");
});
