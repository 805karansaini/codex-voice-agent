import { Project, Chat, HistoryRow, ProjectInfo } from "../types";

export const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

export function getWebSocketUrl(path: string): string {
  if (API_BASE.startsWith("http")) {
    return `${API_BASE.replace(/^http/, "ws")}${path}`;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

export async function fetchHealth(): Promise<{ has_google_api_key: boolean; gemini_model: string }> {
  const res = await fetch(`${API_BASE}/api/health`);
  if (!res.ok) throw new Error("Health check failed");
  return res.json();
}

export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch(`${API_BASE}/api/projects`);
  if (!res.ok) throw new Error("Failed to fetch projects");
  return res.json();
}

export async function saveProject(project: Project): Promise<void> {
  const res = await fetch(`${API_BASE}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project),
  });
  if (!res.ok) throw new Error("Failed to save project");
}

export async function deleteProject(projectId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete project");
}

export async function fetchChats(): Promise<Chat[]> {
  const res = await fetch(`${API_BASE}/api/chats`);
  if (!res.ok) throw new Error("Failed to fetch chats");
  return res.json();
}

export async function saveChat(chat: Chat): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chats`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(chat),
  });
  if (!res.ok) throw new Error("Failed to save chat");
}

export async function deleteChat(chatId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chats/${encodeURIComponent(chatId)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete chat");
}

export async function fetchHistory(chatId: string): Promise<HistoryRow[]> {
  const res = await fetch(`${API_BASE}/api/history?chat_id=${encodeURIComponent(chatId)}`);
  if (!res.ok) throw new Error("Failed to fetch history");
  return res.json();
}

export async function deleteHistory(chatId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/history?chat_id=${encodeURIComponent(chatId)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to clear history");
}

export async function getProjectInfo(path: string): Promise<ProjectInfo> {
  const res = await fetch(`${API_BASE}/api/project/info?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error("Failed to fetch project info");
  return res.json();
}

export async function pickFolder(): Promise<{ path: string | null; cancelled: boolean }> {
  const res = await fetch(`${API_BASE}/api/fs/pick`, { method: "POST" });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.detail || "Folder picker failed");
  }
  return res.json();
}

export interface StreamOptions {
  task?: string;
  message?: string;
  workdir: string;
  projectId: string;
  chatId: string;
}

export async function postCodexStream(options: StreamOptions): Promise<Response> {
  return fetch(`${API_BASE}/api/codex/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task: options.task,
      workdir: options.workdir,
      project_id: options.projectId,
      chat_id: options.chatId,
    }),
  });
}

export async function postChatStream(options: StreamOptions): Promise<Response> {
  return fetch(`${API_BASE}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: options.message,
      workdir: options.workdir,
      project_id: options.projectId,
      chat_id: options.chatId,
    }),
  });
}
