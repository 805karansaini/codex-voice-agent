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
  const online = status.kind === "ready";

  return (
    <div className="flex items-center justify-between border-b border-line-soft px-3 py-2.5 shrink-0">
      <div className="flex items-center gap-2">
        <SquareTerminal className="h-3.5 w-3.5 text-accent" />
        <span className="text-[12.5px] font-semibold tracking-tight">Console</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          title={isMobile ? "Go back to chat" : "Hide console panel"}
          onClick={isMobile ? onBackToChat : onHide}
          className="grid h-6 w-6 place-items-center rounded text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <button
          onClick={onClear}
          disabled={!canClear}
          className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border border-line bg-surface-2 text-fg-dim hover:text-fg hover:border-fg-muted disabled:opacity-40"
        >
          Clear
        </button>

        <span
          className="flex items-center gap-1.5 font-mono text-[10px] text-fg-dim"
          title={status.label}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full pulse-dot",
              online ? "bg-success" : "bg-danger",
            )}
          />
          {online ? "online" : "offline"}
        </span>
      </div>
    </div>
  );
}
