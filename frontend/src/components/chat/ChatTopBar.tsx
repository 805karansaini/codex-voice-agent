import { Circle, Download } from "lucide-react";

import { cn } from "../../utils";

type ChatMode = "agent" | "codex";

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
        "flex items-center border-b border-line bg-surface-1/40 shrink-0",
        isMobile ? "justify-center gap-4 px-3 py-2" : "justify-between px-5 py-2.5",
      )}
    >
      {!isMobile && (
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="truncate text-[14px] font-semibold tracking-tight">{title}</h2>
          {messageCount > 0 && (
            <span className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted shrink-0">
              {messageCount} turns
            </span>
          )}
        </div>
      )}

      <div className={cn("flex items-center gap-2", isMobile && "w-full justify-between")}>
        <div className="inline-flex items-center rounded-md border border-line bg-surface-2 p-0.5">
          {(["agent", "codex"] as const).map((item) => (
            <button
              key={item}
              onClick={() => onModeChange(item)}
              className={cn(
                "rounded px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-wider transition-colors",
                mode === item ? "bg-surface-3 text-fg" : "text-fg-dim hover:text-fg",
              )}
            >
              {item === "codex" ? "vodex" : item}
            </button>
          ))}
        </div>

        <button
          onClick={onExport}
          disabled={exportDisabled}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-wider text-fg-muted transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
          title="Export chat as markdown"
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Export</span>
        </button>

        {voiceSupported && (
          <button
            onClick={onToggleVoice}
            disabled={voiceDisabled}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed",
              voiceActive
                ? "border-accent bg-accent/15 text-accent glow-accent"
                : "border-line bg-surface-2 text-fg-muted hover:text-fg",
            )}
          >
            <Circle className={cn("h-2 w-2 fill-current", voiceActive && "pulse-dot")} />
            {voiceActive ? "Live" : "Idle"}
          </button>
        )}
      </div>
    </div>
  );
}
