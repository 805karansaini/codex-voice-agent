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
  geminiLiveUsage?: GeminiLiveUsage;
};

export type GeminiLiveUsage = {
  estimated: boolean;
  input_text_chars: number;
  output_text_chars: number;
  input_audio_bytes: number;
  output_audio_bytes: number;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  estimated_total_tokens: number;
  estimated_cost_usd: number;
};

export type ChatArtifact = {
  id: string;
  chat_id?: string;
  message_id?: string;
  title: string;
  summary: string;
  content: string;
  content_type: "markdown" | "text" | "json" | "diff";
  source: string;
  workdir?: string;
  created_at?: string;
  changed_files?: string[];
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
  token_usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cached_input_tokens?: number;
  };
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
    gemini_live_usage?: GeminiLiveUsage;
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
  streamingResponse?: string;
  workdir?: string;
};

export type CodexJob = {
  id: string;
  task: string;
  workdir: string;
  project_id?: string;
  chat_id?: string;
  status: "queued" | "running" | "done" | "failed";
  result: string;
  error: string;
  latest_status?: string;
  progress_updates?: string[];
  codex_events: CodexTimelineEvent[];
  codex_turn_id?: string;
  codex_thread_id?: string;
  codex_status?: string;
  artifacts?: ChatArtifact[];
  created_at: string;
  updated_at: string;
};

export type ConsoleState = {
  actions: ActionEntry[];
  handoffs: Handoff[];
  debugEntries: DebugEntry[];
};

export type SearchResult = {
  type: "message" | "artifact";
  id: string;
  chat_id?: string;
  project_id?: string;
  title: string;
  snippet: string;
  content_type?: string;
  source?: string;
  workdir?: string;
  created_at?: string;
};

export type DoctorCheck = {
  name: string;
  ok: boolean;
  message: string;
  fix: string;
};
