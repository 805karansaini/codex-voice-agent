import type { ChatArtifact, CodexTimelineEvent, GeminiLiveUsage } from "../types";

const SERVER_EVENT_TYPES = [
  "assistant_audio_delta",
  "assistant_delta",
  "background_job_completed",
  "checkpoint",
  "codex_event",
  "debug",
  "delta",
  "done",
  "error",
  "gemini_tool_response_delivery_failed",
  "interrupted",
  "ready",
  "session_refresh_requested",
  "session_resume_failed",
  "status",
  "tool_call",
  "tool_call_failed",
  "tool_call_started",
  "tool_progress",
  "tool_result",
  "tool_start_gemini_delivery_failed",
  "turn_complete",
  "user_transcript",
] as const;

export type ServerEventType = (typeof SERVER_EVENT_TYPES)[number];

export type ServerEvent = {
  type: ServerEventType;
  message?: string;
  text?: string;
  name?: string;
  task?: string;
  result?: string;
  workdir?: string;
  data?: string;
  elapsed?: number;
  time_left?: string;
  session_ended?: boolean;
  user_text?: string;
  assistant_text?: string;
  audio_data_url?: string | null;
  gemini_live_usage?: GeminiLiveUsage;
  event?: CodexTimelineEvent;
  tool_calls?: unknown[];
  codex_events?: CodexTimelineEvent[];
  codex_status?: string;
  codex_turn_id?: string;
  codex_thread_id?: string;
  artifact?: ChatArtifact;
  change_artifact?: ChatArtifact;
  artifacts?: ChatArtifact[];
  background_job_id?: string;
  handoff?: {
    id?: string;
    workdir?: string;
    codex_status?: string;
  };
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyOptionalStrings(value: unknown, keys: string[]): boolean {
  if (!isRecord(value)) return false;
  return keys.every((key) => value[key] == null || typeof value[key] === "string");
}

function isTokenUsage(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ["input_tokens", "output_tokens", "total_tokens", "cached_input_tokens"].every(
    (key) => value[key] == null || typeof value[key] === "number",
  );
}

function isCodexTimelineEvent(value: unknown): value is CodexTimelineEvent {
  if (!isRecord(value) || typeof value.method !== "string") return false;
  const stringFields = [
    "summary",
    "item_type",
    "item_id",
    "turn_id",
    "thread_id",
    "command",
    "status",
    "output",
    "text",
  ];
  if (!stringFields.every((key) => value[key] == null || typeof value[key] === "string")) {
    return false;
  }
  if (value.exit_code != null && typeof value.exit_code !== "number") return false;
  return value.token_usage == null || isTokenUsage(value.token_usage);
}

function isChatArtifact(value: unknown): value is ChatArtifact {
  if (!isRecord(value)) return false;
  const requiredStrings = ["id", "title", "summary", "content", "content_type", "source"];
  if (!requiredStrings.every((key) => typeof value[key] === "string")) return false;
  if (!["markdown", "text", "json", "diff"].includes(String(value.content_type))) return false;
  if (!hasOnlyOptionalStrings(value, ["chat_id", "message_id", "workdir", "created_at"])) {
    return false;
  }
  return (
    value.changed_files == null ||
    (Array.isArray(value.changed_files) &&
      value.changed_files.every((item) => typeof item === "string"))
  );
}

function isGeminiLiveUsage(value: unknown): value is GeminiLiveUsage {
  if (!isRecord(value) || typeof value.estimated !== "boolean") return false;
  return [
    "input_text_chars",
    "output_text_chars",
    "input_audio_bytes",
    "output_audio_bytes",
    "estimated_input_tokens",
    "estimated_output_tokens",
    "estimated_total_tokens",
    "estimated_cost_usd",
  ].every((key) => typeof value[key] === "number");
}

function normalizeNullableFields(event: Record<string, unknown>, fields: string[]): void {
  fields.forEach((field) => {
    if (event[field] === null) delete event[field];
  });
}

function normalizeTimelineEvent(value: CodexTimelineEvent): CodexTimelineEvent {
  const event = { ...value } as Record<string, unknown>;
  normalizeNullableFields(event, [
    "summary",
    "item_type",
    "item_id",
    "turn_id",
    "thread_id",
    "command",
    "status",
    "output",
    "text",
    "token_usage",
  ]);
  if (isRecord(event.token_usage)) {
    const usage = { ...event.token_usage };
    normalizeNullableFields(usage, [
      "input_tokens",
      "output_tokens",
      "total_tokens",
      "cached_input_tokens",
    ]);
    event.token_usage = usage;
  }
  return event as CodexTimelineEvent;
}

function normalizeArtifact(value: ChatArtifact): ChatArtifact {
  const artifact = { ...value } as Record<string, unknown>;
  normalizeNullableFields(artifact, [
    "chat_id",
    "message_id",
    "workdir",
    "created_at",
    "changed_files",
  ]);
  return artifact as ChatArtifact;
}

function hasRequiredFields(event: Record<string, unknown>, type: ServerEventType): boolean {
  const requiredStrings: Partial<Record<ServerEventType, string[]>> = {
    assistant_audio_delta: ["data"],
    assistant_delta: ["text"],
    checkpoint: ["message"],
    debug: ["message"],
    delta: ["text"],
    done: ["text"],
    error: ["message"],
    gemini_tool_response_delivery_failed: ["message"],
    ready: ["message"],
    session_resume_failed: ["message"],
    status: ["message"],
    tool_call: ["task", "workdir"],
    tool_call_failed: ["message"],
    tool_call_started: ["name", "task", "workdir"],
    tool_progress: ["text"],
    tool_result: ["result"],
    tool_start_gemini_delivery_failed: ["message"],
    user_transcript: ["text"],
  };
  if (!(requiredStrings[type] || []).every((field) => typeof event[field] === "string")) {
    return false;
  }
  if (type === "codex_event") return isRecord(event.event);
  if (type === "session_refresh_requested") return typeof event.time_left === "string";
  if (type === "turn_complete") {
    return (
      typeof event.user_text === "string" &&
      typeof event.assistant_text === "string" &&
      typeof event.workdir === "string" &&
      typeof event.session_ended === "boolean"
    );
  }
  if (type === "background_job_completed") {
    return (
      typeof event.result === "string" &&
      typeof event.background_job_id === "string" &&
      isRecord(event.handoff) &&
      Array.isArray(event.artifacts)
    );
  }
  return true;
}

export function parseServerEvent(value: unknown): ServerEvent | null {
  if (
    !isRecord(value) ||
    typeof value.type !== "string" ||
    !SERVER_EVENT_TYPES.includes(value.type as ServerEventType)
  ) {
    return null;
  }
  const type = value.type as ServerEventType;
  const event = { ...value };
  const stringFields = [
    "message",
    "text",
    "name",
    "task",
    "result",
    "workdir",
    "data",
    "time_left",
    "user_text",
    "assistant_text",
    "codex_status",
    "codex_turn_id",
    "codex_thread_id",
    "background_job_id",
  ];
  normalizeNullableFields(event, stringFields);
  normalizeNullableFields(event, ["elapsed", "session_ended", "tool_calls"]);
  if (!stringFields.every((key) => event[key] === undefined || typeof event[key] === "string")) {
    return null;
  }
  if (event.elapsed != null && typeof event.elapsed !== "number") return null;
  if (event.session_ended != null && typeof event.session_ended !== "boolean") return null;
  if (event.audio_data_url != null && typeof event.audio_data_url !== "string") {
    return null;
  }
  if (event.tool_calls != null && !Array.isArray(event.tool_calls)) return null;
  if (event.event != null && !isCodexTimelineEvent(event.event)) return null;
  if (
    event.codex_events != null &&
    (!Array.isArray(event.codex_events) || !event.codex_events.every(isCodexTimelineEvent))
  ) {
    return null;
  }
  if (event.artifact != null && !isChatArtifact(event.artifact)) return null;
  if (event.change_artifact != null && !isChatArtifact(event.change_artifact)) return null;
  if (
    event.artifacts != null &&
    (!Array.isArray(event.artifacts) || !event.artifacts.every(isChatArtifact))
  ) {
    return null;
  }
  if (event.gemini_live_usage != null && !isGeminiLiveUsage(event.gemini_live_usage)) return null;
  if (
    event.handoff != null &&
    !hasOnlyOptionalStrings(event.handoff, ["id", "workdir", "codex_status"])
  ) {
    return null;
  }
  normalizeNullableFields(event, [
    "event",
    "codex_events",
    "artifact",
    "change_artifact",
    "artifacts",
    "gemini_live_usage",
    "handoff",
  ]);
  if (event.event) event.event = normalizeTimelineEvent(event.event);
  if (event.codex_events) {
    event.codex_events = event.codex_events.map(normalizeTimelineEvent);
  }
  if (event.artifact) event.artifact = normalizeArtifact(event.artifact);
  if (event.change_artifact) {
    event.change_artifact = normalizeArtifact(event.change_artifact);
  }
  if (event.artifacts) {
    event.artifacts = event.artifacts.map(normalizeArtifact);
  }
  if (isRecord(event.handoff)) {
    const handoff = { ...event.handoff };
    normalizeNullableFields(handoff, ["id", "workdir", "codex_status"]);
    event.handoff = handoff;
  }
  if (!hasRequiredFields(event, type)) return null;
  return { ...event, type };
}

export function parseServerEventJson(value: string): ServerEvent | null {
  try {
    return parseServerEvent(JSON.parse(value));
  } catch {
    return null;
  }
}
