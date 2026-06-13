import type { HistoryRow, Message } from "../types";

export function historyRowsToMessages(rows: HistoryRow[]): Message[] {
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
