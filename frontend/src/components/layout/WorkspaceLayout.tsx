import type { ChangeEvent, KeyboardEvent, MouseEvent, RefObject } from "react";

import type { ConsoleTabId } from "../../hooks/useConsolePanelState";
import type { BackendStatus } from "../../hooks/useBackendStatus";
import type { BackendRecoveryState } from "../../utils/backendRecovery";
import { hasActiveBackgroundJob, isVoiceControlDisabled } from "../../utils/controlAvailability";
import {
  FILE_VIEWER_WIDTH_BOUNDS,
  PANEL_WIDTH_BOUNDS,
  RAIL_WIDTH_BOUNDS,
  type MobileView,
} from "../../hooks/useAppLayout";
import type { VoiceInputMode } from "../../hooks/useVoiceInputMode";
import type {
  ActionEntry,
  Chat,
  ChatArtifact,
  ChatMode,
  DebugEntry,
  DoctorCheck,
  CodexModel,
  CodingHarness,
  CodingHarnessInfo,
  Handoff,
  Message,
  Project,
} from "../../types";
import PanelErrorBoundary from "../common/PanelErrorBoundary";
import ActivityRail from "./ActivityRail";
import PanelResizer from "./PanelResizer";
import WorkspaceSidebar from "./WorkspaceSidebar";
import ProjectFilesPanel from "./ProjectFilesPanel";
import FileReaderPanel from "./FileReaderPanel";
import ChatPanel from "../chat/ChatPanel";
import ConsolePanel from "../console/ConsolePanel";
import { useEffect, useState } from "react";

export type WorkspaceLayoutProps = {
  layout: {
    isMobile: boolean;
    mobileView: MobileView;
    railOpen: boolean;
    panelOpen: boolean;
    filePanelOpen: boolean;
    railWidth: number;
    panelWidth: number;
    fileViewerWidth: number;
    theme: "dark" | "light";
    activityView: "chats" | "files";
  };
  workspace: {
    projects: Project[];
    chats: Record<string, Chat[]>;
    activeProjectId: string | null;
    activeProject?: Project | null;
    activeChatId: string | null;
    activeChatTitle?: string;
    activeChatByProject: Record<string, string>;
    expandedProjects: Record<string, boolean>;
    visibleChatsCount: Record<string, number>;
  };
  chat: {
    messages: Message[];
    mode: ChatMode;
    busy: boolean;
    suggestions: string[];
    scrollContainerRef: RefObject<HTMLElement | null>;
    messageEndRef: RefObject<HTMLDivElement | null>;
    showJumpToLatest: boolean;
    liveStatusText: string;
    streamingStatusText: string;
    input: string;
    error: string;
    failedRequestError: string;
    failedRequestText: string;
    failedRequestCount: number;
    backendRecoveryState: BackendRecoveryState;
    codexModels: CodexModel[];
    codingHarnesses: CodingHarnessInfo[];
    codingHarness: CodingHarness;
    codexModel: string;
    codexReasoningEffort: string;
    textareaRef: RefObject<HTMLTextAreaElement | null>;
  };
  voice: {
    title: string;
    message: string;
    contextLabel: string;
    transcriptPreview: string;
    muted: boolean;
    supported: boolean;
    active: boolean;
    reconnecting: boolean;
    codexActive: boolean;
    inputMode: VoiceInputMode;
  };
  console: {
    status: BackendStatus;
    activeTab: ConsoleTabId;
    debugEntries: DebugEntry[];
    actions: ActionEntry[];
    handoffs: Handoff[];
    doctorChecks: DoctorCheck[];
    voices: SpeechSynthesisVoice[];
    selectedVoiceURI: string;
    pendingAudioUrl: string;
  };
  handlers: {
    onNewProject: () => void;
    onActivityViewChange: (view: "chats" | "files") => void;
    onToggleTheme: () => void;
    onOpenConsoleSettings: () => void;
    onToggleProject: (projectId: string, expanded: boolean) => void;
    onCreateChat: (projectId: string) => void;
    onRemoveProject: (projectId: string, name: string) => void;
    onSelectChat: (projectId: string, chatId: string) => void;
    onRenameChat: (projectId: string, chatId: string, title: string) => void;
    onRemoveChat: (projectId: string, chatId: string) => void;
    onShowMoreChats: (projectId: string) => void;
    onOpenVoiceSettings: () => void;
    onChatKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
    onStartRailDrag: (event: MouseEvent) => void;
    onStartPanelDrag: (event: MouseEvent) => void;
    onStartFileViewerDrag: (event: MouseEvent) => void;
    onResizeRail: (width: number) => void;
    onResizePanel: (width: number) => void;
    onResizeFileViewer: (width: number) => void;
    onModeChange: (mode: ChatMode) => void;
    onExportChat: () => void;
    onToggleVoice: () => void;
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
    onHideConsole: () => void;
    onBackToChat: () => void;
    onClearThread: () => void;
    onConsoleTabChange: (tab: ConsoleTabId) => void;
    onRefreshDoctor: () => void;
    onSelectedVoiceChange: (voiceURI: string) => void;
    onVoiceInputModeChange: (mode: VoiceInputMode) => void;
    onPlayResponseAudio: (audioUrl: string) => void;
  };
};

