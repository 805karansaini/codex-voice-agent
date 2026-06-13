import { useCallback } from "react";

import * as api from "../services/api";

interface UseClearThreadOptions {
  activeProjectId?: string;
  activeChatId: string | null;
  clearChatThread: (chatId: string) => void;
  clearConsoleState: () => void;
  setError: (message: string) => void;
}

export function useClearThread({
  activeProjectId,
  activeChatId,
  clearChatThread,
  clearConsoleState,
  setError,
}: UseClearThreadOptions) {
  return useCallback(() => {
    if (!activeProjectId || !activeChatId) return;
    clearChatThread(activeChatId);
    clearConsoleState();
    setError("");
    api.deleteConsoleState(activeChatId).catch(() => {});
  }, [activeProjectId, activeChatId, clearChatThread, clearConsoleState, setError]);
}
