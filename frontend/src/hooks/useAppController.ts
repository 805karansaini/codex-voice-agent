import { useCallback, useEffect, useRef, useState } from "react";

import type { AppModalsProps } from "../components/layout/AppModals";
import type { AppTitleBarProps } from "../components/layout/AppTitleBar";
import type { WorkspaceLayoutProps } from "../components/layout/WorkspaceLayout";
import { cn } from "../utils";
import { useAppLayout } from "./useAppLayout";
import { useBackendStatus } from "./useBackendStatus";
import { useChangeReviewActions } from "./useChangeReviewActions";
import { useChatActionDialogs } from "./useChatActionDialogs";
import { useChatDisplayState } from "./useChatDisplayState";
import { useChatExport } from "./useChatExport";
import { useChatSubmit } from "./useChatSubmit";
import { useChatSwitcherKeyboard } from "./useChatSwitcherKeyboard";
import { useClearThread } from "./useClearThread";
import { useComposerInput } from "./useComposerInput";
import { useConsolePanelState } from "./useConsolePanelState";
import { useConsoleSession } from "./useConsoleSession";
import { useLiveVoice } from "./useLiveVoice";
import { useLiveVoiceControls } from "./useLiveVoiceControls";
import { useLiveVoiceSessionHandlers } from "./useLiveVoiceSessionHandlers";
import { useMessageAutoScroll } from "./useMessageAutoScroll";
import { useProjectInfo } from "./useProjectInfo";
import { useProjectStore } from "./useProjectStore";
import { useSearchResultNavigation } from "./useSearchResultNavigation";
import { useSetupDoctor } from "./useSetupDoctor";
import { useSpeechPlayback } from "./useSpeechPlayback";
import { useStreamingChat } from "./useStreamingChat";
import { useVoiceInputMode } from "./useVoiceInputMode";
import { useWorkspaceSearch } from "./useWorkspaceSearch";
import { useWorkspaceSidebarState } from "./useWorkspaceSidebarState";

