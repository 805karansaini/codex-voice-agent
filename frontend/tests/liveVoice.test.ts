import assert from "node:assert/strict";
import test from "node:test";

import { liveVoiceStartDeliveryFailureMessage } from "../src/utils/liveVoice.ts";
import {
  audioContainsSpeech,
  hasRecentSpeechActivity,
  isClearToReadCompletedResult,
  RECENT_SPEECH_WINDOW_MS,
} from "../src/utils/liveVoiceSpeech.ts";

test("liveVoiceStartDeliveryFailureMessage preserves backend detail", () => {
  assert.equal(
    liveVoiceStartDeliveryFailureMessage("Vodex is still running while Gemini reconnects."),
    "Vodex is still running while Gemini reconnects.",
  );
});

test("liveVoiceStartDeliveryFailureMessage does not claim the task completed", () => {
  assert.match(liveVoiceStartDeliveryFailureMessage(""), /background task start/);
  assert.match(liveVoiceStartDeliveryFailureMessage(undefined), /still running/);
});

test("audioContainsSpeech ignores silent microphone frames", () => {
  assert.equal(audioContainsSpeech(new Float32Array([0, 0.002, -0.01])), false);
  assert.equal(audioContainsSpeech(new Float32Array([0, 0.02, -0.01])), true);
});

test("hasRecentSpeechActivity delays speech only for a short pause after real input", () => {
  const lastSpeechAt = 10_000;

  assert.equal(hasRecentSpeechActivity(lastSpeechAt, lastSpeechAt + 100), true);
  assert.equal(
    hasRecentSpeechActivity(lastSpeechAt, lastSpeechAt + RECENT_SPEECH_WINDOW_MS),
    false,
  );
});

test("a completed result can be read while the microphone is open but the user is idle", () => {
  assert.equal(
    isClearToReadCompletedResult({
      voiceTurnActive: false,
      lastSpeechAt: 0,
      now: 20_000,
    }),
    true,
  );
});

test("a completed result waits for an active conversation and a recent user utterance", () => {
  assert.equal(
    isClearToReadCompletedResult({
      voiceTurnActive: true,
      lastSpeechAt: 0,
      now: 20_000,
    }),
    false,
  );
  assert.equal(
    isClearToReadCompletedResult({
      voiceTurnActive: false,
      lastSpeechAt: 20_000,
      now: 20_100,
    }),
    false,
  );
});
