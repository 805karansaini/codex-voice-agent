import type { CodexTimelineEvent, GeminiLiveUsage, Message } from "../../types";

function codexTokenTotal(messages: { codexEvents?: CodexTimelineEvent[] }[]): number {
  return messages.reduce((total, message) => {
    const usageEvents = (message.codexEvents || []).filter((event) => event.token_usage);
    const latestUsage = usageEvents[usageEvents.length - 1]?.token_usage;
    return total + (latestUsage?.total_tokens || 0);
  }, 0);
}

function geminiLiveUsageTotal(messages: { geminiLiveUsage?: GeminiLiveUsage }[]): {
  tokens: number;
  cost: number;
} {
  return messages.reduce(
    (total, message) => ({
      tokens: total.tokens + (message.geminiLiveUsage?.estimated_total_tokens || 0),
      cost: total.cost + (message.geminiLiveUsage?.estimated_cost_usd || 0),
    }),
    { tokens: 0, cost: 0 },
  );
}

type ConsoleStatsFooterProps = {
  messages: Message[];
};

export default function ConsoleStatsFooter({ messages }: ConsoleStatsFooterProps) {
  const estimatedContextTokens = Math.round(
    messages.reduce((acc, message) => acc + (message.text?.length || 0), 0) / 4.2,
  );
  const geminiUsage = geminiLiveUsageTotal(messages);

  return (
    <div className="grid grid-cols-4 border-t border-line-soft shrink-0 bg-surface-1/40">
      <div className="px-3 py-1.5">
        <div className="label text-[9px]">conversation size</div>
        <div className="mt-0.5 flex items-baseline gap-0.5">
          <span className="font-mono text-[13px] font-semibold text-fg tabular-nums">
            {messages.length}
          </span>
          <span className="font-mono text-[9px] text-fg-dim">messages</span>
        </div>
      </div>
      <div
        className="px-3 py-1.5 border-l border-line-soft"
        title="Rough estimate based on message text length. Actual model context may differ."
        aria-label={`Estimated context: approximately ${estimatedContextTokens.toLocaleString()} tokens. Rough estimate based on message text length; actual model context may differ.`}
      >
        <div className="label text-[9px]">estimated context</div>
        <div className="mt-0.5 flex items-baseline gap-0.5">
          <span className="font-mono text-[13px] font-semibold text-fg tabular-nums">
            {estimatedContextTokens.toLocaleString()}
          </span>
          <span className="font-mono text-[9px] text-fg-dim">≈ tokens</span>
        </div>
      </div>
      <div className="px-3 py-1.5 border-l border-line-soft">
        <div className="label text-[9px]">codex tokens</div>
        <div className="mt-0.5 flex items-baseline gap-0.5">
          <span className="font-mono text-[13px] font-semibold text-fg tabular-nums">
            {codexTokenTotal(messages).toLocaleString()}
          </span>
          <span className="font-mono text-[9px] text-fg-dim">tokens</span>
        </div>
      </div>
      <div className="px-3 py-1.5 border-l border-line-soft">
        <div className="label text-[9px]">gemini live</div>
        <div className="mt-0.5 flex items-baseline gap-0.5">
          <span className="font-mono text-[13px] font-semibold text-fg tabular-nums">
            {geminiUsage.tokens.toLocaleString()}
          </span>
          <span className="font-mono text-[9px] text-fg-dim">
            ≈ tokens / ${geminiUsage.cost.toFixed(4)}
          </span>
        </div>
      </div>
    </div>
  );
}
