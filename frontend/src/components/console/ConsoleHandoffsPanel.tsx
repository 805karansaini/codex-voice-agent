import { ChevronRight } from "lucide-react";

import type { Handoff } from "../../types";

type ConsoleHandoffsPanelProps = {
  handoffs: Handoff[];
};

export default function ConsoleHandoffsPanel({ handoffs }: ConsoleHandoffsPanelProps) {
  return (
    <div
      id="console-panel-handoffs"
      role="tabpanel"
      aria-labelledby="console-tab-handoffs"
      className="space-y-2"
    >
      {handoffs.length === 0 ? (
        <div className="text-center py-12 text-fg-dim italic">
          No handoffs between Agent and Codex.
        </div>
      ) : (
        handoffs.map((handoff, index) => (
          <div key={handoff.id} className="panel p-2.5 text-xs bg-surface-2 border border-line">
            <div className="flex items-center gap-2 font-mono text-[10.5px]">
              <span className="text-fg-muted">agent</span>
              <ChevronRight className="h-3 w-3 text-accent" />
              <span className="text-accent">codex</span>
              <span className="ml-auto text-fg-dim font-semibold">#{handoffs.length - index}</span>
            </div>
            <p className="mt-1.5 text-[11.5px] text-fg-muted leading-relaxed whitespace-pre-wrap">
              {handoff.summary}
            </p>
          </div>
        ))
      )}
    </div>
  );
}
