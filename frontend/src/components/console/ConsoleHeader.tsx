import { SquareTerminal, X } from "lucide-react";

import type { BackendStatus } from "../../hooks/useBackendStatus";
import { cn } from "../../utils";

type ConsoleHeaderProps = {
  isMobile: boolean;
  status: BackendStatus;
  canClear: boolean;
  onHide: () => void;
  onBackToChat: () => void;
  onClear: () => void;
};

export default function ConsoleHeader({
  isMobile,
  status,
  canClear,
  onHide,
  onBackToChat,
  onClear,
}: ConsoleHeaderProps) {
  const statusText =
    status.kind === "ready"
      ? "online"
      : status.kind === "missing_key"
        ? "setup"
        : status.kind === "checking"
          ? "checking"
          : "offline";

  return (
    <div className="flex items-center justify-between border-b border-line-soft px-3 py-2.5 shrink-0">
      <div className="flex items-center gap-2">
        <SquareTerminal className="h-3.5 w-3.5 text-accent" />
        <span className="text-[12.5px] font-semibold tracking-tight">Console</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          title={isMobile ? "Go back to chat" : "Hide console panel"}
          aria-label={isMobile ? "Go back to chat" : "Hide console panel"}
          onClick={isMobile ? onBackToChat : onHide}
          className={cn(
            "grid place-items-center rounded text-fg-muted hover:bg-surface-2 hover:text-fg",
            isMobile ? "h-11 w-11" : "h-6 w-6",
          )}
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={onClear}
          disabled={!canClear}
          title={
            canClear
              ? "Clear this thread"
              : "Clearing is unavailable while a thread is missing or work is running"
          }
          className={cn(
            "rounded border border-line bg-surface-2 px-1.5 font-mono text-[10.5px] uppercase text-fg-dim hover:border-fg-muted hover:text-fg disabled:opacity-40",
            isMobile ? "min-h-11" : "py-0.5",
          )}
        >
          Clear
        </button>

        <span
          role="status"
          aria-label={`Backend status: ${status.label}`}
          className="flex items-center gap-1.5 font-mono text-[10px] text-fg-dim"
          title={status.label}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full pulse-dot",
              status.kind === "ready"
                ? "bg-success"
                : status.kind === "missing_key" || status.kind === "checking"
                  ? "bg-warn"
                  : "bg-danger",
            )}
          />
          {statusText}
        </span>
      </div>
    </div>
  );
}
