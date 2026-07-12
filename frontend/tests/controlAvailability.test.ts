import assert from "node:assert/strict";
import test from "node:test";

import {
  blockingVoiceActivity,
  hasActiveBackgroundJob,
  isRequestUnavailable,
  isVoiceControlDisabled,
} from "../src/utils/controlAvailability.ts";

test("request availability respects backend state and chat mode", () => {
  assert.equal(isRequestUnavailable("missing_key", "agent"), true);
  assert.equal(isRequestUnavailable("missing_key", "codex"), false);
  assert.equal(isRequestUnavailable("offline", "agent"), true);
  assert.equal(isRequestUnavailable("offline", "codex"), true);
  assert.equal(isRequestUnavailable("checking", "agent"), true);
  assert.equal(isRequestUnavailable("checking", "codex"), true);
  assert.equal(isRequestUnavailable("ready", "agent"), false);
});

test("inactive voice requires a project, an idle foreground, and a ready backend", () => {
  const base = { voiceActive: false, hasProject: true, busy: false, statusKind: "ready" as const };
  assert.equal(isVoiceControlDisabled(base), false);
  assert.equal(isVoiceControlDisabled({ ...base, hasProject: false }), true);
  assert.equal(isVoiceControlDisabled({ ...base, busy: true }), true);
  assert.equal(isVoiceControlDisabled({ ...base, statusKind: "offline" }), true);
});

test("an active voice session can always be stopped", () => {
  assert.equal(
    isVoiceControlDisabled({
      voiceActive: true,
      hasProject: false,
      busy: true,
      statusKind: "offline",
    }),
    false,
  );
});

test("an active background job prevents its chat from being cleared", () => {
  const baseMessage = { id: "assistant-a", role: "assistant" as const, text: "Working" };

  assert.equal(
    hasActiveBackgroundJob([{ ...baseMessage, backgroundJobId: "job-a", streaming: true }]),
    true,
  );
  assert.equal(
    hasActiveBackgroundJob([{ ...baseMessage, backgroundJobId: "job-a", streaming: false }]),
    false,
  );
  assert.equal(hasActiveBackgroundJob([{ ...baseMessage, streaming: true }]), false);
});

test("voice activity blocks changes only to its attached scope", () => {
  const voiceScope = { projectId: "project-a", chatId: "chat-a" };
  const options = { voiceActive: true, voiceScope, backgroundJobScope: null };

  assert.equal(blockingVoiceActivity({ ...options, projectId: "project-a" }), "voice");
  assert.equal(
    blockingVoiceActivity({ ...options, projectId: "project-a", chatId: "chat-a" }),
    "voice",
  );
  assert.equal(
    blockingVoiceActivity({ ...options, projectId: "project-a", chatId: "chat-b" }),
    null,
  );
});

test("a voice-started background job blocks its scope after voice closes", () => {
  const backgroundJobScope = { projectId: "project-a", chatId: "chat-a" };

  assert.equal(
    blockingVoiceActivity({
      projectId: "project-a",
      chatId: "chat-a",
      voiceActive: false,
      voiceScope: null,
      backgroundJobScope,
    }),
    "job",
  );
});
