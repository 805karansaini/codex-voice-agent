import type { DebugEntry } from "../../types";

type ConsoleStreamPanelProps = {
  entries: DebugEntry[];
};

export default function ConsoleStreamPanel({ entries }: ConsoleStreamPanelProps) {
  return (
    <div
      id="console-panel-stream"
      role="tabpanel"
      aria-labelledby="console-tab-stream"
      className="font-mono text-[11px] leading-relaxed"
    >
      {entries.length === 0 ? (
        <div className="text-center py-12 text-fg-dim italic">Waiting for events...</div>
      ) : (
        entries.map((entry) => (
          <div
            key={entry.id}
            className="grid grid-cols-[82px_1fr] items-baseline gap-2 py-0.5 border-b border-line-soft/30"
          >
            <span className="text-fg-dim shrink-0">{entry.time}</span>
            <span className="text-fg/85 break-all whitespace-pre-wrap">{entry.message}</span>
          </div>
        ))
      )}
    </div>
  );
}
