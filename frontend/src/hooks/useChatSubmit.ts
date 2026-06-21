import { useCallback, useState } from "react";

import type { useProjectStore } from "./useProjectStore";
import type { Project } from "../types";
import { chatTitleFrom } from "../utils";

type ProjectStore = ReturnType<typeof useProjectStore>;
type ChatMode = "agent" | "codex";

type UseChatSubmitOptions = {
  input: string;
  mode: ChatMode;
  resetComposer: () => void;
  store: ProjectStore;
  streamAgent: (message: string, project: Project, chatId: string) => Promise<void>;
  streamCodex: (
    task: string,
    project: Project,
    chatId: string,
    userMessageId: string,
  ) => Promise<void>;
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
}: UseChatSubmitOptions) {
  const [busy, setBusy] = useState(false);

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
      setError("");
      setBusy(true);

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

      try {
        if (mode === "codex") {
          await streamCodex(text, project, chatId, userMessageId);
        } else {
          await streamAgent(text, project, chatId);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        activeAbortControllerRef.current = null;
        setBusy(false);
      }
    },
    [
      activeAbortControllerRef,
      busy,
      input,
      mode,
      resetComposer,
      setError,
      store,
      streamAgent,
      streamCodex,
    ],
  );

  return { busy, send };
}
