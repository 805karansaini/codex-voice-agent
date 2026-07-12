import assert from "node:assert/strict";
import test from "node:test";

import { copyTextToClipboard } from "../src/utils/clipboard.ts";

test("copyTextToClipboard reports success only after the clipboard write finishes", async () => {
  let finishWrite: (() => void) | undefined;
  let settled = false;
  let receivedText = "";

  const result = copyTextToClipboard("copy me", (text) => {
    receivedText = text;
    return new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
  });
  void result.then(() => {
    settled = true;
  });

  await Promise.resolve();
  assert.equal(receivedText, "copy me");
  assert.equal(settled, false);

  finishWrite?.();
  assert.equal(await result, true);
});

test("copyTextToClipboard reports a rejected clipboard write", async () => {
  const result = await copyTextToClipboard("copy me", async () => {
    throw new Error("Clipboard permission denied");
  });

  assert.equal(result, false);
});
