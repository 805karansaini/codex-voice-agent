import { Folder } from "lucide-react";

import type { ActionEntry } from "../../types";
import { cn } from "../../utils";
import MarkdownRenderer from "../common/MarkdownRenderer";

type ConsoleActionsPanelProps = {
  actions: ActionEntry[];
};

export default function ConsoleActionsPanel({ actions }: ConsoleActionsPanelProps) {
  return (
    <div
      id="console-panel-actions"
      role="tabpanel"
      aria-labelledby="console-tab-actions"
      className="space-y-2"
    >
      {actions.length === 0 ? (
        <div className="text-center py-12 text-fg-dim italic">No operator actions logged.</div>
      ) : (
        actions.map((action) => {
          const hasResponse =
            action.streamingResponse != null && action.streamingResponse.length > 0;
          return (
            <div
              key={action.id}
              className="panel p-0 text-xs bg-surface-2 border border-line overflow-hidden"
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-line-soft/40">
                <span className="font-mono text-[11px] text-accent font-semibold">
                  {action.title}
                </span>
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded font-mono text-[9px] font-bold uppercase",
                    action.status === "running"
                      ? "bg-accent/10 text-accent animate-pulse"
                      : action.status === "done"
                        ? "bg-success/15 text-success"
                        : "bg-danger/15 text-danger",
                  )}
                >
                  {action.status}
                </span>
              </div>

              <div className="action-chat-timeline">
                <div className="action-chat-row justify-end">
                  <div className="action-chat-bubble-user">{action.detail}</div>
                </div>

                {hasResponse ? (
                  <div className="action-chat-row justify-start">
                    <div
                      className={cn(
                        "action-chat-response-text",
                        action.status === "failed" && "text-danger",
                      )}
                    >
                      <MarkdownRenderer content={action.streamingResponse || ""} />
                      {action.status === "running" && <span className="caret" />}
                    </div>
                  </div>
                ) : action.status === "running" ? (
                  <div className="action-chat-row justify-start">
                    <div className="action-chat-response-text">
                      <div className="flex flex-col gap-1.5 py-1 w-full">
                        <span className="h-1.5 bg-fg-dim/15 rounded w-full animate-pulse" />
                        <span className="h-1.5 bg-fg-dim/15 rounded w-4/5 animate-pulse" />
                        <span className="h-1.5 bg-fg-dim/15 rounded w-3/5 animate-pulse" />
                      </div>
                    </div>
                  </div>
                ) : action.status === "failed" ? (
                  <div className="action-chat-row justify-start">
                    <div className="action-chat-response-text text-danger font-medium">
                      Failed to execute operator action.
                    </div>
                  </div>
                ) : null}
              </div>

              {action.workdir && (
                <div className="px-3 py-1.5 text-[9px] text-fg-dim font-mono border-t border-line-soft/40 flex items-center gap-1">
                  <Folder className="h-2.5 w-2.5" />
                  <span className="truncate">{action.workdir}</span>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
