import assert from "node:assert/strict";
import test from "node:test";

import { appendArtifacts, changeArtifacts } from "../src/utils/artifacts.ts";
import type { ChatArtifact } from "../src/types.ts";

function artifact(id: string, patch: Partial<ChatArtifact> = {}): ChatArtifact {
  return {
    id,
    title: `Artifact ${id}`,
    summary: "",
    content: "",
    content_type: "text",
    source: "codex",
    ...patch,
  };
}

test("appendArtifacts skips missing artifacts and preserves existing order", () => {
  const first = artifact("a");
  const second = artifact("b");

  assert.deepEqual(appendArtifacts(undefined, null, first, undefined, second), [first, second]);
});

test("appendArtifacts deduplicates by artifact id", () => {
  const first = artifact("a", { title: "original" });
  const duplicate = artifact("a", { title: "duplicate" });
  const second = artifact("b");

  assert.deepEqual(appendArtifacts([first], duplicate, second), [first, second]);
});

test("changeArtifacts returns diff artifacts and git diff source artifacts", () => {
  const diff = artifact("diff", { content_type: "diff" });
  const gitDiff = artifact("git", { source: "git_diff" });
  const note = artifact("note", { content_type: "markdown", source: "codex" });

  assert.deepEqual(changeArtifacts([diff, gitDiff, note]), [diff, gitDiff]);
});
