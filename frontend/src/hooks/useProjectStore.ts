import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Project, Chat, Message } from "../types";
import * as api from "../services/api";
import { mergeUniqueById } from "../utils/collections";
import { isOneOf, isString, isStringRecord, loadJSON, saveJSON } from "../utils/storage";
import { excludeDeletedChats, excludeDeletedProjects } from "../utils/workspaceReconciliation";
import {
  insertMessageBefore,
  mergeBackendHistoryWithLocalMessages,
  restoreMessagesAfterFailedClear,
} from "../utils/history";

const LS_ACTIVE = "cva.activeProject.v1";
const LS_ACTIVE_CHAT = "cva.activeChat.v1";
const LS_THEME = "cva.theme.v1";

function syncErrorMessage(action: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : "Unknown error";
  return `${action}: ${detail}`;
}

type ChatState = {
  chats: Record<string, Chat[]>;
  activeChat: Record<string, string>;
};

type DeletionState = "pending" | "committed";

export function useProjectStore() {
  const selectionVersionRef = useRef(0);
  const projectsMutationVersionRef = useRef(0);
  const chatsMutationVersionRef = useRef(0);
  const projectDeletionStatesRef = useRef(new Map<string, DeletionState>());
  const chatDeletionStatesRef = useRef(new Map<string, DeletionState>());
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string>(() => loadJSON(LS_ACTIVE, "", isString));
  const [chats, setChats] = useState<ChatState["chats"]>({});
  const [messagesByChat, setMessagesByChat] = useState<Record<string, Message[]>>({});
  const [activeChatByProject, setActiveChatByProject] = useState<ChatState["activeChat"]>(() =>
    loadJSON(LS_ACTIVE_CHAT, {}, isStringRecord),
  );
  const [syncError, setSyncError] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    loadJSON(LS_THEME, "dark", isOneOf("dark", "light")),
  );

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeId) || null,
    [projects, activeId],
  );
  const projectChats = activeProject ? chats[activeProject.id] || [] : [];
  const activeChatId = activeProject ? activeChatByProject[activeProject.id] || "" : "";
  const activeChat = projectChats.find((c) => c.id === activeChatId) || null;
  const messages = activeChatId ? messagesByChat[activeChatId] || [] : [];

  // Local storage persistence
  useEffect(() => saveJSON(LS_ACTIVE, activeId), [activeId]);
  useEffect(() => saveJSON(LS_ACTIVE_CHAT, activeChatByProject), [activeChatByProject]);
  useEffect(() => {
    saveJSON(LS_THEME, theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const loadProjects = useCallback(async (isCancelled: () => boolean = () => false) => {
    const mutationVersion = projectsMutationVersionRef.current;
    try {
      const loadedProjects = await api.fetchProjects();
      if (isCancelled()) return false;
      const serverProjects = excludeDeletedProjects(
        loadedProjects,
        projectDeletionStatesRef.current,
      );
      const hasPendingDeletion = [...projectDeletionStatesRef.current.values()].includes("pending");
      const hasLocalChanges =
        projectsMutationVersionRef.current !== mutationVersion || hasPendingDeletion;
      if (!hasLocalChanges) selectionVersionRef.current += 1;
      setProjects((current) =>
        hasLocalChanges ? mergeUniqueById(current, serverProjects) : serverProjects,
      );
      setActiveId((current) => {
        if (hasLocalChanges && current) return current;
        return serverProjects.some((project) => project.id === current)
          ? current
          : serverProjects[0]?.id || "";
      });
      return true;
    } catch (error: unknown) {
      if (!isCancelled()) {
        setSyncError(syncErrorMessage("Failed to load projects", error));
      }
      return false;
    }
  }, []);

  const loadChats = useCallback(async (isCancelled: () => boolean = () => false) => {
    const mutationVersion = chatsMutationVersionRef.current;
    try {
      const loadedChats = await api.fetchChats();
      if (isCancelled()) return false;
      const serverChats = excludeDeletedChats(
        loadedChats,
        chatDeletionStatesRef.current,
        projectDeletionStatesRef.current,
      );
      const next: Record<string, Chat[]> = {};
      for (const chat of serverChats) {
        next[chat.projectId] = [...(next[chat.projectId] || []), chat];
      }
      for (const projectId of Object.keys(next)) {
        next[projectId] = next[projectId].sort((a, b) => b.createdAt - a.createdAt);
      }
      const hasPendingDeletion =
        [...chatDeletionStatesRef.current.values()].includes("pending") ||
        [...projectDeletionStatesRef.current.values()].includes("pending");
      const hasLocalChanges =
        chatsMutationVersionRef.current !== mutationVersion || hasPendingDeletion;
      setChats((current) => {
        if (!hasLocalChanges) return next;
        const merged = { ...next };
        for (const [projectId, localChats] of Object.entries(current)) {
          merged[projectId] = mergeUniqueById(localChats, next[projectId] || []);
        }
        return merged;
      });
      return true;
    } catch (error: unknown) {
      if (!isCancelled()) {
        setSyncError(syncErrorMessage("Failed to load chats", error));
      }
      return false;
    }
  }, []);

  // Load from backend and expose the same safe reconciliation for reconnects.
  useEffect(() => {
    let cancelled = false;
    void loadProjects(() => cancelled);
    void loadChats(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadChats, loadProjects]);

  const loadHistory = useCallback(
    async (chatId: string, isCancelled: () => boolean = () => false): Promise<boolean> => {
      try {
        const rows = await api.fetchHistory(chatId);
        if (isCancelled()) return false;
        if (chatDeletionStatesRef.current.has(chatId)) return true;
        setMessagesByChat((current) => {
          const localMessages = current[chatId] || [];
          return {
            ...current,
            [chatId]: mergeBackendHistoryWithLocalMessages(rows, localMessages),
          };
        });
        return true;
      } catch (error: unknown) {
        if (!isCancelled()) {
          setSyncError(syncErrorMessage("Failed to load chat history", error));
        }
        return false;
      }
    },
    [],
  );

  // Hydrate chat history when active chat changes.
  useEffect(() => {
    if (!activeChatId) return;
    let cancelled = false;
    void loadHistory(activeChatId, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [activeChatId, loadHistory]);

  const refreshWorkspace = useCallback(async (): Promise<boolean> => {
    const [projectsLoaded, chatsLoaded, historyLoaded] = await Promise.all([
      loadProjects(),
      loadChats(),
      activeChatId ? loadHistory(activeChatId) : Promise.resolve(true),
    ]);
    return projectsLoaded && chatsLoaded && historyLoaded;
  }, [activeChatId, loadChats, loadHistory, loadProjects]);

  const createChat = useCallback(
    (projectId: string, opts?: { title?: string; activate?: boolean }) => {
      chatsMutationVersionRef.current += 1;
      const previousActiveId = activeId;
      const previousActiveChat = activeChatByProject[projectId] || "";
      const shouldActivate = opts?.activate !== false;
      const selectionVersion = shouldActivate ? ++selectionVersionRef.current : null;
      const chat: Chat = {
        id: crypto.randomUUID(),
        projectId,
        title: opts?.title || "New chat",
        createdAt: Date.now(),
      };
      setChats((current) => ({
        ...current,
        [projectId]: [chat, ...(current[projectId] || [])],
      }));
      setMessagesByChat((current) => ({ ...current, [chat.id]: [] }));
      if (shouldActivate) {
        setActiveChatByProject((current) => ({ ...current, [projectId]: chat.id }));
        setActiveId(projectId);
      }
      api.saveChat(chat).catch((error: unknown) => {
        setSyncError(syncErrorMessage("Failed to save chat", error));
        setChats((current) => ({
          ...current,
          [projectId]: (current[projectId] || []).filter((item) => item.id !== chat.id),
        }));
        setMessagesByChat((current) => {
          const next = { ...current };
          delete next[chat.id];
          return next;
        });
        if (selectionVersionRef.current === selectionVersion) {
          setActiveChatByProject((current) =>
            current[projectId] === chat.id
              ? { ...current, [projectId]: previousActiveChat }
              : current,
          );
          setActiveId((current) => (current === projectId ? previousActiveId : current));
        }
      });
      return chat;
    },
    [activeChatByProject, activeId, setActiveId],
  );

  useEffect(() => {
    if (!activeProject) return;
    const list = chats[activeProject.id] || [];
    const currentChatId = activeChatByProject[activeProject.id] || "";
    const nextChatId = list[0]?.id || "";
    if (!list.some((c) => c.id === currentChatId) && currentChatId !== nextChatId) {
      setActiveChatByProject((current) => ({
        ...current,
        [activeProject.id]: nextChatId,
      }));
    }
  }, [activeProject, chats, activeChatByProject]);

  const selectChat = useCallback(
    (projectId: string, chatId: string) => {
      selectionVersionRef.current += 1;
      setActiveChatByProject((current) => ({ ...current, [projectId]: chatId }));
      setActiveId(projectId);
    },
    [setActiveId],
  );

  const renameChat = useCallback(
    (projectId: string, chatId: string, title: string) => {
      const clean = title.trim();
      if (!clean) return;
      const previous = (chats[projectId] || []).find((chat) => chat.id === chatId);
      if (!previous || previous.title === clean) return;
      chatsMutationVersionRef.current += 1;
      const updated = { ...previous, title: clean };

      setChats((current) => ({
        ...current,
        [projectId]: (current[projectId] || []).map((chat) =>
          chat.id === chatId ? updated : chat,
        ),
      }));
      api.saveChat(updated).catch((error: unknown) => {
        setSyncError(syncErrorMessage("Failed to rename chat", error));
        setChats((current) => ({
          ...current,
          [projectId]: (current[projectId] || []).map((chat) =>
            chat.id === chatId && chat.title === clean ? previous : chat,
          ),
        }));
      });
    },
    [chats],
  );

  const removeChat = useCallback(
    async (projectId: string, chatId: string): Promise<boolean> => {
      chatsMutationVersionRef.current += 1;
      chatDeletionStatesRef.current.set(chatId, "pending");
      window.speechSynthesis?.cancel();
      const previousChat = (chats[projectId] || []).find((chat) => chat.id === chatId);
      const previousActiveChat = activeChatByProject[projectId] || "";
      const changedSelection = previousActiveChat === chatId;
      const selectionVersion = changedSelection ? ++selectionVersionRef.current : null;
      setChats((current) => ({
        ...current,
        [projectId]: (current[projectId] || []).filter((c) => c.id !== chatId),
      }));
      setActiveChatByProject((current) =>
        current[projectId] === chatId ? { ...current, [projectId]: "" } : current,
      );
      try {
        await api.deleteChat(chatId);
        chatDeletionStatesRef.current.set(chatId, "committed");
        chatsMutationVersionRef.current += 1;
        setMessagesByChat((current) => {
          const next = { ...current };
          delete next[chatId];
          return next;
        });
        return true;
      } catch (error: unknown) {
        chatDeletionStatesRef.current.delete(chatId);
        chatsMutationVersionRef.current += 1;
        setSyncError(syncErrorMessage("Failed to delete chat", error));
        if (previousChat) {
          setChats((current) => ({
            ...current,
            [projectId]: [
              previousChat,
              ...(current[projectId] || []).filter((chat) => chat.id !== previousChat.id),
            ].sort((a, b) => b.createdAt - a.createdAt),
          }));
        }
        if (selectionVersionRef.current === selectionVersion) {
          setActiveChatByProject((current) => ({ ...current, [projectId]: previousActiveChat }));
        }
        return false;
      }
    },
    [activeChatByProject, chats],
  );

  const createProject = useCallback(
    (p: Omit<Project, "id" | "createdAt">) => {
      projectsMutationVersionRef.current += 1;
      const previousActiveId = activeId;
      selectionVersionRef.current += 1;
      const project: Project = {
        ...p,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
      };
      setProjects((current) => [project, ...current]);
      setActiveId(project.id);
      api.saveProject(project).catch((error: unknown) => {
        setSyncError(syncErrorMessage("Failed to save project", error));
        setProjects((current) => current.filter((item) => item.id !== project.id));
        setActiveId((current) => (current === project.id ? previousActiveId : current));
      });
    },
    [activeId],
  );

  const removeProject = useCallback(
    async (id: string): Promise<boolean> => {
      projectsMutationVersionRef.current += 1;
      chatsMutationVersionRef.current += 1;
      projectDeletionStatesRef.current.set(id, "pending");
      const previousProject = projects.find((project) => project.id === id);
      const previousChats = chats[id] || [];
      const previousActiveId = activeId;
      const changedSelection = activeId === id;
      const selectionVersion = changedSelection ? ++selectionVersionRef.current : null;
      const previousActiveChat = activeChatByProject[id] || "";
      const chatIds = new Set((chats[id] || []).map((c) => c.id));
      const previousChatDeletionStates = new Map(
        [...chatIds].map((chatId) => [chatId, chatDeletionStatesRef.current.get(chatId)]),
      );
      for (const chatId of chatIds) chatDeletionStatesRef.current.set(chatId, "pending");
      setProjects((current) => current.filter((p) => p.id !== id));
      setChats((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setActiveChatByProject((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setActiveId((current) => (current === id ? "" : current));
      try {
        await api.deleteProject(id);
        projectDeletionStatesRef.current.set(id, "committed");
        for (const chatId of chatIds) chatDeletionStatesRef.current.set(chatId, "committed");
        projectsMutationVersionRef.current += 1;
        chatsMutationVersionRef.current += 1;
        setMessagesByChat((current) => {
          const next: Record<string, Message[]> = {};
          for (const [chatId, messages] of Object.entries(current)) {
            if (!chatIds.has(chatId)) next[chatId] = messages;
          }
          return next;
        });
        return true;
      } catch (error: unknown) {
        projectDeletionStatesRef.current.delete(id);
        for (const [chatId, previousState] of previousChatDeletionStates) {
          if (previousState) chatDeletionStatesRef.current.set(chatId, previousState);
          else chatDeletionStatesRef.current.delete(chatId);
        }
        projectsMutationVersionRef.current += 1;
        chatsMutationVersionRef.current += 1;
        setSyncError(syncErrorMessage("Failed to delete project", error));
        if (previousProject) {
          setProjects((current) =>
            [
              previousProject,
              ...current.filter((project) => project.id !== previousProject.id),
            ].sort((a, b) => b.createdAt - a.createdAt),
          );
        }
        setChats((current) => ({ ...current, [id]: previousChats }));
        setActiveChatByProject((current) => ({ ...current, [id]: previousActiveChat }));
        if (selectionVersionRef.current === selectionVersion) {
          setActiveId(previousActiveId);
        }
        return false;
      }
    },
    [activeChatByProject, activeId, chats, projects],
  );

  const clearChatThread = useCallback(
    async (chatId: string): Promise<boolean> => {
      window.speechSynthesis?.cancel();
      const previousMessages = messagesByChat[chatId] || [];
      setMessagesByChat((current) => ({ ...current, [chatId]: [] }));
      try {
        await api.deleteHistory(chatId);
        return true;
      } catch (error: unknown) {
        setSyncError(syncErrorMessage("Failed to clear chat history", error));
        setMessagesByChat((current) => ({
          ...current,
          [chatId]: restoreMessagesAfterFailedClear(previousMessages, current[chatId] || []),
        }));
        return false;
      }
    },
    [messagesByChat],
  );

  const appendMessage = useCallback((chatId: string, msg: Message) => {
    if (chatDeletionStatesRef.current.get(chatId) === "committed") return;
    setMessagesByChat((current) => ({
      ...current,
      [chatId]: [...(current[chatId] || []), msg],
    }));
  }, []);

  const insertMessage = useCallback((chatId: string, msg: Message, beforeId?: string | null) => {
    if (chatDeletionStatesRef.current.get(chatId) === "committed") return;
    setMessagesByChat((current) => ({
      ...current,
      [chatId]: insertMessageBefore(current[chatId] || [], msg, beforeId),
    }));
  }, []);

  const updateMessage = useCallback(
    (chatId: string, id: string, patch: (m: Message) => Message) => {
      if (chatDeletionStatesRef.current.get(chatId) === "committed") return;
      setMessagesByChat((current) => {
        const thread = current[chatId] || [];
        return {
          ...current,
          [chatId]: thread.map((m) => (m.id === id ? patch(m) : m)),
        };
      });
    },
    [],
  );

  const clearSyncError = useCallback(() => setSyncError(""), []);

  return {
    projects,
    activeId,
    activeProject,
    chats,
    projectChats,
    activeChatId,
    activeChat,
    messagesByChat,
    messages,
    theme,
    syncError,
    activeChatByProject,
    setTheme,
    clearSyncError,
    refreshWorkspace,
    setActiveId,
    createProject,
    removeProject,
    createChat,
    selectChat,
    renameChat,
    removeChat,
    clearChatThread,
    appendMessage,
    insertMessage,
    updateMessage,
  };
}
