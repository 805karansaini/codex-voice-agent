import { Project, Chat, ConsoleState, HistoryRow, ProjectInfo, SearchResult, DoctorCheck } from "../types";

export const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const API_TOKEN = import.meta.env.VITE_API_TOKEN || "";

function authHeaders(headers: HeadersInit = {}): HeadersInit {
  return API_TOKEN ? { ...headers, Authorization: `Bearer ${API_TOKEN}` } : headers;
}

export function getWebSocketUrl(path: string): string {
  const wsPath = API_TOKEN
    ? `${path}${path.includes("?") ? "&" : "?"}api_token=${encodeURIComponent(API_TOKEN)}`
    : path;
  if (API_BASE.startsWith("http")) {
    return `${API_BASE.replace(/^http/, "ws")}${wsPath}`;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${wsPath}`;
}

export async function fetchHealth(): Promise<{ has_google_api_key: boolean; gemini_model: string }> {
  const res = await fetch(`${API_BASE}/api/health`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Health check failed");
  return res.json();
}

export async function fetchDoctor(): Promise<{ ok: boolean; checks: DoctorCheck[] }> {
  const res = await fetch(`${API_BASE}/api/doctor`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Doctor check failed");
  return res.json();
}

export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch(`${API_BASE}/api/projects`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch projects");
  return res.json();
}

export async function saveProject(project: Project): Promise<void> {
  const res = await fetch(`${API_BASE}/api/projects`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(project),
  });
  if (!res.ok) throw new Error("Failed to save project");
}

export async function deleteProject(projectId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to delete project");
}

export async function fetchChats(): Promise<Chat[]> {
  const res = await fetch(`${API_BASE}/api/chats`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch chats");
  return res.json();
}

export async function saveChat(chat: Chat): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chats`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(chat),
  });
  if (!res.ok) throw new Error("Failed to save chat");
}

export async function deleteChat(chatId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chats/${encodeURIComponent(chatId)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to delete chat");
}

export async function exportChatMarkdown(chatId: string): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`${API_BASE}/api/chats/${encodeURIComponent(chatId)}/export.md`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to export chat");
  const disposition = res.headers.get("content-disposition") || "";
  const filenameMatch = disposition.match(/filename="([^"]+)"/);
  return {
    blob: await res.blob(),
    filename: filenameMatch?.[1] || "chat-export.md",
  };
}

export async function fetchConsoleState(chatId: string): Promise<ConsoleState> {
  const res = await fetch(`${API_BASE}/api/chats/${encodeURIComponent(chatId)}/console`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch console state");
  return res.json();
}

export async function saveConsoleState(chatId: string, state: ConsoleState): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chats/${encodeURIComponent(chatId)}/console`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(state),
  });
  if (!res.ok) throw new Error("Failed to save console state");
}

export async function deleteConsoleState(chatId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chats/${encodeURIComponent(chatId)}/console`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to clear console state");
}

export async function fetchHistory(chatId: string): Promise<HistoryRow[]> {
  const res = await fetch(`${API_BASE}/api/history?chat_id=${encodeURIComponent(chatId)}`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch history");
  return res.json();
}

export async function deleteHistory(chatId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/history?chat_id=${encodeURIComponent(chatId)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to clear history");
}

export async function searchContent(query: string): Promise<SearchResult[]> {
  const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Search failed");
  return res.json();
}

export async function getProjectInfo(path: string): Promise<ProjectInfo> {
  const res = await fetch(`${API_BASE}/api/project/info?path=${encodeURIComponent(path)}`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch project info");
  return res.json();
}

export async function pickFolder(): Promise<{ path: string | null; cancelled: boolean }> {
  const res = await fetch(`${API_BASE}/api/fs/pick`, { method: "POST", headers: authHeaders() });
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

export async function postCodexStream(options: StreamOptions, signal?: AbortSignal): Promise<Response> {
  return fetch(`${API_BASE}/api/codex/stream`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      task: options.task,
      workdir: options.workdir,
      project_id: options.projectId,
      chat_id: options.chatId,
    }),
    signal,
  });
}

export async function postChatStream(options: StreamOptions, signal?: AbortSignal): Promise<Response> {
  return fetch(`${API_BASE}/api/chat/stream`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      message: options.message,
      workdir: options.workdir,
      project_id: options.projectId,
      chat_id: options.chatId,
    }),
    signal,
  });
}
