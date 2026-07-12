import assert from "node:assert/strict";
import test from "node:test";

import type { CodexModel } from "../src/types.ts";
import {
  defaultCodexModel,
  defaultReasoningEffort,
  reconcileCodexSelection,
} from "../src/utils/codexModels.ts";

const model = (overrides: Partial<CodexModel> = {}): CodexModel => ({
  id: "model-1",
  model: "model-1",
  displayName: "Model 1",
  supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }],
  ...overrides,
});

test("defaultCodexModel prefers the server default and falls back to the first model", () => {
  const first = model();
  const preferred = model({ id: "model-2", model: "model-2", isDefault: true });

  assert.equal(defaultCodexModel([first, preferred]), preferred);
  assert.equal(defaultCodexModel([first]), first);
  assert.equal(defaultCodexModel([]), undefined);
});

test("defaultReasoningEffort only returns an effort supported by the model", () => {
  assert.equal(defaultReasoningEffort(model({ defaultReasoningEffort: "high" })), "high");
  assert.equal(defaultReasoningEffort(model({ defaultReasoningEffort: "medium" })), "low");
  assert.equal(defaultReasoningEffort(model({ supportedReasoningEfforts: [] })), "");
  assert.equal(defaultReasoningEffort(undefined), "");
});

test("model refresh preserves a still-supported user selection", () => {
  const first = model({ defaultReasoningEffort: "low" });
  const second = model({ id: "model-2", model: "model-2", defaultReasoningEffort: "low" });

  assert.deepEqual(reconcileCodexSelection([first, second], "model-2", "high"), {
    model: "model-2",
    reasoningEffort: "high",
  });
});

test("model refresh falls back when a selection is no longer available", () => {
  const preferred = model({ isDefault: true, defaultReasoningEffort: "high" });

  assert.deepEqual(reconcileCodexSelection([preferred], "removed-model", "medium"), {
    model: "model-1",
    reasoningEffort: "high",
  });
  assert.deepEqual(reconcileCodexSelection([], "removed-model", "high"), {
    model: "",
    reasoningEffort: "",
  });
});
