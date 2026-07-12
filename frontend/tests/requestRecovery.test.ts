import assert from "node:assert/strict";
import test from "node:test";

import {
  failedSubmissionForScope,
  failedSubmissionsForScope,
  withFailedSubmission,
  withoutFailedSubmission,
  withoutFailedSubmissionsForProject,
  type ChatSubmission,
  type FailedChatSubmissions,
} from "../src/utils/requestRecovery.ts";

function submission(projectId: string, chatId: string, text: string): ChatSubmission {
  return {
    text,
    project: {
      id: projectId,
      name: projectId,
      path: `/tmp/${projectId}`,
      color: "#fff",
      createdAt: 1,
    },
    chatId,
    userMessageId: `${chatId}-message`,
    mode: "codex",
  };
}

test("failed requests stay attached to their originating project and chat", () => {
  const failedInA = submission("project-a", "chat-a", "change A");
  const failures = withFailedSubmission({}, failedInA, "connection ended");

  assert.equal(failedSubmissionForScope(failures, "project-a", "chat-a")?.text, "change A");
  assert.equal(failedSubmissionForScope(failures, "project-a", "chat-b"), null);
  assert.equal(failedSubmissionForScope(failures, "project-b", "chat-a"), null);
});

test("clearing another chat does not erase an originating chat failure", () => {
  let failures: FailedChatSubmissions = {};
  failures = withFailedSubmission(failures, submission("project-a", "chat-a", "change A"), "A");
  failures = withFailedSubmission(failures, submission("project-a", "chat-b", "change B"), "B");

  const failedB = failedSubmissionForScope(failures, "project-a", "chat-b");
  assert.ok(failedB);
  const afterClearingB = withoutFailedSubmission(
    failures,
    "project-a",
    "chat-b",
    failedB.userMessageId,
  );
  assert.equal(failedSubmissionForScope(afterClearingB, "project-a", "chat-a")?.errorMessage, "A");
  assert.equal(failedSubmissionForScope(afterClearingB, "project-a", "chat-b"), null);
});

test("multiple failures in one chat are retained and reviewed one at a time", () => {
  let failures: FailedChatSubmissions = {};
  const first = submission("project-a", "chat-a", "first request");
  const second = {
    ...submission("project-a", "chat-a", "second request"),
    userMessageId: "second-message",
  };
  failures = withFailedSubmission(failures, first, "first failed");
  failures = withFailedSubmission(failures, second, "second failed");

  assert.deepEqual(
    failedSubmissionsForScope(failures, "project-a", "chat-a").map((item) => item.text),
    ["first request", "second request"],
  );

  const afterReviewingFirst = withoutFailedSubmission(
    failures,
    "project-a",
    "chat-a",
    first.userMessageId,
  );
  assert.equal(
    failedSubmissionForScope(afterReviewingFirst, "project-a", "chat-a")?.text,
    "second request",
  );
});

test("a background failure remains available after navigating away and back", () => {
  const backgroundFailure = withFailedSubmission(
    {},
    submission("project-a", "chat-a", "background A"),
    "job failed",
  );

  assert.equal(failedSubmissionForScope(backgroundFailure, "project-b", "chat-b"), null);
  assert.equal(
    failedSubmissionForScope(backgroundFailure, "project-a", "chat-a")?.errorMessage,
    "job failed",
  );
});

test("removing a project clears only failures owned by that project", () => {
  let failures: FailedChatSubmissions = {};
  failures = withFailedSubmission(failures, submission("project-a", "chat-a", "A"), "A");
  failures = withFailedSubmission(failures, submission("project-b", "chat-b", "B"), "B");

  const remaining = withoutFailedSubmissionsForProject(failures, "project-a");
  assert.equal(failedSubmissionForScope(remaining, "project-a", "chat-a"), null);
  assert.equal(failedSubmissionForScope(remaining, "project-b", "chat-b")?.text, "B");
});
