import { useMemo } from "react";
import { Zap } from "lucide-react";

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
  if (visible.length === 0 && !status) return null;
  return (
    <div className="codex-timeline">
      <div className="codex-timeline-title">
        <Zap className="h-3 w-3" />
        <span>Vodex turn</span>
        {status && <span className="codex-timeline-status">{status}</span>}
      </div>
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
    </div>
  );
}
