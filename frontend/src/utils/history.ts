import type { HistoryRow, Message } from "../types";

export function insertMessageBefore(
  messages: Message[],
  message: Message,
  beforeId?: string | null,
): Message[] {
  if (!beforeId) return [...messages, message];
  const index = messages.findIndex((item) => item.id === beforeId);
  if (index < 0) return [...messages, message];
  return [...messages.slice(0, index), message, ...messages.slice(index)];
}

export function restoreMessagesAfterFailedClear(
  previous: readonly Message[],
  current: readonly Message[],
): Message[] {
  const currentById = new Map(current.map((message) => [message.id, message]));
  const previousIds = new Set(previous.map((message) => message.id));
  return [
    ...previous.map((message) => currentById.get(message.id) || message),
    ...current.filter((message) => !previousIds.has(message.id)),
  ];
}

export function historyRowsToMessages(rows: HistoryRow[]): Message[] {
  return rows
    .filter(
      (row) =>
        (row.role === "user" || row.role === "assistant") &&
        !(
          row.role === "user" &&
          row.meta?.direct_codex &&
          row.meta?.background_job_id &&
          !row.meta?.user_visible
        ),
    )
    .map((row) => ({
      id: row.id,
      role: row.role,
      text: row.text,
      artifacts: row.meta?.artifacts || [],
      usedCodex: Boolean(
        row.meta?.direct_codex ||
        (Array.isArray(row.meta?.tool_calls) && row.meta.tool_calls.length > 0) ||
        (Array.isArray(row.meta?.codex_events) && row.meta.codex_events.length > 0),
      ),
      workdir: row.meta?.workdir,
      codexEvents: row.meta?.codex_events || [],
      codexStatus: row.meta?.codex_status,
      codexTurnId: row.meta?.codex_turn_id,
      codexThreadId: row.meta?.codex_thread_id,
      ...(row.meta?.background_job_id ? { backgroundJobId: row.meta.background_job_id } : {}),
      geminiLiveUsage: row.meta?.gemini_live_usage,
    }));
}

export function mergeBackendHistoryWithLocalMessages(
  rows: HistoryRow[],
  localMessages: Message[],
): Message[] {
  const serverMessages = historyRowsToMessages(rows);
  const serverIds = new Set(serverMessages.map((message) => message.id));
  const persistedBackgroundMessages = new Set(
    serverMessages.flatMap((message) =>
      message.backgroundJobId ? [`${message.role}:${message.backgroundJobId}`] : [],
    ),
  );
  const pendingLocalMessages = localMessages.filter(
    (message) =>
      !(
        message.backgroundJobId &&
        persistedBackgroundMessages.has(`${message.role}:${message.backgroundJobId}`)
      ) &&
      (message.streaming || !serverIds.has(message.id)),
  );
  return [...serverMessages, ...pendingLocalMessages];
}
