import assert from "node:assert/strict";
import test from "node:test";

import {
  consoleStateForChat,
  updateConsoleAction,
  updateConsoleStateForChat,
  type ConsoleSessions,
} from "../src/utils/consoleSessions.ts";

const runningAction = {
  id: "action-a",
  title: "Background task",
  status: "running" as const,
  detail: "Working in A",
};

test("background telemetry updates its originating chat without touching the active chat", () => {
  let sessions: ConsoleSessions = {
    "chat-a": { actions: [runningAction], handoffs: [], debugEntries: [] },
    "chat-b": { actions: [], handoffs: [], debugEntries: [] },
  };

  sessions = updateConsoleStateForChat(sessions, "chat-a", (state) => ({
    ...updateConsoleAction(state, "action-a", { status: "done" }),
    handoffs: [{ id: "handoff-a", name: "background_codex", summary: "Finished A" }],
  }));

  assert.equal(consoleStateForChat(sessions, "chat-a").actions[0]?.status, "done");
  assert.equal(consoleStateForChat(sessions, "chat-a").handoffs[0]?.summary, "Finished A");
  assert.deepEqual(consoleStateForChat(sessions, "chat-b"), {
    actions: [],
    handoffs: [],
    debugEntries: [],
  });
});

test("chat updates retain other cached chat sessions", () => {
  const sessions: ConsoleSessions = {
    "chat-a": { actions: [runningAction], handoffs: [], debugEntries: [] },
    "chat-b": { actions: [], handoffs: [], debugEntries: [] },
  };
  const updated = updateConsoleStateForChat(sessions, "chat-b", (state) => ({
    ...state,
    debugEntries: [{ id: "debug-b", time: "12:00:00", message: "B only" }],
  }));

  assert.equal(consoleStateForChat(updated, "chat-a").actions[0]?.id, "action-a");
  assert.equal(consoleStateForChat(updated, "chat-b").debugEntries[0]?.message, "B only");
});
