import assert from "node:assert/strict";
import test from "node:test";

import { isNumberInRange, isOneOf, isStringArrayRecord, loadJSON } from "../src/utils/storage.ts";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });

test("loadJSON accepts valid stored values", () => {
  storage.setItem("theme", JSON.stringify("light"));
  assert.equal(loadJSON("theme", "dark", isOneOf("dark", "light")), "light");
});

test("loadJSON rejects valid JSON with the wrong runtime shape", () => {
  storage.setItem("width", JSON.stringify("wide"));
  storage.setItem("folders", JSON.stringify({ project: ["src", 42] }));

  assert.equal(loadJSON("width", 268, isNumberInRange(180, 420)), 268);
  assert.deepEqual(loadJSON("folders", {}, isStringArrayRecord), {});
});

test("loadJSON rejects out-of-range persisted layout values", () => {
  storage.setItem("width", JSON.stringify(5000));
  assert.equal(loadJSON("width", 268, isNumberInRange(180, 420)), 268);
});
