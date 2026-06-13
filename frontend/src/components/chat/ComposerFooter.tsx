import React from "react";
import { ArrowUp, Mic, MicOff } from "lucide-react";

import { cn } from "../../utils";
import type { VoiceInputMode } from "../../hooks/useVoiceInputMode";

type ComposerFooterProps = {
  isMobile: boolean;
  liveStatusText: string;
  streamingStatusText: string;
  voiceActive: boolean;
  voiceTitle: string;
  voiceMessage: string;
  voiceContextLabel: string;
  voiceTranscriptPreview: string;
  voiceMuted: boolean;
  voiceSupported: boolean;
  voiceInputMode: VoiceInputMode;
  input: string;
  busy: boolean;
  hasActiveProject: boolean;
  error: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onInputChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: () => void;
  onCancelTask: () => void;
  onToggleVoice: () => void;
  onToggleMute: () => void;
  onHoldToTalk: () => void;
  onReleaseToMute: () => void;
};

export default function ComposerFooter({
  isMobile,
  liveStatusText,
  streamingStatusText,
  voiceActive,
  voiceTitle,
  voiceMessage,
  voiceContextLabel,
  voiceTranscriptPreview,
  voiceMuted,
  voiceSupported,
  voiceInputMode,
  input,
  busy,
  hasActiveProject,
  error,
  textareaRef,
  onInputChange,
  onSubmit,
  onCancelTask,
  onToggleVoice,
  onToggleMute,
  onHoldToTalk,
  onReleaseToMute,
}: ComposerFooterProps) {
  const canSend = Boolean(input.trim() && hasActiveProject && !busy);

  return (
    <footer
      className={cn(
        "border-t border-line bg-surface-1/40 shrink-0",
        isMobile ? "px-3 py-2.5" : "px-5 py-3",
      )}
    >
      <div className="mx-auto max-w-[760px]">
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {liveStatusText}
        </div>
        <div className="sr-only" aria-live="polite" aria-atomic="false">
          {streamingStatusText}
        </div>
        {voiceActive && (
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
              <p className="text-[11.5px] text-fg-muted mt-1 truncate">{voiceMessage}</p>
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

            <div className="flex items-center gap-2 shrink-0">
              {voiceInputMode === "push" ? (
                <button
                  type="button"
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
                    "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[11.5px] font-semibold transition-colors",
                    voiceMuted
                      ? "border-accent/30 bg-accent/10 text-accent"
                      : "border-success/30 bg-success/10 text-success",
                  )}
                >
                  {voiceMuted ? (
                    <MicOff className="h-3.5 w-3.5" />
                  ) : (
                    <Mic className="h-3.5 w-3.5" />
                  )}
                  {!isMobile && <span>{voiceMuted ? "Hold to talk" : "Listening"}</span>}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onToggleMute}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors",
                    voiceMuted
                      ? "border-danger/30 bg-danger/10 text-danger"
                      : "border-line bg-surface-3 text-fg-muted hover:text-fg",
                  )}
                >
                  {voiceMuted ? (
                    <MicOff className="h-3.5 w-3.5" />
                  ) : (
                    <Mic className="h-3.5 w-3.5" />
                  )}
                  {!isMobile && <span>{voiceMuted ? "Unmute" : "Mute"}</span>}
                </button>
              )}
              <button
                type="button"
                onClick={onToggleVoice}
                className="flex items-center gap-1.5 rounded-md bg-danger text-white px-3 py-1.5 text-[11.5px] font-semibold hover:brightness-110 transition-colors shadow-sm"
              >
                <MicOff className="h-3.5 w-3.5" />
                {!isMobile && <span>End</span>}
              </button>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-line bg-surface-1 ring-accent-focus transition-all overflow-hidden">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={onInputChange}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSubmit();
              }
            }}
            disabled={!hasActiveProject || busy}
            rows={2}
            placeholder={
              !hasActiveProject
                ? isMobile
                  ? "Select a project to start..."
                  : "Create or select a project folder to start..."
                : isMobile
                  ? "Ask or describe changes..."
                  : "Type operator commands, ask questions, or describe changes..."
            }
            className="block w-full resize-none bg-transparent px-3.5 py-3 text-[13.5px] leading-relaxed text-fg placeholder:text-fg-dim focus:outline-none disabled:opacity-50"
          />

          <div className="flex items-center justify-between border-t border-line-soft px-2 py-1.5 bg-surface-1/80">
            <div className="flex items-center gap-0.5">
              {voiceSupported && (
                <button
                  title={voiceTitle}
                  onClick={onToggleVoice}
                  disabled={!hasActiveProject}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] disabled:opacity-40 transition-colors",
                    voiceActive
                      ? "bg-accent/15 text-accent font-semibold"
                      : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  {voiceMuted ? (
                    <MicOff className="h-3.5 w-3.5" />
                  ) : (
                    <Mic className="h-3.5 w-3.5" />
                  )}
                  <span>Voice</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {busy && (
                <button
                  onClick={onCancelTask}
                  className="rounded px-2.5 py-1 text-[11px] font-mono uppercase bg-danger/10 hover:bg-danger/25 text-danger font-semibold border border-danger/20 transition-colors"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={onSubmit}
                disabled={!canSend}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[12px] font-semibold transition-all",
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
          <div className="mt-2 text-xs text-danger flex items-center gap-1.5 font-mono px-1">
            <span className="h-1.5 w-1.5 rounded-full bg-danger inline-block animate-ping" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </footer>
  );
}
