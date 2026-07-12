import type { CodexTimelineEvent } from "../types";

const MAX_CODEX_TIMELINE_EVENTS = 80;

function eventKey(event: CodexTimelineEvent): string {
  return `${event.method}:${event.item_id || ""}:${event.turn_id || ""}`;
}

export function appendCodexEvent(
  events: CodexTimelineEvent[] | undefined,
  event: CodexTimelineEvent,
): CodexTimelineEvent[] {
  const current = events || [];
  const key = eventKey(event);
  if (current.some((item) => eventKey(item) === key)) return current;
  return [...current, event].slice(-MAX_CODEX_TIMELINE_EVENTS);
}
