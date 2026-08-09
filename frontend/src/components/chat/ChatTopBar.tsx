import { Circle, Download } from "lucide-react";

import type { ChatMode } from "../../types";
import { cn } from "../../utils";

type ChatTopBarProps = {
  isMobile: boolean;
  title: string;
  messageCount: number;
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  onExport: () => void;
  exportDisabled: boolean;
  voiceSupported: boolean;
  voiceActive: boolean;
  voiceDisabled: boolean;
  onToggleVoice: () => void;
};

export default function ChatTopBar({
  isMobile,
  title,
  messageCount,
  mode,
  onModeChange,
  onExport,
  exportDisabled,
  voiceSupported,
  voiceActive,
  voiceDisabled,
  onToggleVoice,
}: ChatTopBarProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center border-b border-line bg-surface-1/55 backdrop-blur-xl",
        isMobile ? "justify-center gap-4 px-3 py-2.5" : "justify-between px-6 py-3",
      )}
    >
      {!isMobile && (
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="truncate text-[15px] font-semibold tracking-[-0.015em]">{title}</h1>
          {messageCount > 0 && (
            <span className="shrink-0 rounded-full border border-line bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-fg-muted">
              {messageCount} {messageCount === 1 ? "message" : "messages"}
            </span>
          )}
        </div>
      )}

      <div className={cn("flex items-center gap-2", isMobile && "w-full justify-between")}>
        <div
          className="inline-flex items-center rounded-md border border-line bg-surface-2 p-0.5"
          role="group"
          aria-label="Experience mode"
        >
          {(["agent", "codex"] as const).map((item) => (
            <button
              type="button"
              key={item}
              onClick={() => onModeChange(item)}
              aria-pressed={mode === item}
              className={cn(
                "rounded-md px-3 py-1.5 font-mono text-[11.5px] uppercase tracking-wider transition-all",
                isMobile ? "min-h-11" : "min-h-0",
                mode === item ? "bg-surface-3 text-fg shadow-sm" : "text-fg-dim hover:text-fg",
              )}
            >
              {item === "codex" ? "code" : "voice"}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onExport}
          disabled={exportDisabled}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface-2 px-3 py-1.5 font-mono text-[11.5px] uppercase tracking-wider text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40",
            isMobile ? "min-h-11 min-w-11" : "min-h-0 min-w-0",
          )}
          title="Export chat as markdown"
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Export</span>
        </button>

        {voiceSupported && (
          <button
            type="button"
            onClick={onToggleVoice}
            disabled={voiceDisabled}
            aria-label={voiceActive ? "End live voice session" : "Start live voice session"}
            aria-pressed={voiceActive}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[11.5px] uppercase tracking-wider transition-all disabled:cursor-not-allowed disabled:opacity-40",
              isMobile ? "min-h-11" : "min-h-0",
              voiceActive
                ? "border-accent bg-accent/15 text-accent glow-accent"
                : "border-line bg-surface-2 text-fg-muted hover:text-fg",
            )}
          >
            <Circle className={cn("h-2 w-2 fill-current", voiceActive && "pulse-dot")} />
            {voiceActive ? "End" : "Start"}
          </button>
        )}
      </div>
    </div>
  );
}
