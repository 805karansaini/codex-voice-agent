import assert from "node:assert/strict";
import test from "node:test";

import {
  backendRecoveryIsReady,
  backendRecoverySucceeded,
  shouldAttemptBackendRecovery,
} from "../src/utils/backendRecovery.ts";

test("backend recovery waits through offline and checking states", () => {
  assert.equal(shouldAttemptBackendRecovery(true, "offline", false), false);
  assert.equal(shouldAttemptBackendRecovery(true, "checking", false), false);
  assert.equal(shouldAttemptBackendRecovery(true, "ready", false), true);
  assert.equal(shouldAttemptBackendRecovery(true, "missing_key", false), true);
});

test("startup readiness and in-flight refreshes do not duplicate recovery", () => {
  assert.equal(shouldAttemptBackendRecovery(false, "ready", false), false);
  assert.equal(shouldAttemptBackendRecovery(true, "ready", true), false);
  assert.equal(backendRecoveryIsReady("ready"), true);
});

test("backend recovery completes only after workspace and models both load", () => {
  assert.equal(backendRecoverySucceeded(true, true), true);
  assert.equal(backendRecoverySucceeded(true, false), false);
  assert.equal(backendRecoverySucceeded(false, true), false);
  assert.equal(backendRecoverySucceeded(false, false), false);
});
