import assert from "node:assert/strict";
import test from "node:test";

import { isNearScrollBottom, reconcileScrollListener } from "../src/hooks/useMessageAutoScroll.ts";

test("auto-scroll follows content while the reader remains near the bottom", () => {
  assert.equal(isNearScrollBottom(1_000, 620, 300), true);
  assert.equal(isNearScrollBottom(1_000, 603, 300), false);
});

test("auto-scroll threshold can be tuned for compact views", () => {
  assert.equal(isNearScrollBottom(800, 450, 300, 50), true);
  assert.equal(isNearScrollBottom(800, 449, 300, 50), false);
});

test("scroll listeners move cleanly when the mobile chat section remounts", () => {
  class FakeTarget {
    listeners = new Set<EventListener>();
    addCalls = 0;
    removeCalls = 0;

    addEventListener(_type: string, listener: EventListener) {
      this.addCalls += 1;
      this.listeners.add(listener);
    }

    removeEventListener(_type: string, listener: EventListener) {
      this.removeCalls += 1;
      this.listeners.delete(listener);
    }
  }

  const first = new FakeTarget();
  const replacement = new FakeTarget();
  const listener = () => undefined;
  let attachScrolls = 0;
  let attached = reconcileScrollListener(null, first, listener, () => {
    attachScrolls += 1;
  });

  assert.equal(first.listeners.size, 1);
  assert.equal(attachScrolls, 1);

  attached = reconcileScrollListener(attached, first, listener, () => {
    attachScrolls += 1;
  });
  assert.equal(first.addCalls, 1);
  assert.equal(attachScrolls, 1);

  attached = reconcileScrollListener(attached, replacement, listener, () => {
    attachScrolls += 1;
  });
  assert.equal(first.listeners.size, 0);
  assert.equal(replacement.listeners.size, 1);
  assert.equal(attachScrolls, 2);

  reconcileScrollListener(attached, null, listener);
  assert.equal(replacement.listeners.size, 0);
  assert.equal(replacement.removeCalls, 1);
});
