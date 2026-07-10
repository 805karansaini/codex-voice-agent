export function liveVoiceDeliveryFailureMessage(raw?: unknown): string {
  const message = typeof raw === "string" ? raw.trim() : "";
  return (
    message ||
    "Vodex completed, but Gemini reconnected before reading the result. The next voice session will include it."
  );
}
