import { useCallback } from "react";

import * as api from "../services/api";

interface UseClearThreadOptions {
  activeProjectId?: string;
  activeChatId: string | null;
  clearChatThread: (chatId: string) => Promise<boolean>;
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
  return useCallback(async (): Promise<boolean> => {
    if (!activeProjectId || !activeChatId) return false;
    const cleared = await clearChatThread(activeChatId);
    if (!cleared) return false;
    clearConsoleState();
    setError("");
    api.deleteConsoleState(activeChatId).catch(() => {});
    return true;
  }, [activeProjectId, activeChatId, clearChatThread, clearConsoleState, setError]);
}
