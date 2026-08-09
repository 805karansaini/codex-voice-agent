import assert from "node:assert/strict";
import test from "node:test";

import { clampWidth, nextResizeWidth } from "../src/utils/panelResize.ts";

const BOUNDS = { min: 200, max: 400 };

test("clampWidth keeps a width inside its bounds", () => {
  assert.equal(clampWidth(300, BOUNDS), 300);
  assert.equal(clampWidth(120, BOUNDS), 200);
  assert.equal(clampWidth(900, BOUNDS), 400);
});

test("a left-docked panel grows when the separator moves right", () => {
  assert.equal(nextResizeWidth(300, "ArrowRight", "grow-right", BOUNDS), 316);
  assert.equal(nextResizeWidth(300, "ArrowLeft", "grow-right", BOUNDS), 284);
});

test("a right-docked panel grows when the separator moves left", () => {
  assert.equal(nextResizeWidth(300, "ArrowLeft", "grow-left", BOUNDS), 316);
  assert.equal(nextResizeWidth(300, "ArrowRight", "grow-left", BOUNDS), 284);
});

test("holding shift resizes in coarser steps", () => {
  assert.equal(nextResizeWidth(300, "ArrowRight", "grow-right", BOUNDS, true), 364);
});

test("resizing stops at the bounds instead of overshooting", () => {
  assert.equal(nextResizeWidth(395, "ArrowRight", "grow-right", BOUNDS), 400);
  assert.equal(nextResizeWidth(205, "ArrowLeft", "grow-right", BOUNDS), 200);
});

test("Home and End jump to the narrowest and widest sizes", () => {
  assert.equal(nextResizeWidth(300, "Home", "grow-right", BOUNDS), 200);
  assert.equal(nextResizeWidth(300, "End", "grow-left", BOUNDS), 400);
});

test("unrelated keys leave the width alone", () => {
  assert.equal(nextResizeWidth(300, "Enter", "grow-right", BOUNDS), null);
  assert.equal(nextResizeWidth(300, "a", "grow-left", BOUNDS), null);
  assert.equal(nextResizeWidth(300, "ArrowUp", "grow-right", BOUNDS), null);
});
