import assert from "node:assert/strict";
import test from "node:test";

import { makeFileTree, mergeFileEntries } from "../src/utils/projectFiles.ts";
import type { ProjectFileEntry } from "../src/types.ts";

test("makeFileTree builds a folder-first tree without mutating source entries", () => {
  const entries: ProjectFileEntry[] = [
    { path: "README.md", is_directory: false },
    { path: "src/index.ts", is_directory: false },
    { path: "src", is_directory: true },
  ];
  const original = structuredClone(entries);

  const tree = makeFileTree(entries);

  assert.deepEqual(entries, original);
  assert.deepEqual(
    tree.map((item) => item.path),
    ["src", "README.md"],
  );
  assert.deepEqual(
    tree[0]?.children.map((item) => item.path),
    ["src/index.ts"],
  );
});

test("mergeFileEntries replaces duplicate paths and preserves unique entries", () => {
  assert.deepEqual(
    mergeFileEntries(
      [
        { path: "src", is_directory: false },
        { path: "README.md", is_directory: false },
      ],
      [
        { path: "src", is_directory: true },
        { path: "src/index.ts", is_directory: false },
      ],
    ),
    [
      { path: "src", is_directory: true },
      { path: "README.md", is_directory: false },
      { path: "src/index.ts", is_directory: false },
    ],
  );
});
