import type { ServerEvent } from "../types/protocol";
import { parseServerEventJson } from "../types/protocol.ts";

export type SseStreamSummary = {
  receivedDone: boolean;
  lastError: string;
};

export async function readSseStream(
  res: Response,
  onEvent: (evt: ServerEvent) => void,
): Promise<SseStreamSummary> {
  const summary: SseStreamSummary = { receivedDone: false, lastError: "" };
  if (!res.body) return summary;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";
    for (const frame of frames) {
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      const event = parseServerEventJson(data.trim());
      if (event) {
        if (event.type === "done") summary.receivedDone = true;
        if (event.type === "error") summary.lastError = event.message || "Vodex failed.";
        onEvent(event);
      }
    }
  }
  return summary;
}
