import {
  Activity,
  Cable,
  FileCode2,
  Moon,
  Plus,
  Settings,
  SquareTerminal,
  Sun,
} from "lucide-react";

type ActivityRailProps = {
  theme: "dark" | "light";
  onNewProject: () => void;
  onToggleTheme: () => void;
  onOpenConsoleSettings: () => void;
};

export default function ActivityRail({
  theme,
  onNewProject,
  onToggleTheme,
  onOpenConsoleSettings,
}: ActivityRailProps) {
  return (
    <div className="w-14 shrink-0 flex flex-col justify-between items-center border-r border-line bg-surface-1 py-3">
      <div className="flex flex-col gap-1 w-full px-2">
        <button
          title="Chats"
          className="group relative flex h-11 w-full flex-col items-center justify-center gap-0.5 rounded-md bg-surface-2 text-accent"
        >
          <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-accent" />
          <SquareTerminal className="h-4.5 w-4.5" />
          <span className="font-mono text-[9px] uppercase tracking-wider scale-90">Chats</span>
        </button>
        <button
          title="Files coming soon"
          disabled
          className="group flex h-11 w-full cursor-not-allowed flex-col items-center justify-center gap-0.5 rounded-md text-fg-dim opacity-35"
        >
          <FileCode2 className="h-4.5 w-4.5" />
          <span className="font-mono text-[9px] uppercase tracking-wider scale-90">Files</span>
        </button>
        <button
          title="Runs coming soon"
          disabled
          className="group flex h-11 w-full cursor-not-allowed flex-col items-center justify-center gap-0.5 rounded-md text-fg-dim opacity-35"
        >
          <Activity className="h-4.5 w-4.5" />
          <span className="font-mono text-[9px] uppercase tracking-wider scale-90">Runs</span>
        </button>
        <button
          title="MCP toolkits coming soon"
          disabled
          className="group flex h-11 w-full cursor-not-allowed flex-col items-center justify-center gap-0.5 rounded-md text-fg-dim opacity-35"
        >
          <Cable className="h-4.5 w-4.5" />
          <span className="font-mono text-[9px] uppercase tracking-wider scale-90">MCP</span>
        </button>
      </div>

      <div className="flex flex-col items-center gap-2.5 w-full px-2">
        <button
          title="New project"
          onClick={onNewProject}
          className="grid h-9 w-9 place-items-center rounded-md text-fg-dim hover:bg-surface-2 hover:text-accent border border-dashed border-line"
        >
          <Plus className="h-4.5 w-4.5" />
        </button>
        <button
          title={theme === "dark" ? "Switch to light" : "Switch to dark"}
          onClick={onToggleTheme}
          className="grid h-9 w-9 place-items-center rounded-md text-fg-dim hover:bg-surface-2 hover:text-fg"
        >
          {theme === "dark" ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
        </button>
        <button
          title="Console Settings"
          onClick={onOpenConsoleSettings}
          className="grid h-9 w-9 place-items-center rounded-md text-fg-dim hover:bg-surface-2 hover:text-fg"
        >
          <Settings className="h-4.5 w-4.5" />
        </button>
        <span className="h-px w-6 bg-line-soft" />
      </div>
    </div>
  );
}
