import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Project, Chat, Message, HistoryRow } from "../types";
import * as api from "../services/api";
import { loadJSON, saveJSON, chatTitleFrom } from "../utils";

const LS_PROJECTS = "cva.projects.v1";
const LS_ACTIVE = "cva.activeProject.v1";
const LS_THREADS = "cva.threads.v1"; // Legacy
const LS_CHATS = "cva.chats.v1";
const LS_MESSAGES = "cva.messages.v1";
const LS_ACTIVE_CHAT = "cva.activeChat.v1";
const LS_THEME = "cva.theme.v1";

type ChatState = {
  chats: Record<string, Chat[]>;
  messages: Record<string, Message[]>;
  activeChat: Record<string, string>;
};

function loadChatState(): ChatState {
  if (localStorage.getItem(LS_CHATS) !== null) {
    return {
      chats: loadJSON<Record<string, Chat[]>>(LS_CHATS, {}),
      messages: loadJSON<Record<string, Message[]>>(LS_MESSAGES, {}),
      activeChat: loadJSON<Record<string, string>>(LS_ACTIVE_CHAT, {}),
    };
  }
  const legacy = loadJSON<Record<string, Message[]>>(LS_THREADS, {});
  const chats: Record<string, Chat[]> = {};
  const messages: Record<string, Message[]> = {};
  const activeChat: Record<string, string> = {};
  for (const [projectId, msgs] of Object.entries(legacy)) {
    const id = crypto.randomUUID();
    const firstUser = msgs.find((m) => m.role === "user");
    chats[projectId] = [
      {
        id,
        projectId,
        title: firstUser ? chatTitleFrom(firstUser.text) : "Chat 1",
        createdAt: Date.now(),
      },
    ];
    messages[id] = msgs;
    activeChat[projectId] = id;
  }
  return { chats, messages, activeChat };
}

function historyRowsToMessages(rows: HistoryRow[]): Message[] {
  return rows
    .filter((row) => row.role === "user" || row.role === "assistant")
    .map((row) => ({
      id: row.id,
      role: row.role,
      text: row.text,
      artifacts: row.meta?.artifacts || [],
      usedCodex: Boolean(
        row.meta?.direct_codex ||
          (Array.isArray(row.meta?.tool_calls) && row.meta.tool_calls.length > 0) ||
          (Array.isArray(row.meta?.codex_events) && row.meta.codex_events.length > 0)
      ),
      workdir: row.meta?.workdir,
      codexEvents: row.meta?.codex_events || [],
      codexStatus: row.meta?.codex_status,
      codexTurnId: row.meta?.codex_turn_id,
      codexThreadId: row.meta?.codex_thread_id,
    }));
}

