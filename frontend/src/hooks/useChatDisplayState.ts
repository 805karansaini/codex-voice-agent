import type { CodingHarness, Message } from "../types";
import type { useLiveVoice } from "./useLiveVoice";
import type { ActiveCodexJobStatus } from "./useLiveVoiceSessionHandlers";

type LiveVoice = ReturnType<typeof useLiveVoice>;

const formatElapsed = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
};

export function codingAgentWorkingName(harness: CodingHarness): string {
  return harness === "claude" ? "Claudex" : "Codex";
}

export function codingAgentWorkingTitle(harness: CodingHarness, elapsed: number): string {
  return `${codingAgentWorkingName(harness)} is working (${formatElapsed(elapsed)})`;
}

export function useChatDisplayState({
  liveVoice,
  voiceActive,
  busy,
  mode,
  messages,
  activeCodexJob,
}: {
  liveVoice: LiveVoice;
  voiceActive: boolean;
  busy: boolean;
  mode: "agent" | "codex";
  messages: Message[];
  activeCodexJob?: ActiveCodexJobStatus | null;
}) {
  const workingHarness = activeCodexJob?.harness || "codex";
  const codexElapsed = activeCodexJob
    ? Math.max(0, Math.floor((Date.now() - activeCodexJob.startedAt) / 1000))
    : 0;
  const voiceTitle = activeCodexJob
    ? codingAgentWorkingTitle(workingHarness, codexElapsed)
    : liveVoice.state === "connecting"
      ? "Connecting…"
      : liveVoice.state === "reconnecting"
        ? "Reconnecting Gemini…"
        : liveVoice.state === "live"
          ? "Live conversation"
          : liveVoice.state === "thinking"
            ? "Vodex is responding"
            : liveVoice.state === "working"
              ? codingAgentWorkingTitle(workingHarness, liveVoice.elapsed)
              : liveVoice.state === "error"
                ? "Voice needs attention"
                : "Live voice";
  const liveStatusText = [
    voiceActive || activeCodexJob ? voiceTitle : "",
    activeCodexJob ? activeCodexJob.task : voiceActive ? liveVoice.message : "",
    busy ? "Assistant response in progress" : "",
  ]
    .filter(Boolean)
    .join(". ");
  const activeStreamingMessage = [...messages]
    .reverse()
    .find((message) => message.streaming && message.role === "assistant");
  const streamingStatusText = activeStreamingMessage?.text
    ? `Assistant response update: ${activeStreamingMessage.text.slice(-500)}`
    : busy
      ? "Assistant response in progress"
      : "";

  const suggestions =
    mode === "codex"
      ? [
          "Review the current changes and flag any risks",
          "Find and fix the most likely cause of the failing tests",
          "Implement this repository's next incomplete task",
          "Run the relevant checks and summarize what passed",
        ]
      : [
          "Give me a quick tour of this project",
          "What should I focus on next in this repository?",
          "Explain the latest changes in plain English",
          "Help me plan a safe approach before changing anything",
        ];

  const voiceMessage = activeCodexJob ? activeCodexJob.task : liveVoice.message;

  return { voiceTitle, voiceMessage, liveStatusText, streamingStatusText, suggestions };
}
