import { Message } from "../types";
import type { useLiveVoice } from "./useLiveVoice";

type LiveVoice = ReturnType<typeof useLiveVoice>;

const formatElapsed = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
};

export function useChatDisplayState({
  liveVoice,
  voiceActive,
  busy,
  mode,
  messages,
}: {
  liveVoice: LiveVoice;
  voiceActive: boolean;
  busy: boolean;
  mode: "agent" | "codex";
  messages: Message[];
}) {
  const voiceTitle =
    liveVoice.state === "connecting"
      ? "Connecting…"
      : liveVoice.state === "live"
        ? "Live conversation"
        : liveVoice.state === "thinking"
          ? "Gemini is responding"
          : liveVoice.state === "working"
            ? `Codex is working (${formatElapsed(liveVoice.elapsed)})`
            : liveVoice.state === "error"
              ? "Voice needs attention"
              : "Live voice";
  const liveStatusText = [
    voiceActive ? voiceTitle : "",
    voiceActive ? liveVoice.message : "",
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
          "List the files in this directory",
          "Show the git status",
          "Run the test suite",
          "Summarize this codebase",
        ]
      : [
          "Find all TODOs in the codebase",
          "What changed in the last commit?",
          "Explain the main entry point of the project",
          "Explain the project structure",
        ];

  return { voiceTitle, liveStatusText, streamingStatusText, suggestions };
}