export default function WorkspaceLayout({
  layout,
  workspace,
  chat,
  voice,
  console,
  handlers,
}: WorkspaceLayoutProps) {
  const {
    isMobile,
    mobileView,
    railOpen,
    panelOpen,
    filePanelOpen,
    railWidth,
    panelWidth,
    fileViewerWidth,
    theme,
    activityView,
  } = layout;
  const {
    projects,
    chats,
    activeProjectId,
    activeProject,
    activeChatId,
    activeChatTitle,
    activeChatByProject,
    expandedProjects,
    visibleChatsCount,
  } = workspace;
  const {
    messages,
    mode,
    busy,
    suggestions,
    scrollContainerRef,
    messageEndRef,
    showJumpToLatest,
    liveStatusText,
    streamingStatusText,
    input,
    error,
    failedRequestError,
    failedRequestText,
    failedRequestCount,
    backendRecoveryState,
    textareaRef,
  } = chat;
  const {
    title: voiceTitle,
    message: voiceMessage,
    contextLabel: voiceContextLabel,
    transcriptPreview: voiceTranscriptPreview,
    muted: voiceMuted,
    supported: voiceSupported,
    active: voiceActive,
    reconnecting: voiceReconnecting,
    codexActive,
    inputMode: voiceInputMode,
  } = voice;
  const {
    status,
    activeTab: activeConsoleTab,
    debugEntries,
    actions,
    handoffs,
    doctorChecks,
    voices,
    selectedVoiceURI,
    pendingAudioUrl,
  } = console;
  const {
    onNewProject,
    onActivityViewChange,
    onToggleTheme,
    onOpenConsoleSettings,
    onToggleProject,
    onCreateChat,
    onRemoveProject,
    onSelectChat,
    onRenameChat,
    onRemoveChat,
    onShowMoreChats,
    onOpenVoiceSettings,
    onChatKeyDown,
    onStartRailDrag,
    onStartPanelDrag,
    onStartFileViewerDrag,
    onResizeRail,
    onResizePanel,
    onResizeFileViewer,
    onModeChange,
    onExportChat,
    onToggleVoice,
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
    onToggleMute,
    onHoldToTalk,
    onReleaseToMute,
    onHideConsole,
    onBackToChat,
    onClearThread,
    onConsoleTabChange,
    onRefreshDoctor,
    onSelectedVoiceChange,
    onVoiceInputModeChange,
    onPlayResponseAudio,
  } = handlers;
  const [openFilePath, setOpenFilePath] = useState("");

  useEffect(() => {
    setOpenFilePath("");
  }, [activeProject?.id]);

  return (
    <div className="flex flex-1 min-h-0 min-w-0">
      {!isMobile && (
        <ActivityRail
          theme={theme}
          activeView={activityView}
          onNewProject={onNewProject}
          onViewChange={onActivityViewChange}
          onToggleTheme={onToggleTheme}
          onOpenConsoleSettings={onOpenConsoleSettings}
        />
      )}

      {activityView === "chats" && (!isMobile ? railOpen : mobileView === "explorer") && (
        <PanelErrorBoundary name="Workspace">
          <WorkspaceSidebar
            isMobile={isMobile}
            width={railWidth}
            projects={projects}
            chats={chats}
            activeProjectId={activeProjectId}
            activeChatByProject={activeChatByProject}
            expandedProjects={expandedProjects}
            visibleChatsCount={visibleChatsCount}
            theme={theme}
            activeView={activityView}
            onAddProject={onNewProject}
            onToggleProject={onToggleProject}
            onCreateChat={onCreateChat}
            onRemoveProject={onRemoveProject}
            onSelectChat={onSelectChat}
            onRenameChat={onRenameChat}
            onRemoveChat={onRemoveChat}
            onShowMoreChats={onShowMoreChats}
            onToggleTheme={onToggleTheme}
            onOpenVoiceSettings={onOpenVoiceSettings}
            onViewChange={onActivityViewChange}
            onChatKeyDown={onChatKeyDown}
          />
        </PanelErrorBoundary>
      )}

      {activityView === "files" &&
        (!isMobile || mobileView === "files") &&
        (isMobile && openFilePath && activeProject ? (
          <PanelErrorBoundary name="File viewer">
            <FileReaderPanel
              project={activeProject}
              path={openFilePath}
              width={railWidth}
              isMobile
              onClose={() => setOpenFilePath("")}
            />
          </PanelErrorBoundary>
        ) : (
          <PanelErrorBoundary name="Project files">
            <ProjectFilesPanel
              project={activeProject}
              width={railWidth}
              isMobile={isMobile}
              onOpenFile={isMobile ? setOpenFilePath : undefined}
            />
          </PanelErrorBoundary>
        ))}

      {!isMobile && railOpen && (
        <PanelResizer
          label="Resize workspace sidebar"
          width={railWidth}
          bounds={RAIL_WIDTH_BOUNDS}
          direction="grow-right"
          onDragStart={onStartRailDrag}
          onResize={onResizeRail}
        />
      )}

      {(!isMobile || mobileView === "chat") && (
        <PanelErrorBoundary name="Chat">
          <ChatPanel
            isMobile={isMobile}
            title={activeChatTitle || "No Thread Selected"}
            messageCount={messages.length}
            mode={mode}
            onModeChange={onModeChange}
            onExport={onExportChat}
            exportDisabled={!activeChatId || messages.length === 0}
            voiceSupported={voiceSupported}
            voiceActive={voiceActive}
            voiceReconnecting={voiceReconnecting}
            codexActive={codexActive}
            voiceDisabled={isVoiceControlDisabled({
              voiceActive,
              hasProject: Boolean(activeProject),
              busy,
              statusKind: status.kind,
            })}
            onToggleVoice={onToggleVoice}
            busy={busy}
            activeProject={activeProject}
            messages={messages}
            suggestions={suggestions}
            scrollContainerRef={scrollContainerRef}
            messageEndRef={messageEndRef}
            showJumpToLatest={showJumpToLatest}
            onAddProject={onNewProject}
            onSuggestion={onSuggestion}
            onCommitChangeReview={onCommitChangeReview}
            onRevertChangeReview={onRevertChangeReview}
            liveStatusText={liveStatusText}
            streamingStatusText={streamingStatusText}
            voiceTitle={voiceTitle}
            voiceMessage={voiceMessage}
            voiceContextLabel={voiceContextLabel}
            voiceTranscriptPreview={voiceTranscriptPreview}
            voiceMuted={voiceMuted}
            voiceInputMode={voiceInputMode}
            input={input}
            hasActiveProject={Boolean(activeProject)}
            error={error}
            failedRequestError={failedRequestError}
            failedRequestText={failedRequestText}
            failedRequestCount={failedRequestCount}
            backendStatus={status}
            backendRecoveryState={backendRecoveryState}
            codexModels={chat.codexModels}
            codingHarnesses={chat.codingHarnesses}
            codingHarness={chat.codingHarness}
            codexModel={chat.codexModel}
            codexReasoningEffort={chat.codexReasoningEffort}
            textareaRef={textareaRef}
            onInputChange={onInputChange}
            onSubmit={onSubmit}
            onCancelTask={onCancelTask}
            onRestoreFailedRequest={onRestoreFailedRequest}
            onDismissError={onDismissError}
            onDismissFailedRequest={onDismissFailedRequest}
            onRetryBackend={onRetryBackend}
            onJumpToLatest={onJumpToLatest}
            onCodexModelChange={handlers.onCodexModelChange}
            onCodingHarnessChange={handlers.onCodingHarnessChange}
            onCodexReasoningEffortChange={handlers.onCodexReasoningEffortChange}
            onToggleMute={onToggleMute}
            onHoldToTalk={onHoldToTalk}
            onReleaseToMute={onReleaseToMute}
          />
        </PanelErrorBoundary>
      )}

      {!isMobile &&
        (panelOpen || filePanelOpen) &&
        (filePanelOpen && openFilePath ? (
          <PanelResizer
            label="Resize file viewer"
            width={fileViewerWidth}
            bounds={FILE_VIEWER_WIDTH_BOUNDS}
            direction="grow-left"
            onDragStart={onStartFileViewerDrag}
            onResize={onResizeFileViewer}
          />
        ) : (
          <PanelResizer
            label={filePanelOpen ? "Resize file tree" : "Resize console panel"}
            width={panelWidth}
            bounds={PANEL_WIDTH_BOUNDS}
            direction="grow-left"
            onDragStart={onStartPanelDrag}
            onResize={onResizePanel}
          />
        ))}

      {!isMobile && filePanelOpen ? (
        <>
          {openFilePath && activeProject && (
            <>
              <PanelErrorBoundary name="File viewer">
                <FileReaderPanel
                  project={activeProject}
                  path={openFilePath}
                  width={fileViewerWidth}
                  onClose={() => setOpenFilePath("")}
                />
              </PanelErrorBoundary>
              <PanelResizer
                label="Resize file tree"
                width={panelWidth}
                bounds={PANEL_WIDTH_BOUNDS}
                direction="grow-left"
                onDragStart={onStartPanelDrag}
                onResize={onResizePanel}
              />
            </>
          )}
          <PanelErrorBoundary name="Project files">
            <ProjectFilesPanel
              project={activeProject}
              width={panelWidth}
              onOpenFile={setOpenFilePath}
            />
          </PanelErrorBoundary>
        </>
      ) : (
        (!isMobile ? panelOpen : mobileView === "console") && (
          <PanelErrorBoundary name="Console">
            <ConsolePanel
              isMobile={isMobile}
              width={panelWidth}
              status={status}
              canClear={Boolean(activeChatId) && !busy && !hasActiveBackgroundJob(messages)}
              activeTab={activeConsoleTab}
              debugEntries={debugEntries}
              actions={actions}
              handoffs={handoffs}
              messages={messages}
              codingHarnesses={chat.codingHarnesses}
              doctorChecks={doctorChecks}
              voices={voices}
              selectedVoiceURI={selectedVoiceURI}
              voiceInputMode={voiceInputMode}
              pendingAudioUrl={pendingAudioUrl}
              onHide={onHideConsole}
              onBackToChat={onBackToChat}
              onClear={onClearThread}
              onTabChange={onConsoleTabChange}
              onRefreshDoctor={onRefreshDoctor}
              onSelectedVoiceChange={onSelectedVoiceChange}
              onVoiceInputModeChange={onVoiceInputModeChange}
              onPlayResponseAudio={onPlayResponseAudio}
            />
          </PanelErrorBoundary>
        )
      )}
    </div>
  );
}
