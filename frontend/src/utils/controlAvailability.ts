import type { ChatMode, Message } from "../types";
import type { BackendStatus } from "../hooks/useBackendStatus";

type BackendStatusKind = BackendStatus["kind"];

export function isRequestUnavailable(statusKind: BackendStatusKind, mode: ChatMode): boolean {
  return (
    statusKind === "offline" ||
    statusKind === "checking" ||
    (statusKind === "missing_key" && mode === "agent")
  );
}

export function isVoiceControlDisabled({
  voiceActive,
  hasProject,
  busy,
  statusKind,
}: {
  voiceActive: boolean;
  hasProject: boolean;
  busy: boolean;
  statusKind: BackendStatusKind;
}): boolean {
  if (voiceActive) return false;
  return !hasProject || busy || statusKind !== "ready";
}

export function hasActiveBackgroundJob(messages: readonly Message[]): boolean {
  return messages.some((message) => Boolean(message.backgroundJobId) && message.streaming);
}

type VoiceScope = { projectId: string; chatId: string } | null;

export function blockingVoiceActivity({
  projectId,
  chatId,
  voiceActive,
  voiceScope,
  backgroundJobScope,
}: {
  projectId: string;
  chatId?: string;
  voiceActive: boolean;
  voiceScope: VoiceScope;
  backgroundJobScope: VoiceScope;
}): "voice" | "job" | null {
  const matches = (scope: VoiceScope) =>
    scope?.projectId === projectId && (!chatId || scope.chatId === chatId);
  if (matches(backgroundJobScope)) return "job";
  if (voiceActive && matches(voiceScope)) return "voice";
  return null;
}
