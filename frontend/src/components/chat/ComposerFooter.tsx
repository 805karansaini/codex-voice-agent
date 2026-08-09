import React from "react";
import {
  ArrowUp,
  ChevronDown,
  Info,
  Mic,
  MicOff,
  PencilLine,
  RefreshCw,
  SlidersHorizontal,
  WifiOff,
  X,
} from "lucide-react";

import { cn } from "../../utils";
import type { VoiceInputMode } from "../../hooks/useVoiceInputMode";
import type { ChatMode, CodexModel, CodingHarness, CodingHarnessInfo } from "../../types";
import type { BackendStatus } from "../../hooks/useBackendStatus";
import type { BackendRecoveryState } from "../../utils/backendRecovery";
import { isRequestUnavailable } from "../../utils/controlAvailability";

type ComposerFooterProps = {
  isMobile: boolean;
  liveStatusText: string;
  streamingStatusText: string;
  voiceActive: boolean;
  voiceReconnecting: boolean;
  codexActive: boolean;
  voiceTitle: string;
  voiceMessage: string;
  voiceContextLabel: string;
  voiceTranscriptPreview: string;
  voiceMuted: boolean;
  voiceInputMode: VoiceInputMode;
  mode: ChatMode;
  input: string;
  busy: boolean;
  hasActiveProject: boolean;
  error: string;
  failedRequestError: string;
  failedRequestText: string;
  failedRequestCount: number;
  backendStatus: BackendStatus;
  backendRecoveryState: BackendRecoveryState;
  codexModels: CodexModel[];
  codingHarnesses: CodingHarnessInfo[];
  codingHarness: CodingHarness;
  codexModel: string;
  codexReasoningEffort: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onInputChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: () => void;
  onCancelTask: () => void;
  onRestoreFailedRequest: () => void;
  onDismissError: () => void;
  onDismissFailedRequest: () => void;
  onRetryBackend: () => void;
  onCodexModelChange: (model: string) => void;
  onCodingHarnessChange: (harness: CodingHarness) => void;
  onCodexReasoningEffortChange: (effort: string) => void;
  onToggleMute: () => void;
  onHoldToTalk: () => void;
  onReleaseToMute: () => void;
};

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export default function ComposerFooter({
  isMobile,
  liveStatusText,
  streamingStatusText,
  voiceActive,
  voiceReconnecting,
  codexActive,
  voiceTitle,
  voiceMessage,
  voiceContextLabel,
  voiceTranscriptPreview,
  voiceMuted,
  voiceInputMode,
  mode,
  input,
  busy,
  hasActiveProject,
  error,
  failedRequestError,
  failedRequestText,
  failedRequestCount,
  backendStatus,
  backendRecoveryState,
  codexModels,
  codingHarnesses,
  codingHarness,
  codexModel,
  codexReasoningEffort,
  textareaRef,
  onInputChange,
  onSubmit,
  onCancelTask,
  onRestoreFailedRequest,
  onDismissError,
  onDismissFailedRequest,
  onRetryBackend,
  onCodexModelChange,
  onCodingHarnessChange,
  onCodexReasoningEffortChange,
  onToggleMute,
  onHoldToTalk,
  onReleaseToMute,
}: ComposerFooterProps) {
  const [elapsed, setElapsed] = React.useState(0);
  const [cancelling, setCancelling] = React.useState(false);
  const busyStartedAtRef = React.useRef<number | null>(null);
  const backendOffline = backendStatus.kind === "offline";
  const backendUnavailable = isRequestUnavailable(backendStatus.kind, mode);
  const showBackendStatus = backendStatus.kind !== "ready" || backendRecoveryState !== "idle";
  const backendRecoveryFailed =
    backendStatus.kind !== "offline" &&
    backendStatus.kind !== "checking" &&
    backendRecoveryState === "failed";
  const backendRefreshing =
    backendStatus.kind !== "offline" &&
    backendStatus.kind !== "checking" &&
    backendRecoveryState === "refreshing";
  const canSend = Boolean(input.trim() && hasActiveProject && !busy && !backendUnavailable);
  const selectedCodexModel = codexModels.find((item) => item.model === codexModel);
  const selectedHarness = codingHarnesses.find((item) => item.id === codingHarness);
  const provider = codingHarness === "claude" ? "Claude" : "Codex";

  React.useEffect(() => {
    if (!busy) {
      busyStartedAtRef.current = null;
      setElapsed(0);
      setCancelling(false);
      return;
    }
    busyStartedAtRef.current ??= Date.now();
    const update = () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - (busyStartedAtRef.current || 0)) / 1000)));
    };
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [busy]);

  return (
    <footer
      className={cn(
        "shrink-0 bg-gradient-to-t from-surface-0 via-surface-0/95 to-transparent",
        isMobile ? "px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2.5" : "px-6 pb-4 pt-3",
      )}
    >
      <div className="mx-auto max-w-[820px]">
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {liveStatusText}
        </div>
        <div className="sr-only" aria-live="polite" aria-atomic="false">
          {streamingStatusText}
        </div>
        {showBackendStatus && (
          <div
            role={backendOffline || backendRecoveryFailed ? "alert" : "status"}
            className={cn(
              "mb-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-[11.5px]",
              backendOffline || backendRecoveryFailed
                ? "border-danger/30 bg-danger/10 text-danger"
                : backendStatus.kind === "missing_key"
                  ? "border-warn/30 bg-warn/10 text-warn"
                  : "border-line bg-surface-2 text-fg-muted",
            )}
          >
            {backendOffline ? (
              <WifiOff className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  (backendStatus.kind === "checking" || backendRefreshing) && "animate-spin",
                )}
              />
            )}
            <span className="min-w-0 flex-1">
              {backendOffline
                ? "Backend unavailable. Your draft is safe while you reconnect."
                : backendRecoveryFailed
                  ? "Backend reconnected, but some workspace data could not be refreshed."
                  : backendRefreshing
                    ? "Backend reconnected. Refreshing projects, chats, and models…"
                    : backendStatus.kind === "missing_key"
                      ? "Google API key is missing. Voice mode is unavailable; Code mode still works."
                      : "Checking the backend connection…"}
            </span>
            {(backendOffline || backendRecoveryFailed) && (
              <button
                type="button"
                onClick={onRetryBackend}
                className="rounded border border-danger/30 px-2 py-1 font-semibold hover:bg-danger/10"
              >
                Retry
              </button>
            )}
          </div>
        )}
        {(voiceActive || codexActive) && (
          <div className="mb-3 rounded-lg border border-accent/25 bg-surface-2 p-3.5 shadow-lg flex items-center gap-3.5 animate-in slide-in-from-bottom-2 duration-200">
            <div className={cn("equalizer shrink-0", voiceMuted && "paused")}>
              <i />
              <i />
              <i />
              <i />
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-[12.5px] font-semibold text-fg tracking-tight leading-none flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-dot" />
                {voiceTitle}
              </p>
              <p className="hidden sm:block text-[11.5px] text-fg-muted mt-1 truncate">
                {voiceMessage}
              </p>
              {voiceReconnecting && (
                <p className="mt-1 text-[11.5px] font-medium text-accent">
                  Briefly reconnecting — please hold on.
                </p>
              )}
              {voiceContextLabel && (
                <p className="text-[10.5px] text-fg-dim mt-1 truncate">
                  Attached to {voiceContextLabel}
                </p>
              )}
              {voiceTranscriptPreview && (
                <p className="text-[11.5px] text-accent font-mono italic mt-1 truncate bg-accent/5 border border-accent/10 rounded px-1.5 py-0.5 max-w-full">
                  "{voiceTranscriptPreview}"
                </p>
              )}
            </div>

            {voiceActive && (
              <div className="flex items-center gap-2 shrink-0">
                {voiceInputMode === "push" ? (
                  <button
                    type="button"
                    aria-label={voiceMuted ? "Hold to talk" : "Voice input is listening"}
                    onPointerDown={onHoldToTalk}
                    onPointerUp={onReleaseToMute}
                    onPointerCancel={onReleaseToMute}
                    onPointerLeave={onReleaseToMute}
                    onKeyDown={(event) => {
                      if (event.key === " " || event.key === "Enter") onHoldToTalk();
                    }}
                    onKeyUp={(event) => {
                      if (event.key === " " || event.key === "Enter") onReleaseToMute();
                    }}
                    className={cn(
                      "flex min-h-14 min-w-14 items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-[11.5px] font-semibold transition-colors sm:min-h-0 sm:min-w-0",
                      voiceMuted
                        ? "border-accent/30 bg-accent/10 text-accent"
                        : "border-success/30 bg-success/10 text-success",
                    )}
                  >
                    {voiceMuted ? (
                      <MicOff className="h-5 w-5 sm:h-3.5 sm:w-3.5" />
                    ) : (
                      <Mic className="h-5 w-5 sm:h-3.5 sm:w-3.5" />
                    )}
                    {!isMobile && <span>{voiceMuted ? "Hold to talk" : "Listening"}</span>}
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={voiceMuted ? "Unmute voice input" : "Mute voice input"}
                    aria-pressed={voiceMuted}
                    onClick={onToggleMute}
                    className={cn(
                      "flex min-h-14 min-w-14 items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors sm:min-h-0 sm:min-w-0",
                      voiceMuted
                        ? "border-danger/30 bg-danger/10 text-danger"
                        : "border-line bg-surface-3 text-fg-muted hover:text-fg",
                    )}
                  >
                    {voiceMuted ? (
                      <MicOff className="h-5 w-5 sm:h-3.5 sm:w-3.5" />
                    ) : (
                      <Mic className="h-5 w-5 sm:h-3.5 sm:w-3.5" />
                    )}
                    {!isMobile && <span>{voiceMuted ? "Unmute" : "Mute"}</span>}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {busy && (
          <div className="mb-2 flex items-center gap-2 px-1 text-[11.5px] text-fg-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-dot" />
            <span>
              {cancelling
                ? "Cancelling response…"
                : mode === "codex"
                  ? `Starting ${provider} task · ${formatElapsed(elapsed)}`
                  : `Response in progress · ${formatElapsed(elapsed)}`}
            </span>
          </div>
        )}

        <div className="surface-elevated ring-accent-focus overflow-hidden rounded-xl border border-line bg-surface-1 transition-all">
          <textarea
            id="message-composer"
            aria-label="Message Vodex"
            ref={textareaRef}
            value={input}
            onChange={onInputChange}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (canSend) onSubmit();
              }
            }}
            disabled={!hasActiveProject || busy}
            rows={isMobile ? 2 : 3}
            placeholder={
              !hasActiveProject
                ? isMobile
                  ? "Select a project to start..."
                  : "Create or select a project folder to start..."
                : isMobile
                  ? "Ask anything or describe a change..."
                  : "Ask anything, describe a change, or plan your next task..."
            }
            className="block w-full resize-none bg-transparent px-4 py-3.5 text-[14px] leading-relaxed text-fg placeholder:text-fg-dim focus:outline-none disabled:opacity-50"
          />

          <div
            className={cn(
              "border-t border-line-soft bg-surface-1/80 p-2",
              isMobile ? "flex items-start gap-2" : "flex flex-wrap items-center justify-between",
            )}
          >
            {isMobile ? (
              <details className="group/settings min-w-0 flex-1 rounded-lg border border-line bg-surface-2">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-[12px] font-medium text-fg">
                  <SlidersHorizontal className="h-4 w-4 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate">
                    {selectedHarness?.displayName || provider}
                    {selectedCodexModel ? ` · ${selectedCodexModel.displayName}` : ""}
                    {codexReasoningEffort ? ` · ${codexReasoningEffort}` : ""}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-fg-muted transition-transform group-open/settings:rotate-180" />
                </summary>
                <div className="grid gap-2 border-t border-line-soft p-2.5">
                  {codingHarnesses.length > 0 && (
                    <label className="grid gap-1 text-[11.5px] text-fg-muted">
                      Agent
                      <select
                        aria-label="Coding agent"
                        value={codingHarness}
                        onChange={(event) =>
                          onCodingHarnessChange(event.target.value as CodingHarness)
                        }
                        disabled={busy}
                        className="min-h-11 w-full min-w-0 rounded-md border border-line bg-surface-1 px-2.5 text-[13px] text-fg"
                      >
                        {codingHarnesses.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.displayName}
                            {!item.authenticated ? " (sign in required)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {codexModels.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="grid min-w-0 gap-1 text-[11.5px] text-fg-muted">
                        Model
                        <select
                          aria-label={`${provider} model`}
                          value={codexModel}
                          onChange={(event) => onCodexModelChange(event.target.value)}
                          disabled={busy || codexModels.length === 0}
                          className="min-h-11 w-full min-w-0 rounded-md border border-line bg-surface-1 px-2 text-[13px] text-fg"
                        >
                          {codexModels.map((item) => (
                            <option key={item.id} value={item.model}>
                              {item.displayName}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid min-w-0 gap-1 text-[11.5px] text-fg-muted">
                        Reasoning
                        <select
                          aria-label={`${provider} reasoning effort`}
                          value={codexReasoningEffort}
                          onChange={(event) => onCodexReasoningEffortChange(event.target.value)}
                          disabled={busy || !selectedCodexModel}
                          className="min-h-11 w-full min-w-0 rounded-md border border-line bg-surface-1 px-2 text-[13px] text-fg"
                        >
                          {(selectedCodexModel?.supportedReasoningEfforts || []).map((item) => (
                            <option key={item.reasoningEffort} value={item.reasoningEffort}>
                              {item.reasoningEffort || "Default"}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                  {selectedHarness?.usagePolicy && (
                    <p className="flex gap-1.5 text-[11.5px] leading-relaxed text-fg-muted">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                      {selectedHarness.usagePolicy}
                    </p>
                  )}
                </div>
              </details>
            ) : (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-[11.5px] font-medium text-fg-muted">Agent</span>
                {codingHarnesses.length > 0 && (
                  <select
                    aria-label="Coding agent"
                    value={codingHarness}
                    onChange={(event) => onCodingHarnessChange(event.target.value as CodingHarness)}
                    disabled={busy}
                    className="rounded border border-line bg-surface-2 px-2 py-1.5 text-[12px] text-fg"
                  >
                    {codingHarnesses.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.displayName}
                        {!item.authenticated ? " (sign in required)" : ""}
                      </option>
                    ))}
                  </select>
                )}
                {codexModels.length > 0 && (
                  <>
                    <select
                      aria-label={`${provider} model`}
                      value={codexModel}
                      onChange={(event) => onCodexModelChange(event.target.value)}
                      disabled={busy || codexModels.length === 0}
                      className="max-w-36 rounded border border-line bg-surface-2 px-2 py-1.5 text-[12px] text-fg"
                    >
                      {codexModels.map((item) => (
                        <option key={item.id} value={item.model}>
                          {item.displayName}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`${provider} reasoning effort`}
                      value={codexReasoningEffort}
                      onChange={(event) => onCodexReasoningEffortChange(event.target.value)}
                      disabled={busy || !selectedCodexModel}
                      className="rounded border border-line bg-surface-2 px-2 py-1.5 text-[12px] text-fg"
                    >
                      {(selectedCodexModel?.supportedReasoningEfforts || []).map((item) => (
                        <option key={item.reasoningEffort} value={item.reasoningEffort}>
                          {item.reasoningEffort || "Default"}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                {selectedHarness?.usagePolicy && (
                  <details className="group/access">
                    <summary
                      className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
                      aria-label={`${provider} access details`}
                    >
                      <Info className="h-3.5 w-3.5" />
                    </summary>
                    <p className="mt-1 max-w-72 rounded-lg border border-line bg-surface-2 p-3 text-[11.5px] leading-relaxed text-fg-muted shadow-lg">
                      {selectedHarness.usagePolicy}
                    </p>
                  </details>
                )}
              </div>
            )}

            <div className={cn("flex items-center gap-2", !isMobile && "ml-auto")}>
              {busy && mode === "agent" && (
                <button
                  type="button"
                  onClick={() => {
                    setCancelling(true);
                    onCancelTask();
                  }}
                  disabled={cancelling}
                  aria-label={cancelling ? "Cancelling response" : "Cancel response"}
                  className="rounded px-2.5 py-1 text-[11px] font-mono uppercase bg-danger/10 hover:bg-danger/25 text-danger font-semibold border border-danger/20 transition-colors"
                >
                  {cancelling ? "Cancelling…" : "Cancel"}
                </button>
              )}
              <button
                type="button"
                onClick={onSubmit}
                disabled={!canSend}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3.5 text-[12px] font-semibold transition-all",
                  isMobile ? "min-h-11" : "min-h-0 py-1.5",
                  canSend
                    ? "bg-accent text-accent-foreground hover:brightness-110 shadow-sm"
                    : "bg-surface-2 text-fg-dim cursor-not-allowed",
                )}
              >
                <span>Send</span>
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-2 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2.5 text-xs text-danger"
          >
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />
            <div className="min-w-0 flex-1">
              <p className="break-words leading-relaxed">{error}</p>
            </div>
            <button
              type="button"
              onClick={onDismissError}
              className="rounded p-1 hover:bg-danger/10"
              aria-label="Dismiss error"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {failedRequestError && (
          <div
            role="alert"
            className="mt-2 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2.5 text-xs text-danger"
          >
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />
            <div className="min-w-0 flex-1">
              <p className="break-words leading-relaxed">{failedRequestError}</p>
              {failedRequestText && !busy && (
                <div className="mt-2">
                  <p className="mb-2 text-[11px] leading-relaxed text-danger/90">
                    {failedRequestCount > 1
                      ? `${failedRequestCount} requests from this chat need review. Check existing results and file changes before sending any of them again.`
                      : "This request may have started before the connection failed. Review existing results and file changes before sending it again."}
                  </p>
                  <button
                    type="button"
                    onClick={onRestoreFailedRequest}
                    className="inline-flex items-center gap-1 rounded border border-danger/30 px-2 py-1 font-semibold hover:bg-danger/10"
                  >
                    <PencilLine className="h-3 w-3" />
                    Review request
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onDismissFailedRequest}
              className="rounded p-1 hover:bg-danger/10"
              aria-label="Dismiss failed request"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </footer>
  );
}