export function useProjectStore() {
  const [projects, setProjects] = useState<Project[]>(() => loadJSON<Project[]>(LS_PROJECTS, []));
  const [activeId, setActiveId] = useState<string>(() => loadJSON<string>(LS_ACTIVE, ""));
  
  const initialChatState = useRef(loadChatState()).current;
  const [chats, setChats] = useState<Record<string, Chat[]>>(initialChatState.chats);
  const [messagesByChat, setMessagesByChat] = useState<Record<string, Message[]>>(initialChatState.messages);
  const [activeChatByProject, setActiveChatByProject] = useState<Record<string, string>>(initialChatState.activeChat);
  const [theme, setTheme] = useState<"dark" | "light">(() => loadJSON<"dark" | "light">(LS_THEME, "dark"));

  const activeProject = useMemo(() => projects.find((p) => p.id === activeId) || null, [projects, activeId]);
  const projectChats = activeProject ? chats[activeProject.id] || [] : [];
  const activeChatId = activeProject ? activeChatByProject[activeProject.id] || "" : "";
  const activeChat = projectChats.find((c) => c.id === activeChatId) || null;
  const messages = activeChatId ? messagesByChat[activeChatId] || [] : [];

  // Local storage persistence
  useEffect(() => saveJSON(LS_PROJECTS, projects), [projects]);
  useEffect(() => saveJSON(LS_ACTIVE, activeId), [activeId]);
  useEffect(() => saveJSON(LS_CHATS, chats), [chats]);
  useEffect(() => saveJSON(LS_MESSAGES, messagesByChat), [messagesByChat]);
  useEffect(() => saveJSON(LS_ACTIVE_CHAT, activeChatByProject), [activeChatByProject]);
  
  useEffect(() => {
    saveJSON(LS_THEME, theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Load from backend
  useEffect(() => {
    let cancelled = false;
    api.fetchProjects()
      .then((serverProjects) => {
        if (cancelled || serverProjects.length === 0) return;
        setProjects((current) => {
          const byId = new Map(current.map((p) => [p.id, p]));
          for (const p of serverProjects) byId.set(p.id, p);
          return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
        });
        setActiveId((current) => current || serverProjects[0]?.id || "");
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.fetchChats()
      .then((serverChats) => {
        if (cancelled || serverChats.length === 0) return;
        setChats((current) => {
          const grouped = new Map<string, Map<string, Chat>>();
          for (const [pid, list] of Object.entries(current)) {
            grouped.set(pid, new Map(list.map((c) => [c.id, c])));
          }
          for (const chat of serverChats) {
            if (!grouped.has(chat.projectId)) grouped.set(chat.projectId, new Map());
            grouped.get(chat.projectId)!.set(chat.id, chat);
          }
          const next: Record<string, Chat[]> = {};
          for (const [pid, byId] of grouped) {
            next[pid] = Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
          }
          return next;
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Hydrate chat history when active chat changes
  useEffect(() => {
    if (!activeChatId) return;
    let cancelled = false;
    api.fetchHistory(activeChatId)
      .then((rows) => {
        if (cancelled || rows.length === 0) return;
        setMessagesByChat((current) =>
          (current[activeChatId] || []).length > 0
            ? current
            : { ...current, [activeChatId]: historyRowsToMessages(rows) }
        );
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeChatId]);

  const createChat = useCallback((projectId: string, opts?: { title?: string; activate?: boolean }) => {
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
    api.saveChat(chat).catch(() => {});
    return chat;
  }, [setActiveId]);

  useEffect(() => {
    if (!activeProject) return;
    const list = chats[activeProject.id] || [];
    if (!list.some((c) => c.id === activeChatByProject[activeProject.id])) {
      setActiveChatByProject((current) => ({
        ...current,
        [activeProject.id]: list[0]?.id || "",
      }));
    }
  }, [activeProject, chats, activeChatByProject]);

  const selectChat = useCallback((projectId: string, chatId: string) => {
    setActiveChatByProject((current) => ({ ...current, [projectId]: chatId }));
    setActiveId(projectId);
  }, [setActiveId]);

  const renameChat = useCallback((projectId: string, chatId: string, title: string) => {
    const clean = title.trim();
    if (!clean) return;
    setChats((current) => {
      let updated: Chat | undefined;
      const next = (current[projectId] || []).map((c) => {
        if (c.id !== chatId) return c;
        updated = { ...c, title: clean };
        return updated;
      });
      if (updated) api.saveChat(updated).catch(() => {});
      return { ...current, [projectId]: next };
    });
  }, []);

  const removeChat = useCallback((projectId: string, chatId: string) => {
    window.speechSynthesis?.cancel();
    setChats((current) => ({
      ...current,
      [projectId]: (current[projectId] || []).filter((c) => c.id !== chatId),
    }));
    setActiveChatByProject((current) =>
      current[projectId] === chatId ? { ...current, [projectId]: "" } : current
    );
    setMessagesByChat((current) => {
      const next = { ...current };
      delete next[chatId];
      return next;
    });
    api.deleteChat(chatId).catch(() => {});
  }, []);

  const createProject = useCallback((p: Omit<Project, "id" | "createdAt">) => {
    const project: Project = {
      ...p,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };
    setProjects((current) => [project, ...current]);
    setActiveId(project.id);
    api.saveProject(project).catch(() => {});
  }, []);

  const removeProject = useCallback((id: string) => {
    const chatIds = new Set((chats[id] || []).map((c) => c.id));
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
    api.deleteProject(id).catch(() => {});
  }, [chats]);

  const clearChatThread = useCallback((chatId: string) => {
    window.speechSynthesis?.cancel();
    setMessagesByChat((current) => ({ ...current, [chatId]: [] }));
    api.deleteHistory(chatId).catch(() => {});
  }, []);

  const appendMessage = useCallback((chatId: string, msg: Message) => {
    setMessagesByChat((current) => ({
      ...current,
      [chatId]: [...(current[chatId] || []), msg],
    }));
  }, []);

  const updateMessage = useCallback((chatId: string, id: string, patch: (m: Message) => Message) => {
    setMessagesByChat((current) => {
      const thread = current[chatId] || [];
      return {
        ...current,
        [chatId]: thread.map((m) => (m.id === id ? patch(m) : m)),
      };
    });
  }, []);

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
    activeChatByProject,
    setTheme,
    setActiveId,
    createProject,
    removeProject,
    createChat,
    selectChat,
    renameChat,
    removeChat,
    clearChatThread,
    appendMessage,
    updateMessage,
  };
}
