import type { ChangeEvent, RefObject } from "react";

import type { ChatArtifact, Message, Project } from "../../types";
import type { VoiceInputMode } from "../../hooks/useVoiceInputMode";
import ChatStream from "./ChatStream";
import ChatTopBar from "./ChatTopBar";
import ComposerFooter from "./ComposerFooter";

type ChatMode = "agent" | "codex";

type ChatPanelProps = {
  isMobile: boolean;
  title: string;
  messageCount: number;
  mode: ChatMode;
  exportDisabled: boolean;
  voiceSupported: boolean;
  voiceActive: boolean;
  codexActive: boolean;
  voiceDisabled: boolean;
  busy: boolean;
  activeProject?: Project | null;
  messages: Message[];
  suggestions: string[];
  messageEndRef: RefObject<HTMLDivElement | null>;
  liveStatusText: string;
  streamingStatusText: string;
  voiceTitle: string;
  voiceMessage: string;
  voiceContextLabel: string;
  voiceTranscriptPreview: string;
  voiceMuted: boolean;
  voiceInputMode: VoiceInputMode;
  input: string;
  hasActiveProject: boolean;
  error: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onModeChange: (mode: ChatMode) => void;
  onExport: () => void;
  onToggleVoice: () => void;
  onAddProject: () => void;
  onSuggestion: (suggestion: string) => void;
  onCommitChangeReview: (artifact: ChatArtifact) => void;
  onRevertChangeReview: (artifact: ChatArtifact) => void;
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: () => void;
  onCancelTask: () => void;
  onToggleMute: () => void;
  onHoldToTalk: () => void;
  onReleaseToMute: () => void;
};

export default function ChatPanel({
  isMobile,
  title,
  messageCount,
  mode,
  exportDisabled,
  voiceSupported,
  voiceActive,
  codexActive,
  voiceDisabled,
  busy,
  activeProject,
  messages,
  suggestions,
  messageEndRef,
  liveStatusText,
  streamingStatusText,
  voiceTitle,
  voiceMessage,
  voiceContextLabel,
  voiceTranscriptPreview,
  voiceMuted,
  voiceInputMode,
  input,
  hasActiveProject,
  error,
  textareaRef,
  onModeChange,
  onExport,
  onToggleVoice,
  onAddProject,
  onSuggestion,
  onCommitChangeReview,
  onRevertChangeReview,
  onInputChange,
  onSubmit,
  onCancelTask,
  onToggleMute,
  onHoldToTalk,
  onReleaseToMute,
}: ChatPanelProps) {
  return (
    <main className="flex flex-1 min-w-0 min-h-0 flex-col bg-surface-0 relative">
      <ChatTopBar
        isMobile={isMobile}
        title={title}
        messageCount={messageCount}
        mode={mode}
        onModeChange={onModeChange}
        onExport={onExport}
        exportDisabled={exportDisabled}
        voiceSupported={voiceSupported}
        voiceActive={voiceActive}
        voiceDisabled={voiceDisabled}
        onToggleVoice={onToggleVoice}
      />
      <ChatStream
        isMobile={isMobile}
        busy={busy}
        mode={mode}
        activeProject={activeProject}
        messages={messages}
        suggestions={suggestions}
        messageEndRef={messageEndRef}
        onAddProject={onAddProject}
        onSuggestion={onSuggestion}
        onCommitChangeReview={onCommitChangeReview}
        onRevertChangeReview={onRevertChangeReview}
      />

      <ComposerFooter
        isMobile={isMobile}
        liveStatusText={liveStatusText}
        streamingStatusText={streamingStatusText}
        voiceActive={voiceActive}
        codexActive={codexActive}
        voiceTitle={voiceTitle}
        voiceMessage={voiceMessage}
        voiceContextLabel={voiceContextLabel}
        voiceTranscriptPreview={voiceTranscriptPreview}
        voiceMuted={voiceMuted}
        voiceSupported={voiceSupported}
        voiceInputMode={voiceInputMode}
        input={input}
        busy={busy}
        hasActiveProject={hasActiveProject}
        error={error}
        textareaRef={textareaRef}
        onInputChange={onInputChange}
        onSubmit={onSubmit}
        onCancelTask={onCancelTask}
        onToggleVoice={onToggleVoice}
        onToggleMute={onToggleMute}
        onHoldToTalk={onHoldToTalk}
        onReleaseToMute={onReleaseToMute}
      />
    </main>
  );
}
