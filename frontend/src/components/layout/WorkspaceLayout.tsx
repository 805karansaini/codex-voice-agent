import type { ChangeEvent, KeyboardEvent, MouseEvent, RefObject } from "react";

import type { ConsoleTabId } from "../../hooks/useConsolePanelState";
import type { MobileView } from "../../hooks/useAppLayout";
import type { VoiceInputMode } from "../../hooks/useVoiceInputMode";
import type {
  ActionEntry,
  Chat,
  ChatArtifact,
  DebugEntry,
  DoctorCheck,
  Handoff,
  Message,
  Project,
} from "../../types";
import ActivityRail from "./ActivityRail";
import WorkspaceSidebar from "./WorkspaceSidebar";
import ChatPanel from "../chat/ChatPanel";
import ConsolePanel from "../console/ConsolePanel";

type ChatMode = "agent" | "codex";

export type WorkspaceLayoutProps = {
  isMobile: boolean;
  mobileView: MobileView;
  railOpen: boolean;
  panelOpen: boolean;
  railWidth: number;
  panelWidth: number;
  theme: "dark" | "light";
  projects: Project[];
  chats: Record<string, Chat[]>;
  activeProjectId: string | null;
  activeProject?: Project | null;
  activeChatId: string | null;
  activeChatTitle?: string;
  activeChatByProject: Record<string, string>;
  expandedProjects: Record<string, boolean>;
  visibleChatsCount: Record<string, number>;
  messages: Message[];
  mode: ChatMode;
  busy: boolean;
  suggestions: string[];
  messageEndRef: RefObject<HTMLDivElement | null>;
  liveStatusText: string;
  streamingStatusText: string;
  voiceTitle: string;
  voiceMessage: string;
  voiceContextLabel: string;
  voiceTranscriptPreview: string;
  voiceMuted: boolean;
  voiceSupported: boolean;
  voiceActive: boolean;
  voiceInputMode: VoiceInputMode;
  input: string;
  error: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  status: string;
  activeConsoleTab: ConsoleTabId;
  debugEntries: DebugEntry[];
  actions: ActionEntry[];
  handoffs: Handoff[];
  doctorChecks: DoctorCheck[];
  voices: SpeechSynthesisVoice[];
  selectedVoiceURI: string;
  pendingAudioUrl: string;
  onNewProject: () => void;
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
  onModeChange: (mode: ChatMode) => void;
  onExportChat: () => void;
  onToggleVoice: () => void;
  onSuggestion: (suggestion: string) => void;
  onCommitChangeReview: (artifact: ChatArtifact) => void;
  onRevertChangeReview: (artifact: ChatArtifact) => void;
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: () => void;
  onCancelTask: () => void;
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

export default function WorkspaceLayout({
  isMobile,
  mobileView,
  railOpen,
  panelOpen,
  railWidth,
  panelWidth,
  theme,
  projects,
  chats,
  activeProjectId,
  activeProject,
  activeChatId,
  activeChatTitle,
  activeChatByProject,
  expandedProjects,
  visibleChatsCount,
  messages,
  mode,
  busy,
  suggestions,
  messageEndRef,
  liveStatusText,
  streamingStatusText,
  voiceTitle,
  voiceMessage,
  voiceContextLabel,
  voiceTranscriptPreview,
  voiceMuted,
  voiceSupported,
  voiceActive,
  voiceInputMode,
  input,
  error,
  textareaRef,
  status,
  activeConsoleTab,
  debugEntries,
  actions,
  handoffs,
  doctorChecks,
  voices,
  selectedVoiceURI,
  pendingAudioUrl,
  onNewProject,
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
  onModeChange,
  onExportChat,
  onToggleVoice,
  onSuggestion,
  onCommitChangeReview,
  onRevertChangeReview,
  onInputChange,
  onSubmit,
  onCancelTask,
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
}: WorkspaceLayoutProps) {
  return (
    <div className="flex flex-1 min-h-0 min-w-0">
      {!isMobile && (
        <ActivityRail
          theme={theme}
          onNewProject={onNewProject}
          onToggleTheme={onToggleTheme}
          onOpenConsoleSettings={onOpenConsoleSettings}
        />
      )}

      {(!isMobile ? railOpen : mobileView === "explorer") && (
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
          onChatKeyDown={onChatKeyDown}
        />
      )}

      {!isMobile && railOpen && (
        <div
          className="w-1 cursor-col-resize hover:bg-accent/40 active:bg-accent transition-colors bg-line-soft shrink-0"
          onMouseDown={onStartRailDrag}
        />
      )}

      {(!isMobile || mobileView === "chat") && (
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
          voiceDisabled={!activeProject}
          onToggleVoice={onToggleVoice}
          busy={busy}
          activeProject={activeProject}
          messages={messages}
          suggestions={suggestions}
          messageEndRef={messageEndRef}
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
          textareaRef={textareaRef}
          onInputChange={onInputChange}
          onSubmit={onSubmit}
          onCancelTask={onCancelTask}
          onToggleMute={onToggleMute}
          onHoldToTalk={onHoldToTalk}
          onReleaseToMute={onReleaseToMute}
        />
      )}

      {!isMobile && panelOpen && (
        <div
          className="w-1 cursor-col-resize hover:bg-accent/40 active:bg-accent transition-colors bg-line-soft shrink-0"
          onMouseDown={onStartPanelDrag}
        />
      )}

      {(!isMobile ? panelOpen : mobileView === "console") && (
        <ConsolePanel
          isMobile={isMobile}
          width={panelWidth}
          status={status}
          canClear={Boolean(activeChatId)}
          activeTab={activeConsoleTab}
          debugEntries={debugEntries}
          actions={actions}
          handoffs={handoffs}
          messages={messages}
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
      )}
    </div>
  );
}
