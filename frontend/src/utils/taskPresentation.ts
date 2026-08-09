import type { ChatArtifact, Message } from "../types";

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isChangeArtifact(artifact: ChatArtifact): boolean {
  return artifact.source === "git_diff" || Boolean(artifact.changed_files?.length);
}

export function presentTaskArtifacts(
  artifacts: ChatArtifact[] | undefined,
  messageText: string,
): { changes: ChatArtifact[]; outputs: ChatArtifact[] } {
  const normalizedMessage = normalizeText(messageText);
  const changes: ChatArtifact[] = [];
  const outputs: ChatArtifact[] = [];

  for (const artifact of artifacts || []) {
    if (isChangeArtifact(artifact)) {
      changes.push(artifact);
      continue;
    }
    if (normalizedMessage && normalizeText(artifact.content) === normalizedMessage) continue;
    outputs.push(artifact);
  }

  return { changes, outputs };
}

export function taskState(message: Message): "running" | "completed" | "failed" {
  if (message.streaming) return "running";
  const status = (message.codexStatus || "").toLowerCase();
  if (status.includes("fail") || status.includes("error") || status.includes("cancel")) {
    return "failed";
  }
  return "completed";
}

export function taskAgentName(message: Message): "Claude" | "Codex" | "Coding agent" {
  if (message.codingHarness === "claude") return "Claude";
  if (message.codingHarness === "codex") return "Codex";
  const evidence = [
    ...(message.artifacts || []).flatMap((artifact) => [artifact.title, artifact.source]),
  ].join(" ");
  if (/\bclaude\b/i.test(evidence)) return "Claude";
  if (/\bcodex\b/i.test(evidence)) return "Codex";
  return "Coding agent";
}

export function taskSummary(message: Message): string {
  const firstLine = message.text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/[*_`#>]/g, "")
    .replace(/\[(.*?)\]\([^)]*\)/g, "$1")
    .trim();
  if (!firstLine) return message.streaming ? "Working on the request" : "Task details";
  return firstLine.length > 110 ? `${firstLine.slice(0, 107).trimEnd()}…` : firstLine;
}
