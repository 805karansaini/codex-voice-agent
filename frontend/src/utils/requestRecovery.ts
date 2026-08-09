import type { ChatMode, CodingHarness, Project } from "../types";

export type FailedChatSubmission = {
  text: string;
  project: Project;
  chatId: string;
  userMessageId: string;
  mode: ChatMode;
  harness?: CodingHarness;
  model?: string;
  reasoningEffort?: string;
  errorMessage: string;
};

export type ChatSubmission = Omit<FailedChatSubmission, "errorMessage">;
export type FailedChatSubmissions = Record<string, FailedChatSubmission[]>;

function submissionScopeKey(projectId: string, chatId: string): string {
  return `${projectId}:${chatId}`;
}

export function failedSubmissionsForScope(
  submissions: FailedChatSubmissions,
  projectId: string | null | undefined,
  chatId: string | null | undefined,
): FailedChatSubmission[] {
  if (!projectId || !chatId) return [];
  return submissions[submissionScopeKey(projectId, chatId)] || [];
}

export function failedSubmissionForScope(
  submissions: FailedChatSubmissions,
  projectId: string | null | undefined,
  chatId: string | null | undefined,
): FailedChatSubmission | null {
  return failedSubmissionsForScope(submissions, projectId, chatId)[0] || null;
}

export function withFailedSubmission(
  submissions: FailedChatSubmissions,
  submission: ChatSubmission,
  errorMessage: string,
): FailedChatSubmissions {
  const key = submissionScopeKey(submission.project.id, submission.chatId);
  const failure = {
    ...submission,
    errorMessage: errorMessage || "The request did not complete.",
  };
  const existing = submissions[key] || [];
  const existingIndex = existing.findIndex(
    (item) => item.userMessageId === submission.userMessageId,
  );
  const nextFailures =
    existingIndex < 0
      ? [...existing, failure]
      : existing.map((item, index) => (index === existingIndex ? failure : item));
  return {
    ...submissions,
    [key]: nextFailures,
  };
}

export function withoutFailedSubmission(
  submissions: FailedChatSubmissions,
  projectId: string,
  chatId: string,
  userMessageId: string,
): FailedChatSubmissions {
  const key = submissionScopeKey(projectId, chatId);
  const existing = submissions[key] || [];
  const remaining = existing.filter((item) => item.userMessageId !== userMessageId);
  if (remaining.length === existing.length) return submissions;
  const next = { ...submissions };
  if (remaining.length === 0) delete next[key];
  else next[key] = remaining;
  return next;
}

export function withoutFailedSubmissionsForScope(
  submissions: FailedChatSubmissions,
  projectId: string,
  chatId: string,
): FailedChatSubmissions {
  const key = submissionScopeKey(projectId, chatId);
  if (!(key in submissions)) return submissions;
  const next = { ...submissions };
  delete next[key];
  return next;
}

export function withoutFailedSubmissionsForProject(
  submissions: FailedChatSubmissions,
  projectId: string,
): FailedChatSubmissions {
  const entries = Object.entries(submissions).filter(([, failures]) =>
    failures.every((submission) => submission.project.id !== projectId),
  );
  return entries.length === Object.keys(submissions).length
    ? submissions
    : Object.fromEntries(entries);
}
