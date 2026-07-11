export function liveVoiceStartDeliveryFailureMessage(raw?: unknown): string {
  const message = typeof raw === "string" ? raw.trim() : "";
  return (
    message ||
    "Gemini reconnected before confirming the background task start. Codex is still running and its progress remains available in this chat."
  );
}
