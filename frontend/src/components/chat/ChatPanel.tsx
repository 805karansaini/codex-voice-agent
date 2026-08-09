import type { ChangeEvent, RefObject } from "react";

import type {
  ChatArtifact,
  ChatMode,
  CodexModel,
  CodingHarness,
  CodingHarnessInfo,
  Message,
  Project,
} from "../../types";
import type { VoiceInputMode } from "../../hooks/useVoiceInputMode";
import type { BackendStatus } from "../../hooks/useBackendStatus";
import type { BackendRecoveryState } from "../../utils/backendRecovery";
import ChatStream from "./ChatStream";
import ChatTopBar from "./ChatTopBar";
import ComposerFooter from "./ComposerFooter";

type ChatPanelProps = {
  isMobile: boolean;
  title: string;
  messageCount: number;
  mode: ChatMode;
  exportDisabled: boolean;
  voiceSupported: boolean;
  voiceActive: boolean;
  voiceReconnecting: boolean;
  codexActive: boolean;
  voiceDisabled: boolean;
  busy: boolean;
  activeProject?: Project | null;
  messages: Message[];
  suggestions: string[];
  scrollContainerRef: RefObject<HTMLElement | null>;
  messageEndRef: RefObject<HTMLDivElement | null>;
  showJumpToLatest: boolean;
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
  failedRequestError: string;
  failedRequestText: string;
  failedRequestCount: number;
  backendRecoveryState: BackendRecoveryState;
  backendStatus: BackendStatus;
  codexModels: CodexModel[];
  codingHarnesses: CodingHarnessInfo[];
  codingHarness: CodingHarness;
  codexModel: string;
  codexReasoningEffort: string;
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
  onRestoreFailedRequest: () => void;
  onDismissError: () => void;
  onDismissFailedRequest: () => void;
  onRetryBackend: () => void;
  onJumpToLatest: () => void;
  onCodexModelChange: (model: string) => void;
  onCodingHarnessChange: (harness: CodingHarness) => void;
  onCodexReasoningEffortChange: (effort: string) => void;
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
  voiceReconnecting,
  codexActive,
  voiceDisabled,
  busy,
  activeProject,
  messages,
  suggestions,
  scrollContainerRef,
  messageEndRef,
  showJumpToLatest,
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
  failedRequestError,
  failedRequestText,
  failedRequestCount,
  backendRecoveryState,
  backendStatus,
  codexModels,
  codingHarnesses,
  codingHarness,
  codexModel,
  codexReasoningEffort,
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
  onRestoreFailedRequest,
  onDismissError,
  onDismissFailedRequest,
  onRetryBackend,
  onJumpToLatest,
  onCodexModelChange,
  onCodingHarnessChange,
  onCodexReasoningEffortChange,
  onToggleMute,
  onHoldToTalk,
  onReleaseToMute,
}: ChatPanelProps) {
  return (
    <main className="workspace-canvas relative flex min-h-0 min-w-0 flex-1 flex-col">
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
        codingHarness={codingHarness}
        activeProject={activeProject}
        messages={messages}
        suggestions={suggestions}
        scrollContainerRef={scrollContainerRef}
        messageEndRef={messageEndRef}
        showJumpToLatest={showJumpToLatest}
        onAddProject={onAddProject}
        onSuggestion={onSuggestion}
        onCommitChangeReview={onCommitChangeReview}
        onRevertChangeReview={onRevertChangeReview}
        onJumpToLatest={onJumpToLatest}
      />

      <ComposerFooter
        isMobile={isMobile}
        liveStatusText={liveStatusText}
        streamingStatusText={streamingStatusText}
        voiceActive={voiceActive}
        voiceReconnecting={voiceReconnecting}
        codexActive={codexActive}
        voiceTitle={voiceTitle}
        voiceMessage={voiceMessage}
        voiceContextLabel={voiceContextLabel}
        voiceTranscriptPreview={voiceTranscriptPreview}
        voiceMuted={voiceMuted}
        voiceSupported={voiceSupported}
        voiceDisabled={voiceDisabled}
        voiceInputMode={voiceInputMode}
        mode={mode}
        input={input}
        busy={busy}
        hasActiveProject={hasActiveProject}
        error={error}
        failedRequestError={failedRequestError}
        failedRequestText={failedRequestText}
        failedRequestCount={failedRequestCount}
        backendStatus={backendStatus}
        backendRecoveryState={backendRecoveryState}
        codexModels={codexModels}
        codingHarnesses={codingHarnesses}
        codingHarness={codingHarness}
        codexModel={codexModel}
        codexReasoningEffort={codexReasoningEffort}
        textareaRef={textareaRef}
        onInputChange={onInputChange}
        onSubmit={onSubmit}
        onCancelTask={onCancelTask}
        onRestoreFailedRequest={onRestoreFailedRequest}
        onDismissError={onDismissError}
        onDismissFailedRequest={onDismissFailedRequest}
        onRetryBackend={onRetryBackend}
        onCodexModelChange={onCodexModelChange}
        onCodingHarnessChange={onCodingHarnessChange}
        onCodexReasoningEffortChange={onCodexReasoningEffortChange}
        onToggleVoice={onToggleVoice}
        onToggleMute={onToggleMute}
        onHoldToTalk={onHoldToTalk}
        onReleaseToMute={onReleaseToMute}
      />
    </main>
  );
}