export function useAppController() {
  const store = useProjectStore();
  const { syncError, clearSyncError } = store;
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"agent" | "codex">("agent");
  const [showAdd, setShowAdd] = useState(false);
  const { voiceInputMode, setVoiceInputMode } = useVoiceInputMode();
  const { activeConsoleTab, setActiveConsoleTab, openVoiceTab } = useConsolePanelState();
  const {
    expandedProjects,
    visibleChatsCount,
    toggleProjectExpanded,
    markProjectExpanded,
    showMoreChats,
  } = useWorkspaceSidebarState();
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const { input, textareaRef, resetComposer, onComposerInput } = useComposerInput();
  const {
    railOpen,
    setRailOpen,
    panelOpen,
    setPanelOpen,
    isMobile,
    mobileView,
    setMobileView,
    railWidth,
    panelWidth,
    isDragging,
    startRailDrag,
    startPanelDrag,
    handleTouchStart,
    handleTouchEnd,
  } = useAppLayout();
  const projectInfo = useProjectInfo(store.activeProject);
  const { searchQuery, setSearchQuery, searchResults, searching, clearSearch } =
    useWorkspaceSearch();
  const { doctorChecks, refreshDoctor } = useSetupDoctor();
  const status = useBackendStatus();
  const handleChatSwitcherKeyDown = useChatSwitcherKeyboard();
  const openSearchResult = useSearchResultNavigation({
    chats: store.chats,
    selectChat: store.selectChat,
    clearSearch,
    isMobile,
    setMobileView,
  });
  const {
    confirmDialog,
    setConfirmDialog,
    renameDialog,
    setRenameDialog,
    handleRemoveProject,
    handleRemoveChat,
    handleRenameChat,
  } = useChatActionDialogs({
    removeProject: store.removeProject,
    removeChat: store.removeChat,
  });
  const {
    debugEntries,
    handoffs,
    actions,
    addDebug,
    addHandoff,
    addAction,
    updateAction,
    clearConsoleState,
  } = useConsoleSession(store.activeChatId);
  const {
    voices,
    selectedVoiceURI,
    setSelectedVoiceURI,
    pendingAudioUrl,
    speak,
    primeAudioPlayback,
    playResponseAudio,
  } = useSpeechPlayback({ setError });
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!syncError) return;
    setError(syncError);
    clearSyncError();
  }, [syncError, clearSyncError]);
  const {
    voiceCtxRef,
    getWorkdir,
    getProjectId,
    getChatId,
    stopActiveVoiceHandoff,
    resetActiveVoiceMessages,
    setVoiceContext,
    clearVoiceContext,
    ensureVoiceContext,
    liveVoiceHandlers,
  } = useLiveVoiceSessionHandlers({
    store,
    addAction,
    updateAction,
    addHandoff,
  });
  const liveVoice = useLiveVoice({
    getWorkdir,
    getProjectId,
    getChatId,
    onAudio: (audioUrl) => void playResponseAudio(audioUrl),
    onDebug: addDebug,
    ...liveVoiceHandlers,
  });
  const {
    voiceActive,
    voiceContextLabel,
    holdToTalk,
    releaseToMute,
    toggleVoice,
    changeVoiceInputMode,
  } = useLiveVoiceControls({
    store,
    liveVoice,
    voiceInputMode,
    setVoiceInputMode,
    primeAudioPlayback,
    voiceCtxRef,
    ensureVoiceContext,
    resetActiveVoiceMessages,
    stopActiveVoiceHandoff,
    setVoiceContext,
    clearVoiceContext,
  });
  const { streamAgent, streamCodex } = useStreamingChat({
    store,
    activeAbortControllerRef,
    addAction,
    updateAction,
    addHandoff,
    speak,
    playResponseAudio,
    setError,
  });
  const { busy, send } = useChatSubmit({
    input,
    mode,
    resetComposer,
    store,
    streamAgent,
    streamCodex,
    activeAbortControllerRef,
    setError,
  });

  useMessageAutoScroll({
    messageEndRef,
    messageCount: store.messages.length,
    busy,
  });

  const { confirmCommitChangeReview, confirmRevertChangeReview } = useChangeReviewActions({
    addAction,
    updateAction,
    setConfirmDialog,
    setError,
  });
  const handleExportChat = useChatExport({ activeChatId: store.activeChatId, setError });
  const clearThread = useClearThread({
    activeProjectId: store.activeProject?.id,
    activeChatId: store.activeChatId,
    clearChatThread: store.clearChatThread,
    clearConsoleState,
    setError,
  });
  const handleCancelTask = useCallback(() => {
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
      activeAbortControllerRef.current = null;
    }
    liveVoice.cancelTask();
  }, [liveVoice]);
  const { voiceTitle, liveStatusText, streamingStatusText, suggestions } = useChatDisplayState({
    liveVoice,
    voiceActive,
    busy,
    mode,
    messages: store.messages,
  });

  const titleBarProps: AppTitleBarProps = {
    isMobile,
    mobileView,
    activeProjectName: store.activeProject?.name || "No Project",
    activeChatTitle: store.activeChat?.title,
    projectInfo,
    searchQuery,
    searchResults,
    searching,
    railOpen,
    panelOpen,
    voiceActive,
    onMobileViewChange: setMobileView,
    onSearchQueryChange: setSearchQuery,
    onOpenSearchResult: openSearchResult,
    onToggleRail: () => setRailOpen((open) => !open),
    onTogglePanel: () => setPanelOpen((open) => !open),
  };

  const workspaceLayoutProps: WorkspaceLayoutProps = {
    isMobile,
    mobileView,
    railOpen,
    panelOpen,
    railWidth,
    panelWidth,
    theme: store.theme,
    projects: store.projects,
    chats: store.chats,
    activeProjectId: store.activeId,
    activeProject: store.activeProject,
    activeChatId: store.activeChatId,
    activeChatTitle: store.activeChat?.title,
    activeChatByProject: store.activeChatByProject,
    expandedProjects,
    visibleChatsCount,
    messages: store.messages,
    mode,
    busy,
    suggestions,
    messageEndRef,
    liveStatusText,
    streamingStatusText,
    voiceTitle,
    voiceMessage: liveVoice.message,
    voiceContextLabel,
    voiceTranscriptPreview: liveVoice.transcriptPreview,
    voiceMuted: liveVoice.muted,
    voiceSupported: liveVoice.supported,
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
    onNewProject: () => setShowAdd(true),
    onToggleTheme: () => store.setTheme(store.theme === "dark" ? "light" : "dark"),
    onOpenConsoleSettings: () => {
      setPanelOpen(true);
      openVoiceTab();
    },
    onToggleProject: toggleProjectExpanded,
    onCreateChat: (projectId) => {
      store.createChat(projectId);
      markProjectExpanded(projectId);
      if (isMobile) {
        setMobileView("chat");
      }
    },
    onRemoveProject: handleRemoveProject,
    onSelectChat: (projectId, chatId) => {
      store.selectChat(projectId, chatId);
      if (isMobile) {
        setMobileView("chat");
      }
    },
    onRenameChat: handleRenameChat,
    onRemoveChat: handleRemoveChat,
    onShowMoreChats: showMoreChats,
    onOpenVoiceSettings: () => {
      setMobileView("console");
      openVoiceTab();
    },
    onChatKeyDown: handleChatSwitcherKeyDown,
    onStartRailDrag: startRailDrag,
    onStartPanelDrag: startPanelDrag,
    onModeChange: setMode,
    onExportChat: () => void handleExportChat(),
    onToggleVoice: toggleVoice,
    onSuggestion: (suggestion) => void send(suggestion),
    onCommitChangeReview: (artifact) => void confirmCommitChangeReview(artifact),
    onRevertChangeReview: (artifact) => void confirmRevertChangeReview(artifact),
    onInputChange: onComposerInput,
    onSubmit: () => void send(),
    onCancelTask: handleCancelTask,
    onToggleMute: liveVoice.toggleMute,
    onHoldToTalk: holdToTalk,
    onReleaseToMute: releaseToMute,
    onHideConsole: () => setPanelOpen(false),
    onBackToChat: () => setMobileView("chat"),
    onClearThread: clearThread,
    onConsoleTabChange: setActiveConsoleTab,
    onRefreshDoctor: refreshDoctor,
    onSelectedVoiceChange: setSelectedVoiceURI,
    onVoiceInputModeChange: changeVoiceInputMode,
    onPlayResponseAudio: (audioUrl) => void playResponseAudio(audioUrl),
  };

  const modalProps: AppModalsProps = {
    showAdd,
    projects: store.projects,
    confirmDialog,
    renameDialog,
    onCloseAdd: () => setShowAdd(false),
    onCreateProject: (project) => {
      store.createProject(project);
      setShowAdd(false);
    },
    onCloseConfirm: () => setConfirmDialog(null),
    onCloseRename: () => setRenameDialog(null),
    onRenameChat: store.renameChat,
  };

  return {
    rootProps: {
      onTouchStart: handleTouchStart,
      onTouchEnd: handleTouchEnd,
      className: cn(
        "flex h-screen w-screen flex-col overflow-hidden bg-surface-0 text-fg",
        isDragging && "select-none",
      ),
    },
    titleBarProps,
    workspaceLayoutProps,
    modalProps,
  };
}
