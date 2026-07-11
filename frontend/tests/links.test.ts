import assert from "node:assert/strict";
import test from "node:test";

import { safeExternalUrl } from "../src/utils/links.ts";

test("safeExternalUrl allows normal navigation links", () => {
  assert.equal(safeExternalUrl("https://example.com/docs"), "https://example.com/docs");
  assert.equal(safeExternalUrl("mailto:team@example.com"), "mailto:team@example.com");
  assert.equal(safeExternalUrl("/local/path"), "/local/path");
  assert.equal(safeExternalUrl("#section"), "#section");
  assert.equal(safeExternalUrl("docs/architecture.md"), "docs/architecture.md");
  assert.equal(safeExternalUrl("../components/Panel.tsx"), "../components/Panel.tsx");
});

test("safeExternalUrl rejects executable and malformed links", () => {
  assert.equal(safeExternalUrl("javascript:alert(1)"), null);
  assert.equal(safeExternalUrl("data:text/html,unsafe"), null);
  assert.equal(safeExternalUrl("not a url"), null);
  assert.equal(safeExternalUrl("docs/file name.md"), null);
});
