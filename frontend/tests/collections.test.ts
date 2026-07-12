import assert from "node:assert/strict";
import test from "node:test";

import { mergeUniqueById, reconcileLoadedById } from "../src/utils/collections.ts";

test("mergeUniqueById preserves optimistic items while adding loaded items", () => {
  const optimistic = [{ id: "local", value: "new" }];
  const loaded = [
    { id: "saved", value: "server" },
    { id: "local", value: "stale snapshot" },
  ];

  assert.deepEqual(mergeUniqueById(optimistic, loaded), [
    { id: "local", value: "new" },
    { id: "saved", value: "server" },
  ]);
});

test("reconcileLoadedById keeps activity added while hydration was pending", () => {
  assert.deepEqual(
    reconcileLoadedById([{ id: "saved", value: "older" }], [{ id: "local", value: "running" }], {
      hasLocalChanges: true,
      wasCleared: false,
    }),
    [
      { id: "local", value: "running" },
      { id: "saved", value: "older" },
    ],
  );
});

test("reconcileLoadedById does not restore entries cleared during hydration", () => {
  assert.deepEqual(
    reconcileLoadedById([{ id: "saved" }], [], {
      hasLocalChanges: true,
      wasCleared: true,
    }),
    [],
  );
});
