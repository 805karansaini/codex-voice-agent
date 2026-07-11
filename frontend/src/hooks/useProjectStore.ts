import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Project, Chat, Message } from "../types";
import * as api from "../services/api";
import { loadJSON, saveJSON } from "../utils";
import { insertMessageBefore, mergeBackendHistoryWithLocalMessages } from "../utils/history";

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

function loadChatState(): ChatState {
  return {
    chats: {},
    activeChat: loadJSON<Record<string, string>>(LS_ACTIVE_CHAT, {}),
  };
}

export function useProjectStore() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string>(() => loadJSON<string>(LS_ACTIVE, ""));

  const initialChatState = useRef(loadChatState()).current;
  const [chats, setChats] = useState<Record<string, Chat[]>>(initialChatState.chats);
  const [messagesByChat, setMessagesByChat] = useState<Record<string, Message[]>>({});
  const [activeChatByProject, setActiveChatByProject] = useState<Record<string, string>>(
    initialChatState.activeChat,
  );
  const [syncError, setSyncError] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    loadJSON<"dark" | "light">(LS_THEME, "dark"),
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

  // Load from backend
  useEffect(() => {
    let cancelled = false;
    api
      .fetchProjects()
      .then((serverProjects) => {
        if (cancelled) return;
        setProjects(serverProjects);
        setActiveId((current) =>
          serverProjects.some((project) => project.id === current)
            ? current
            : serverProjects[0]?.id || "",
        );
      })
      .catch((error: unknown) => setSyncError(syncErrorMessage("Failed to load projects", error)));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .fetchChats()
      .then((serverChats) => {
        if (cancelled) return;
        const next: Record<string, Chat[]> = {};
        for (const chat of serverChats) {
          next[chat.projectId] = [...(next[chat.projectId] || []), chat];
        }
        for (const projectId of Object.keys(next)) {
          next[projectId] = next[projectId].sort((a, b) => b.createdAt - a.createdAt);
        }
        setChats(next);
      })
      .catch((error: unknown) => setSyncError(syncErrorMessage("Failed to load chats", error)));
    return () => {
      cancelled = true;
    };
  }, []);

  // Hydrate chat history when active chat changes
  useEffect(() => {
    if (!activeChatId) return;
    let cancelled = false;
    api
      .fetchHistory(activeChatId)
      .then((rows) => {
        if (cancelled) return;
        setMessagesByChat((current) => {
          const localMessages = current[activeChatId] || [];
          return {
            ...current,
            [activeChatId]: mergeBackendHistoryWithLocalMessages(rows, localMessages),
          };
        });
      })
      .catch((error: unknown) =>
        setSyncError(syncErrorMessage("Failed to load chat history", error)),
      );
    return () => {
      cancelled = true;
    };
  }, [activeChatId]);

  const createChat = useCallback(
    (projectId: string, opts?: { title?: string; activate?: boolean }) => {
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
      if (opts?.activate !== false) {
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
        setActiveChatByProject((current) =>
          current[projectId] === chat.id ? { ...current, [projectId]: "" } : current,
        );
      });
      return chat;
    },
    [setActiveId],
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
      setActiveChatByProject((current) => ({ ...current, [projectId]: chatId }));
      setActiveId(projectId);
    },
    [setActiveId],
  );

  const renameChat = useCallback((projectId: string, chatId: string, title: string) => {
    const clean = title.trim();
    if (!clean) return;
    setChats((current) => {
      let updated: Chat | undefined;
      const next = (current[projectId] || []).map((c) => {
        if (c.id !== chatId) return c;
        const previous = c;
        updated = { ...c, title: clean };
        api.saveChat(updated).catch((error: unknown) => {
          setSyncError(syncErrorMessage("Failed to rename chat", error));
          setChats((rollbackCurrent) => ({
            ...rollbackCurrent,
            [projectId]: (rollbackCurrent[projectId] || []).map((item) =>
              item.id === chatId ? previous : item,
            ),
          }));
        });
        return updated;
      });
      return { ...current, [projectId]: next };
    });
  }, []);

  const removeChat = useCallback(
    (projectId: string, chatId: string) => {
      window.speechSynthesis?.cancel();
      const previousChat = (chats[projectId] || []).find((chat) => chat.id === chatId);
      const previousMessages = messagesByChat[chatId] || [];
      const previousActiveChat = activeChatByProject[projectId] || "";
      setChats((current) => ({
        ...current,
        [projectId]: (current[projectId] || []).filter((c) => c.id !== chatId),
      }));
      setActiveChatByProject((current) =>
        current[projectId] === chatId ? { ...current, [projectId]: "" } : current,
      );
      setMessagesByChat((current) => {
        const next = { ...current };
        delete next[chatId];
        return next;
      });
      api.deleteChat(chatId).catch((error: unknown) => {
        setSyncError(syncErrorMessage("Failed to delete chat", error));
        if (previousChat) {
          setChats((current) => ({
            ...current,
            [projectId]: [previousChat, ...(current[projectId] || [])].sort(
              (a, b) => b.createdAt - a.createdAt,
            ),
          }));
        }
        setMessagesByChat((current) => ({ ...current, [chatId]: previousMessages }));
        setActiveChatByProject((current) => ({ ...current, [projectId]: previousActiveChat }));
      });
    },
    [activeChatByProject, chats, messagesByChat],
  );

  const createProject = useCallback((p: Omit<Project, "id" | "createdAt">) => {
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
      setActiveId((current) => (current === project.id ? "" : current));
    });
  }, []);

  const removeProject = useCallback(
    (id: string) => {
      const previousProject = projects.find((project) => project.id === id);
      const previousChats = chats[id] || [];
      const previousActiveId = activeId;
      const previousActiveChat = activeChatByProject[id] || "";
      const chatIds = new Set((chats[id] || []).map((c) => c.id));
      const previousMessages = Object.fromEntries(
        Object.entries(messagesByChat).filter(([cid]) => chatIds.has(cid)),
      );
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
      setMessagesByChat((current) => {
        const next: Record<string, Message[]> = {};
        for (const [cid, msgs] of Object.entries(current)) {
          if (!chatIds.has(cid)) next[cid] = msgs;
        }
        return next;
      });
      setActiveId((current) => (current === id ? "" : current));
      api.deleteProject(id).catch((error: unknown) => {
        setSyncError(syncErrorMessage("Failed to delete project", error));
        if (previousProject) {
          setProjects((current) =>
            [previousProject, ...current].sort((a, b) => b.createdAt - a.createdAt),
          );
        }
        setChats((current) => ({ ...current, [id]: previousChats }));
        setMessagesByChat((current) => ({ ...current, ...previousMessages }));
        setActiveChatByProject((current) => ({ ...current, [id]: previousActiveChat }));
        setActiveId(previousActiveId);
      });
    },
    [activeChatByProject, activeId, chats, messagesByChat, projects],
  );

  const clearChatThread = useCallback(
    (chatId: string) => {
      window.speechSynthesis?.cancel();
      const previousMessages = messagesByChat[chatId] || [];
      setMessagesByChat((current) => ({ ...current, [chatId]: [] }));
      api.deleteHistory(chatId).catch((error: unknown) => {
        setSyncError(syncErrorMessage("Failed to clear chat history", error));
        setMessagesByChat((current) => ({ ...current, [chatId]: previousMessages }));
      });
    },
    [messagesByChat],
  );

  const appendMessage = useCallback((chatId: string, msg: Message) => {
    setMessagesByChat((current) => ({
      ...current,
      [chatId]: [...(current[chatId] || []), msg],
    }));
  }, []);

  const insertMessage = useCallback((chatId: string, msg: Message, beforeId?: string | null) => {
    setMessagesByChat((current) => ({
      ...current,
      [chatId]: insertMessageBefore(current[chatId] || [], msg, beforeId),
    }));
  }, []);

  const updateMessage = useCallback(
    (chatId: string, id: string, patch: (m: Message) => Message) => {
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
