import { Activity, Cable, Settings2, Zap } from "lucide-react";

import type { ConsoleTabId } from "../../hooks/useConsolePanelState";
import { cn } from "../../utils";

const CONSOLE_TABS: { id: ConsoleTabId; label: string; icon: typeof Activity }[] = [
  { id: "stream", label: "Stream", icon: Activity },
  { id: "actions", label: "Actions", icon: Zap },
  { id: "handoffs", label: "Handoffs", icon: Cable },
  { id: "voice", label: "Setup", icon: Settings2 },
];

type ConsoleTabsProps = {
  isMobile: boolean;
  activeTab: ConsoleTabId;
  onChange: (tab: ConsoleTabId) => void;
};

export default function ConsoleTabs({ isMobile, activeTab, onChange }: ConsoleTabsProps) {
  return (
    <div
      className="flex items-center gap-0.5 border-b border-line-soft px-2 pt-1.5 shrink-0 overflow-x-auto"
      role="tablist"
      aria-label="Console views"
    >
      {CONSOLE_TABS.map((tab, index) => {
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
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => {
              let nextIndex = -1;
              if (event.key === "ArrowRight") nextIndex = (index + 1) % CONSOLE_TABS.length;
              if (event.key === "ArrowLeft") {
                nextIndex = (index - 1 + CONSOLE_TABS.length) % CONSOLE_TABS.length;
              }
              if (event.key === "Home") nextIndex = 0;
              if (event.key === "End") nextIndex = CONSOLE_TABS.length - 1;
              if (nextIndex < 0) return;
              event.preventDefault();
              const nextTab = CONSOLE_TABS[nextIndex];
              onChange(nextTab.id);
              requestAnimationFrame(() =>
                document.getElementById(`console-tab-${nextTab.id}`)?.focus(),
              );
            }}
            className={cn(
              "relative flex items-center gap-1.5 px-2.5 py-2 text-[11.5px] transition-colors shrink-0",
              isMobile && "min-h-11",
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
