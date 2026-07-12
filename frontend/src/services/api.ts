import type {
  Project,
  Chat,
  ConsoleState,
  CodexJob,
  HistoryRow,
  ProjectInfo,
  ProjectFileEntry,
  SearchResult,
  DoctorCheck,
  CodexModel,
} from "../types";

const configuredApiBase: unknown = import.meta.env?.VITE_API_BASE_URL;
const configuredApiToken: unknown = import.meta.env?.VITE_API_TOKEN;
export const API_BASE = typeof configuredApiBase === "string" ? configuredApiBase : "";
const API_TOKEN = typeof configuredApiToken === "string" ? configuredApiToken : "";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function authHeaders(headers: HeadersInit = {}): HeadersInit {
  return API_TOKEN ? { ...headers, Authorization: `Bearer ${API_TOKEN}` } : headers;
}

async function errorDetail(res: Response, fallback: string): Promise<string> {
  const payload = (await res.json().catch(() => ({}))) as { detail?: string };
  return payload.detail || fallback;
}

async function apiFetch(
  path: string,
  init: RequestInit = {},
  errorMessage = "Request failed",
): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: authHeaders(init.headers),
  });
  if (!res.ok) throw new ApiError(res.status, await errorDetail(res, errorMessage));
  return res;
}

async function apiJson<T>(
  path: string,
  init: RequestInit = {},
  errorMessage = "Request failed",
): Promise<T> {
  const res = await apiFetch(path, init, errorMessage);
  return res.json() as Promise<T>;
}

async function apiVoid(
  path: string,
  init: RequestInit = {},
  errorMessage = "Request failed",
): Promise<void> {
  await apiFetch(path, init, errorMessage);
}

function jsonBody(method: "POST" | "PUT", body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function jsonPost(body?: unknown): RequestInit {
  return jsonBody("POST", body);
}

// SSE endpoints: callers inspect res.ok and the response body themselves, so
// this returns the raw response without throwing on non-OK status.
function streamFetch(
  path: string,
  options: ChatStreamOptions,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...jsonPost(chatStreamPayload(options)),
    headers: authHeaders({ "Content-Type": "application/json" }),
    signal,
  });
}

function codexJobPayload(options: CodexJobOptions) {
  return {
    task: options.task,
    workdir: options.workdir,
    project_id: options.projectId,
    chat_id: options.chatId,
    model: options.model,
    reasoning_effort: options.reasoningEffort,
  };
}

function chatStreamPayload(options: ChatStreamOptions) {
  return {
    message: options.message,
    workdir: options.workdir,
    project_id: options.projectId,
    chat_id: options.chatId,
    model: options.model,
    reasoning_effort: options.reasoningEffort,
  };
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

export async function fetchHealth(): Promise<{
  has_google_api_key: boolean;
  gemini_model: string;
}> {
  return apiJson("/api/health", {}, "Health check failed");
}

export async function fetchDoctor(): Promise<{ ok: boolean; checks: DoctorCheck[] }> {
  return apiJson("/api/doctor", {}, "Doctor check failed");
}

export async function fetchProjects(): Promise<Project[]> {
  return apiJson("/api/projects", {}, "Failed to fetch projects");
}

export async function saveProject(project: Project): Promise<void> {
  await apiVoid("/api/projects", jsonPost(project), "Failed to save project");
}

export async function deleteProject(projectId: string): Promise<void> {
  await apiVoid(
    `/api/projects/${encodeURIComponent(projectId)}`,
    { method: "DELETE" },
    "Failed to delete project",
  );
}

export async function fetchChats(): Promise<Chat[]> {
  return apiJson("/api/chats", {}, "Failed to fetch chats");
}

export async function saveChat(chat: Chat): Promise<void> {
  await apiVoid("/api/chats", jsonPost(chat), "Failed to save chat");
}

export async function deleteChat(chatId: string): Promise<void> {
  await apiVoid(
    `/api/chats/${encodeURIComponent(chatId)}`,
    { method: "DELETE" },
    "Failed to delete chat",
  );
}

export async function exportChatMarkdown(
  chatId: string,
): Promise<{ blob: Blob; filename: string }> {
  const res = await apiFetch(
    `/api/chats/${encodeURIComponent(chatId)}/export.md`,
    {},
    "Failed to export chat",
  );
  const disposition = res.headers.get("content-disposition") || "";
  const filenameMatch = disposition.match(/filename="([^"]+)"/);
  return {
    blob: await res.blob(),
    filename: filenameMatch?.[1] || "chat-export.md",
  };
}

