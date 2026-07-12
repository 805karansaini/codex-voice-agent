import type { BackendStatus } from "../hooks/useBackendStatus";

type BackendStatusKind = BackendStatus["kind"];

export type BackendRecoveryState = "idle" | "refreshing" | "failed";

export function backendRecoveryIsReady(statusKind: BackendStatusKind): boolean {
  return statusKind === "ready" || statusKind === "missing_key";
}

export function shouldAttemptBackendRecovery(
  recoveryNeeded: boolean,
  statusKind: BackendStatusKind,
  recoveryInFlight: boolean,
): boolean {
  return recoveryNeeded && backendRecoveryIsReady(statusKind) && !recoveryInFlight;
}

export function backendRecoverySucceeded(workspaceLoaded: boolean, modelsLoaded: boolean): boolean {
  return workspaceLoaded && modelsLoaded;
}
