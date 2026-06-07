export type Role = "user" | "assistant";

export type Message = {
  id: string;
  role: Role;
  text: string;
  artifacts?: ChatArtifact[];
  usedCodex?: boolean;
  streaming?: boolean;
  workdir?: string;
  codexEvents?: CodexTimelineEvent[];
  codexStatus?: string;
  codexTurnId?: string;
  codexThreadId?: string;
};

export type ChatArtifact = {
  id: string;
  chat_id?: string;
  message_id?: string;
  title: string;
  summary: string;
  content: string;
  content_type: "markdown" | "text" | "json";
  source: string;
  workdir?: string;
  created_at?: string;
};

export type CodexTimelineEvent = {
  method: string;
  summary?: string;
  item_type?: string;
  item_id?: string;
  turn_id?: string;
  thread_id?: string;
  command?: string;
  status?: string;
  output?: string;
  exit_code?: number | null;
  text?: string;
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
    artifacts?: ChatArtifact[];
    codex_events?: CodexTimelineEvent[];
    codex_status?: string;
    codex_turn_id?: string;
    codex_thread_id?: string;
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
