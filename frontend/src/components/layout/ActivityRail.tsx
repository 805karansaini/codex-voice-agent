import { FileCode2, Moon, Plus, Settings, SquareTerminal, Sun } from "lucide-react";

type ActivityRailProps = {
  theme: "dark" | "light";
  activeView: "chats" | "files";
  onNewProject: () => void;
  onViewChange: (view: "chats" | "files") => void;
  onToggleTheme: () => void;
  onOpenConsoleSettings: () => void;
};

export default function ActivityRail({
  theme,
  activeView,
  onNewProject,
  onViewChange,
  onToggleTheme,
  onOpenConsoleSettings,
}: ActivityRailProps) {
  return (
    <nav
      aria-label="Workspace views"
      className="flex w-16 shrink-0 flex-col items-center justify-between border-r border-line bg-surface-1 py-3.5"
    >
      <div className="flex w-full flex-col gap-1.5 px-2">
        <button
          type="button"
          title="Chats"
          onClick={() => onViewChange("chats")}
          className={`group relative flex h-12 w-full flex-col items-center justify-center gap-1 rounded-lg transition-colors ${activeView === "chats" ? "bg-accent/10 text-accent" : "text-fg-dim hover:bg-surface-2 hover:text-fg"}`}
          aria-current={activeView === "chats" ? "page" : undefined}
        >
          {activeView === "chats" && (
            <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-accent" />
          )}
          <SquareTerminal className="h-4.5 w-4.5" />
          <span className="font-mono text-[9px] uppercase tracking-[0.12em]">Chats</span>
        </button>
        <button
          type="button"
          title="Project files"
          onClick={() => onViewChange("files")}
          className={`group relative flex h-12 w-full flex-col items-center justify-center gap-1 rounded-lg transition-colors ${activeView === "files" ? "bg-accent/10 text-accent" : "text-fg-dim hover:bg-surface-2 hover:text-fg"}`}
          aria-current={activeView === "files" ? "page" : undefined}
        >
          {activeView === "files" && (
            <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-accent" />
          )}
          <FileCode2 className="h-4.5 w-4.5" />
          <span className="font-mono text-[9px] uppercase tracking-[0.12em]">Files</span>
        </button>
      </div>

      <div className="flex flex-col items-center gap-2.5 w-full px-2">
        <button
          type="button"
          title="New project"
          aria-label="New project"
          onClick={onNewProject}
          className="grid h-9 w-9 place-items-center rounded-md text-fg-dim hover:bg-surface-2 hover:text-accent border border-dashed border-line"
        >
          <Plus className="h-4.5 w-4.5" />
        </button>
        <button
          type="button"
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          aria-pressed={theme === "light"}
          onClick={onToggleTheme}
          className="grid h-9 w-9 place-items-center rounded-md text-fg-dim hover:bg-surface-2 hover:text-fg"
        >
          {theme === "dark" ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
        </button>
        <button
          type="button"
          title="Console settings"
          aria-label="Console settings"
          onClick={onOpenConsoleSettings}
          className="grid h-9 w-9 place-items-center rounded-md text-fg-dim hover:bg-surface-2 hover:text-fg"
        >
          <Settings className="h-4.5 w-4.5" />
        </button>
        <span className="h-px w-6 bg-line-soft" />
      </div>
    </nav>
  );
}
