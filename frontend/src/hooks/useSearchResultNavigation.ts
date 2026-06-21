import type { MobileView } from "./useAppLayout";
import { Chat, SearchResult } from "../types";

export function useSearchResultNavigation({
  chats,
  selectChat,
  clearSearch,
  isMobile,
  setMobileView,
}: {
  chats: Record<string, Chat[]>;
  selectChat: (projectId: string, chatId: string) => void;
  clearSearch: () => void;
  isMobile: boolean;
  setMobileView: (view: MobileView) => void;
}) {
  return (result: SearchResult) => {
    if (!result.chat_id) return;
    let projectId = result.project_id || "";
    if (!projectId) {
      for (const [candidateProjectId, projectChats] of Object.entries(chats)) {
        if (projectChats.some((chat) => chat.id === result.chat_id)) {
          projectId = candidateProjectId;
          break;
        }
      }
    }
    if (!projectId) return;
    selectChat(projectId, result.chat_id);
    clearSearch();
    if (isMobile) setMobileView("chat");
  };
}
