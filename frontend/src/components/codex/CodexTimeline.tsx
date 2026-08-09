import { useMemo, useState } from "react";
import { ChevronRight, Zap } from "lucide-react";

import { CodexTimelineEvent } from "../../types";
import { cn } from "../../utils";

const TIMELINE_METHODS = new Set([
  "turn/started",
  "item/started",
  "item/completed",
  "turn/completed",
  "item/fileChange/patchUpdated",
  "item/plan/delta",
  "item/reasoning/summaryTextDelta",
]);

export default function CodexTimeline({
  events,
  status,
}: {
  events?: CodexTimelineEvent[];
  status?: string;
}) {
  const visible = useMemo(
    () => (events || []).filter((event) => TIMELINE_METHODS.has(event.method)),
    [events],
  );
  const terminal = ["completed", "failed", "cancelled", "canceled"].includes(
    (status || "").toLowerCase(),
  );
  const [open, setOpen] = useState(!terminal);
  if (visible.length === 0 && !status) return null;
  return (
    <details
      className="codex-timeline group/activity"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="codex-timeline-title cursor-pointer list-none">
        <Zap className="h-3 w-3" />
        <span>Activity</span>
        {visible.length > 0 && <span className="text-fg-muted">({visible.length})</span>}
        {status && <span className="codex-timeline-status">{status}</span>}
        <ChevronRight className="h-3.5 w-3.5 text-fg-muted transition-transform group-open/activity:rotate-90" />
      </summary>
      <div className="codex-timeline-list">
        {visible.slice(-12).map((event, index) => (
          <div
            key={`${event.method}-${event.item_id || index}-${index}`}
            className="codex-timeline-row"
          >
            <span
              className={cn("codex-timeline-dot", event.method === "turn/completed" && "done")}
            />
            <div className="min-w-0">
              <p className="codex-timeline-summary">{event.summary || event.method}</p>
              {event.command && <p className="codex-timeline-detail">{event.command}</p>}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
