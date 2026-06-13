import { Activity, Cable, Waves, Zap } from "lucide-react";

import type { ConsoleTabId } from "../../hooks/useConsolePanelState";
import { cn } from "../../utils";

const CONSOLE_TABS: { id: ConsoleTabId; label: string; icon: typeof Activity }[] = [
  { id: "stream", label: "Stream", icon: Activity },
  { id: "actions", label: "Actions", icon: Zap },
  { id: "handoffs", label: "Handoffs", icon: Cable },
  { id: "voice", label: "Voice", icon: Waves },
];

type ConsoleTabsProps = {
  activeTab: ConsoleTabId;
  onChange: (tab: ConsoleTabId) => void;
};

export default function ConsoleTabs({ activeTab, onChange }: ConsoleTabsProps) {
  return (
    <div
      className="flex items-center gap-0.5 border-b border-line-soft px-2 pt-1.5 shrink-0 overflow-x-auto"
      role="tablist"
      aria-label="Console views"
    >
      {CONSOLE_TABS.map((tab) => {
        const active = activeTab === tab.id;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            id={`console-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`console-panel-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative flex items-center gap-1.5 px-2.5 py-2 text-[11.5px] transition-colors shrink-0",
              active ? "text-fg" : "text-fg-dim hover:text-fg",
            )}
          >
            <Icon className="h-3 w-3" />
            {tab.label}
            {active && <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-t bg-accent" />}
          </button>
        );
      })}
    </div>
  );
}
