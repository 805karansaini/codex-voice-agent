export type Role = "user" | "assistant";

export type Message = {
  id: string;
  role: Role;
  text: string;
  usedCodex?: boolean;
  streaming?: boolean;
  workdir?: string;
};

export type ProjectInfo = {
  path: string;
  name: string;
  exists: boolean;
  is_git: boolean;
  branch: string | null;
  file_count: number | null;
};

export type Project = {
  id: string;
  name: string;
  path: string;
  color: string;
  createdAt: number;
};

export type Chat = {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
};

export type AgentResponse = {
  reply?: string;
  tool_calls?: unknown[];
  workdir?: string;
  audio_data_url?: string | null;
};

export type HistoryRow = {
  id: string;
  role: Role;
  text: string;
  meta?: {
    direct_codex?: boolean;
    tool_calls?: unknown[];
    workdir?: string;
    project_id?: string;
    chat_id?: string;
  };
};

export type LiveVoiceState = "idle" | "connecting" | "live" | "thinking" | "working" | "error";

export type DebugEntry = {
  id: string;
  time: string;
  message: string;
};

export type Handoff = {
  id: string;
  name: string;
  summary: string;
};

export type ActionEntry = {
  id: string;
  title: string;
  status: "running" | "done" | "failed";
  detail: string;
  workdir?: string;
};

export type ConsoleState = {
  actions: ActionEntry[];
  handoffs: Handoff[];
  debugEntries: DebugEntry[];
};
