import { useCallback } from "react";

import * as api from "../services/api";

interface UseChatExportOptions {
  activeChatId: string | null;
  setError: (message: string) => void;
}

export function useChatExport({ activeChatId, setError }: UseChatExportOptions) {
  return useCallback(async () => {
    if (!activeChatId) return;
    try {
      const { blob, filename } = await api.exportChatMarkdown(activeChatId);
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export chat");
    }
  }, [activeChatId, setError]);
}
