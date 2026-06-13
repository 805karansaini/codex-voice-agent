import type { CodexTimelineEvent, Message } from "../../types";

function codexTokenTotal(messages: { codexEvents?: CodexTimelineEvent[] }[]): number {
  return messages.reduce((total, message) => {
    const usageEvents = (message.codexEvents || []).filter((event) => event.token_usage);
    const latestUsage = usageEvents[usageEvents.length - 1]?.token_usage;
    return total + (latestUsage?.total_tokens || 0);
  }, 0);
}

type ConsoleStatsFooterProps = {
  messages: Message[];
};

export default function ConsoleStatsFooter({ messages }: ConsoleStatsFooterProps) {
  const estimatedContextTokens = Math.round(
    messages.reduce((acc, message) => acc + (message.text?.length || 0), 0) / 4.2,
  );

  return (
    <div className="grid grid-cols-3 border-t border-line-soft shrink-0 bg-surface-1/40">
      <div className="px-3 py-1.5">
        <div className="label text-[9px]">conversation size</div>
        <div className="mt-0.5 flex items-baseline gap-0.5">
          <span className="font-mono text-[13px] font-semibold text-fg tabular-nums">
            {messages.length}
          </span>
          <span className="font-mono text-[9px] text-fg-dim">turns</span>
        </div>
      </div>
      <div className="px-3 py-1.5 border-l border-line-soft">
        <div className="label text-[9px]">estimated context</div>
        <div className="mt-0.5 flex items-baseline gap-0.5">
          <span className="font-mono text-[13px] font-semibold text-fg tabular-nums">
            {estimatedContextTokens.toLocaleString()}
          </span>
          <span className="font-mono text-[9px] text-fg-dim">≈ tokens</span>
        </div>
      </div>
      <div className="px-3 py-1.5 border-l border-line-soft">
        <div className="label text-[9px]">codex usage</div>
        <div className="mt-0.5 flex items-baseline gap-0.5">
          <span className="font-mono text-[13px] font-semibold text-fg tabular-nums">
            {codexTokenTotal(messages).toLocaleString()}
          </span>
          <span className="font-mono text-[9px] text-fg-dim">tokens</span>
        </div>
      </div>
    </div>
  );
}
