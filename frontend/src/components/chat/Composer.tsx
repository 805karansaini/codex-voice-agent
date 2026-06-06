import React, { useRef } from "react";
import { ArrowUp, Microphone, MicrophoneSlash, Plugs, Terminal } from "@phosphor-icons/react";

interface ComposerProps {
  input: string;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: () => void;
  voiceActive: boolean;
  onVoiceToggle: () => void;
  voiceSupported: boolean;
  voiceMuted: boolean;
  voiceToggleMute: () => void;
  voiceMessage: string;
  voiceState: string;
  voiceTranscriptPreview: string;
  voiceTitle: string;
  busy: boolean;
  hasActiveProject: boolean;
  activeProjectPath?: string;
  mode: "agent" | "codex";
  error: string;
  primeAudio: () => void;
  onCancelTask?: () => void;
}

export const Composer: React.FC<ComposerProps> = ({
  input,
  onInputChange,
  onSubmit,
  voiceActive,
  onVoiceToggle,
  voiceSupported,
  voiceMuted,
  voiceToggleMute,
  voiceMessage,
  voiceState,
  voiceTranscriptPreview,
  voiceTitle,
  busy,
  hasActiveProject,
  activeProjectPath,
  mode,
  error,
  primeAudio,
  onCancelTask,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      primeAudio();
      onSubmit();
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }
  };

  const handleSend = () => {
    primeAudio();
    onSubmit();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const placeholderText = () => {
    if (!hasActiveProject) {
      return "Create a project to start chatting…";
    }
    if (mode === "codex") {
      return "Tell Codex exactly what to do in this directory…";
    }
    return "Ask the agent about this project…";
  };

  return (
    <div className="composerWrap">
      {voiceActive && (
        <div className="liveBanner">
          <div className={`liveCard ${voiceState === "error" ? "error" : ""}`}>
            <div className={`equalizer ${voiceMuted ? "paused" : ""}`}>
              <span className="bars">
                <i />
                <i />
                <i />
                <i />
              </span>
            </div>
            <div className="liveBody">
              <p className="liveTitle">{voiceTitle}</p>
              <p className="liveMsg">{voiceMessage}</p>
              {voiceTranscriptPreview && <p className="livePreview">{voiceTranscriptPreview}</p>}
            </div>
            <button
              className={`muteLive ${voiceMuted ? "muted" : ""}`}
              type="button"
              onClick={voiceToggleMute}
              title={voiceMuted ? "Unmute microphone" : "Mute microphone"}
            >
              {voiceMuted ? (
                <MicrophoneSlash size={16} weight="bold" />
              ) : (
                <Microphone size={16} weight="bold" />
              )}
              <span>{voiceMuted ? "Unmute" : "Mute"}</span>
            </button>
            <button className="endLive" type="button" onClick={onVoiceToggle}>
              <MicrophoneSlash size={16} weight="bold" /> End
            </button>
          </div>
        </div>
      )}

      <div className="composer">
        {error && (
          <div className="errorStrip">
            <Plugs size={15} weight="bold" /> {error}
          </div>
        )}

        <div className="composerBox">
          <button
            className={`micBtn ${voiceActive ? "live" : ""}`}
            type="button"
            onClick={onVoiceToggle}
            disabled={!voiceSupported || busy || !hasActiveProject}
            aria-label={voiceActive ? "End live voice" : "Start live voice"}
            title={
              !voiceSupported
                ? "Live microphone audio is not available in this browser"
                : "Live voice"
            }
          >
            {voiceActive ? (
              <MicrophoneSlash size={19} weight="bold" />
            ) : (
              <Microphone size={19} weight="bold" />
            )}
          </button>
          
          <textarea
            ref={textareaRef}
            value={input}
            onChange={onInputChange}
            disabled={!hasActiveProject}
            placeholder={placeholderText()}
            onKeyDown={handleKeyDown}
          />
          
          {busy ? (
            <button
              className="stopBtn"
              type="button"
              onClick={onCancelTask}
              aria-label="Cancel task"
              title="Cancel running task"
            >
              <span className="stopIcon" />
            </button>
          ) : (
            <button
              className="sendBtn"
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || !hasActiveProject}
              aria-label="Send"
            >
              <ArrowUp size={20} weight="bold" />
            </button>
          )}
        </div>

        <div className="composerFoot">
          <span className="composerHint">
            <kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> newline
          </span>
          {hasActiveProject && activeProjectPath && (
            <span className="composerCwd">
              <Terminal size={12} weight="bold" /> {activeProjectPath}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
export default Composer;
