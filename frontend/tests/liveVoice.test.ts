import assert from "node:assert/strict";
import test from "node:test";

import { liveVoiceDeliveryFailureMessage } from "../src/utils/liveVoice.ts";

test("liveVoiceDeliveryFailureMessage preserves backend detail", () => {
  assert.equal(
    liveVoiceDeliveryFailureMessage("Codex completed, but Gemini Live closed first."),
    "Codex completed, but Gemini Live closed first.",
  );
});

test("liveVoiceDeliveryFailureMessage explains missed Gemini delivery by default", () => {
  assert.match(liveVoiceDeliveryFailureMessage(""), /Gemini reconnected before reading/);
  assert.match(liveVoiceDeliveryFailureMessage(undefined), /next voice session will include it/);
});
