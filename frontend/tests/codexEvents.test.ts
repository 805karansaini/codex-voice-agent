import assert from "node:assert/strict";
import test from "node:test";

import { appendCodexEvent } from "../src/utils/codexEvents.ts";
import type { CodexTimelineEvent } from "../src/types.ts";

test("appendCodexEvent deduplicates equivalent timeline items", () => {
  const event: CodexTimelineEvent = {
    method: "item/completed",
    item_id: "item-1",
    turn_id: "turn-1",
  };

  const first = appendCodexEvent(undefined, event);
  assert.equal(appendCodexEvent(first, { ...event, summary: "duplicate" }), first);
});

test("appendCodexEvent retains only the most recent timeline items", () => {
  const events = Array.from({ length: 81 }, (_, index) => ({
    method: "item/completed",
    item_id: `item-${index}`,
  }));
  const result = events.reduce<CodexTimelineEvent[]>(appendCodexEvent, []);

  assert.equal(result.length, 80);
  assert.equal(result[0]?.item_id, "item-1");
  assert.equal(result[result.length - 1]?.item_id, "item-80");
});
