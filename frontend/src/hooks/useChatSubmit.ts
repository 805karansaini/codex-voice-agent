import { useCallback, useState } from "react";

import type { useProjectStore } from "./useProjectStore";
import type { ChatMode, CodingHarness, Project } from "../types";
import { chatTitleFrom } from "../utils";
import {
  type ChatSubmission,
  type FailedChatSubmissions,
  withFailedSubmission,
  withoutFailedSubmission,
  withoutFailedSubmissionsForScope,
  withoutFailedSubmissionsForProject,
} from "../utils/requestRecovery";

type ProjectStore = ReturnType<typeof useProjectStore>;

type UseChatSubmitOptions = {
  input: string;
  mode: ChatMode;
  resetComposer: () => void;
  store: ProjectStore;
  streamAgent: (
    message: string,
    project: Project,
    chatId: string,
    harness: CodingHarness,
    model?: string,
    reasoningEffort?: string,
  ) => Promise<void>;
  streamCodex: (
    task: string,
    project: Project,
    chatId: string,
    userMessageId: string,
    harness: CodingHarness,
    model?: string,
    reasoningEffort?: string,
    onBackgroundFailure?: (message: string) => void,
  ) => Promise<void>;
  codexModel?: string;
  codexReasoningEffort?: string;
  codingHarness: CodingHarness;
  activeAbortControllerRef: { current: AbortController | null };
  setError: (message: string) => void;
};

export function useChatSubmit({
  input,
  mode,
  resetComposer,
  store,
  streamAgent,
  streamCodex,
  activeAbortControllerRef,
  setError,
  codexModel,
  codexReasoningEffort,
  codingHarness,
}: UseChatSubmitOptions) {
  const [busy, setBusy] = useState(false);
  const [busyChatId, setBusyChatId] = useState("");
  const [failedSubmissions, setFailedSubmissions] = useState<FailedChatSubmissions>({});

  const recordFailedSubmission = useCallback((submission: ChatSubmission, errorMessage: string) => {
    setFailedSubmissions((current) => withFailedSubmission(current, submission, errorMessage));
  }, []);

  const runSubmission = useCallback(
    async (submission: ChatSubmission) => {
      setError("");
      setBusy(true);
      setBusyChatId(submission.chatId);

      try {
        if (submission.mode === "codex") {
          await streamCodex(
            submission.text,
            submission.project,
            submission.chatId,
            submission.userMessageId,
            submission.harness || codingHarness,
            submission.model,
            submission.reasoningEffort,
            (message) => recordFailedSubmission(submission, message),
          );
        } else {
          await streamAgent(
            submission.text,
            submission.project,
            submission.chatId,
            submission.harness || codingHarness,
            submission.model,
            submission.reasoningEffort,
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Something went wrong";
        recordFailedSubmission(submission, message);
      } finally {
        activeAbortControllerRef.current = null;
        setBusy(false);
        setBusyChatId("");
      }
    },
    [
      activeAbortControllerRef,
      codingHarness,
      recordFailedSubmission,
      setError,
      streamAgent,
      streamCodex,
    ],
  );

  const send = useCallback(
    async (raw?: string, projectOverride?: Project, chatOverride?: string) => {
      const text = (raw ?? input).trim();
      const project = projectOverride || store.activeProject;
      if (!text || busy || !project) return;

      let chatId = chatOverride || store.activeChatId;
      let createdChatForSend = false;
      if (!chatId) {
        chatId = store.createChat(project.id, { title: chatTitleFrom(text) }).id;
        createdChatForSend = true;
      }

      resetComposer();

      if (!createdChatForSend && (store.messagesByChat[chatId] || []).length === 0) {
        store.renameChat(project.id, chatId, chatTitleFrom(text));
      }

      const userMessageId = crypto.randomUUID();
      store.appendMessage(chatId, {
        id: userMessageId,
        role: "user",
        text,
        workdir: project.path,
      });

      await runSubmission({
        text,
        project,
        chatId,
        userMessageId,
        mode,
        harness: codingHarness,
        model: codexModel,
        reasoningEffort: codexReasoningEffort,
      });
    },
    [
      busy,
      codingHarness,
      codexModel,
      codexReasoningEffort,
      input,
      mode,
      resetComposer,
      runSubmission,
      store,
    ],
  );

  const clearFailedSubmission = useCallback(
    (projectId: string, chatId: string, userMessageId: string) => {
      setFailedSubmissions((current) =>
        withoutFailedSubmission(current, projectId, chatId, userMessageId),
      );
    },
    [],
  );

  const clearFailedSubmissionsForScope = useCallback((projectId: string, chatId: string) => {
    setFailedSubmissions((current) => withoutFailedSubmissionsForScope(current, projectId, chatId));
  }, []);

  const clearFailedSubmissionsForProject = useCallback((projectId: string) => {
    setFailedSubmissions((current) => withoutFailedSubmissionsForProject(current, projectId));
  }, []);

  return {
    busy,
    busyChatId,
    failedSubmissions,
    send,
    clearFailedSubmission,
    clearFailedSubmissionsForScope,
    clearFailedSubmissionsForProject,
  };
}