export async function fetchConsoleState(chatId: string): Promise<ConsoleState> {
  return apiJson(
    `/api/chats/${encodeURIComponent(chatId)}/console`,
    {},
    "Failed to fetch console state",
  );
}

export async function saveConsoleState(chatId: string, state: ConsoleState): Promise<void> {
  await apiVoid(
    `/api/chats/${encodeURIComponent(chatId)}/console`,
    jsonBody("PUT", state),
    "Failed to save console state",
  );
}

export async function deleteConsoleState(chatId: string): Promise<void> {
  await apiVoid(
    `/api/chats/${encodeURIComponent(chatId)}/console`,
    { method: "DELETE" },
    "Failed to clear console state",
  );
}

export async function fetchHistory(chatId: string): Promise<HistoryRow[]> {
  return apiJson(
    `/api/history?chat_id=${encodeURIComponent(chatId)}`,
    {},
    "Failed to fetch history",
  );
}

export async function deleteHistory(chatId: string): Promise<void> {
  await apiVoid(
    `/api/history?chat_id=${encodeURIComponent(chatId)}`,
    { method: "DELETE" },
    "Failed to clear history",
  );
}

export async function searchContent(query: string): Promise<SearchResult[]> {
  return apiJson(`/api/search?q=${encodeURIComponent(query)}`, {}, "Search failed");
}

export async function getProjectInfo(path: string): Promise<ProjectInfo> {
  return apiJson(
    `/api/project/info?path=${encodeURIComponent(path)}`,
    {},
    "Failed to fetch project info",
  );
}

export async function fetchProjectFiles(
  projectId: string,
  path = "",
): Promise<{ root: string; entries: ProjectFileEntry[]; truncated: boolean }> {
  return apiJson(
    `/api/projects/${encodeURIComponent(projectId)}/files?path=${encodeURIComponent(path)}`,
    {},
    "Failed to load project files",
  );
}

export async function fetchProjectFileContent(
  projectId: string,
  path: string,
): Promise<{ path: string; content: string; size: number }> {
  return apiJson(
    `/api/projects/${encodeURIComponent(projectId)}/files/content?path=${encodeURIComponent(path)}`,
    {},
    "Failed to load file preview",
  );
}

export async function pickFolder(): Promise<{ path: string | null; cancelled: boolean }> {
  return apiJson("/api/fs/pick", { method: "POST" }, "Folder picker failed");
}

export async function revertChangeReview(
  workdir: string,
  files: string[],
): Promise<{ ok: boolean; reverted_files: string[] }> {
  return apiJson(
    "/api/change-review/revert",
    jsonPost({ workdir, files }),
    "Failed to revert changes",
  );
}

export async function commitChangeReview(
  workdir: string,
  files: string[],
  message: string,
): Promise<{ ok: boolean; commit: string; committed_files: string[]; message: string }> {
  return apiJson(
    "/api/change-review/commit",
    jsonPost({ workdir, files, message }),
    "Failed to commit changes",
  );
}

interface ModelSelection {
  model?: string;
  reasoningEffort?: string;
}

interface ChatScope {
  workdir: string;
  projectId: string;
  chatId: string;
}

export type CodexJobOptions = ChatScope & ModelSelection & { task: string };
export type ChatStreamOptions = ChatScope & ModelSelection & { message: string };

export async function fetchCodexModels(): Promise<CodexModel[]> {
  const response = await apiJson<{ models: CodexModel[] }>(
    "/api/codex/models",
    {},
    "Failed to load Codex models",
  );
  return response.models;
}

export async function enqueueCodexJob(options: CodexJobOptions): Promise<CodexJob> {
  return apiJson(
    "/api/codex/jobs",
    jsonPost(codexJobPayload(options)),
    "Failed to enqueue Codex job",
  );
}

export async function fetchCodexJob(jobId: string): Promise<CodexJob> {
  return apiJson(`/api/codex/jobs/${encodeURIComponent(jobId)}`, {}, "Failed to fetch Codex job");
}

export async function postChatStream(
  options: ChatStreamOptions,
  signal?: AbortSignal,
): Promise<Response> {
  return streamFetch("/api/chat/stream", options, signal);
}
