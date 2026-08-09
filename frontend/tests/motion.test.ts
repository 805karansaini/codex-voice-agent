import assert from "node:assert/strict";
import test from "node:test";

import { prefersReducedMotion, scrollBehavior } from "../src/utils/motion.ts";

function viewMatching(matches: boolean, seen: string[] = []) {
  return {
    matchMedia: (query: string) => {
      seen.push(query);
      return { matches } as MediaQueryList;
    },
  };
}

test("prefersReducedMotion reads the reduce query", () => {
  const seen: string[] = [];
  assert.equal(prefersReducedMotion(viewMatching(true, seen)), true);
  assert.deepEqual(seen, ["(prefers-reduced-motion: reduce)"]);
});

test("prefersReducedMotion allows motion when the viewer has no preference", () => {
  assert.equal(prefersReducedMotion(viewMatching(false)), false);
});

test("prefersReducedMotion allows motion when matchMedia is unavailable", () => {
  assert.equal(prefersReducedMotion({}), false);
});

test("prefersReducedMotion allows motion when matchMedia throws", () => {
  assert.equal(
    prefersReducedMotion({
      matchMedia: () => {
        throw new Error("unsupported query");
      },
    }),
    false,
  );
});

test("scrollBehavior downgrades smooth scrolling when motion is reduced", () => {
  assert.equal(scrollBehavior("smooth", viewMatching(true)), "auto");
});

test("scrollBehavior keeps smooth scrolling when motion is allowed", () => {
  assert.equal(scrollBehavior("smooth", viewMatching(false)), "smooth");
});

test("scrollBehavior never consults the media query for instant scrolling", () => {
  const seen: string[] = [];
  assert.equal(scrollBehavior("auto", viewMatching(true, seen)), "auto");
  assert.deepEqual(seen, []);
});
