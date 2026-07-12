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
import * as api from "../services/api";
import type { ChatMode, CodexModel } from "../types";
import {
  type BackendRecoveryState,
  backendRecoverySucceeded,
  shouldAttemptBackendRecovery,
} from "../utils/backendRecovery";
import { defaultReasoningEffort, reconcileCodexSelection } from "../utils/codexModels";
import {
  blockingVoiceActivity,
  hasActiveBackgroundJob,
  isRequestUnavailable,
  isVoiceControlDisabled,
} from "../utils/controlAvailability";
import { failedSubmissionsForScope } from "../utils/requestRecovery";

export function useAppController() {
  const store = useProjectStore();
  const { syncError, clearSyncError, refreshWorkspace } = store;
  const [error, setError] = useState("");
  const [mode, setMode] = useState<ChatMode>("agent");
  const [codexModels, setCodexModels] = useState<CodexModel[]>([]);
  const [codexModel, setCodexModel] = useState("");
  const [codexReasoningEffort, setCodexReasoningEffort] = useState("");
  const codexSelectionRef = useRef({ model: "", reasoningEffort: "" });
  const [activityView, setActivityView] = useState<"chats" | "files">("chats");
  const [filePanelOpen, setFilePanelOpen] = useState(false);
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
  const chatScrollRef = useRef<HTMLElement | null>(null);
  const { input, textareaRef, resetComposer, restoreComposer, onComposerInput } =
    useComposerInput();
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
    fileViewerWidth,
    isDragging,
    startRailDrag,
    startPanelDrag,
    startFileViewerDrag,
    handleTouchStart,
    handleTouchEnd,
  } = useAppLayout();
  const projectInfo = useProjectInfo(store.activeProject);
  const { searchQuery, setSearchQuery, searchResults, searching, searchError, clearSearch } =
    useWorkspaceSearch();
  const { doctorChecks, refreshDoctor } = useSetupDoctor();
  const { status, refresh: refreshBackendStatus } = useBackendStatus();
  const backendWasOfflineRef = useRef(false);
  const recoveryInFlightRef = useRef(false);
  const [backendRecoveryState, setBackendRecoveryState] = useState<BackendRecoveryState>("idle");
  const handleChatSwitcherKeyDown = useChatSwitcherKeyboard();
  const {
    debugEntries,
    handoffs,
    actions,
    addAction,
    updateAction,
    clearConsoleState,
    forChat: consoleForChat,
    beginConsoleDeletion,
    rollbackConsoleDeletion,
    commitConsoleDeletion,
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
  const completeBackgroundCodexJobRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!syncError) return;
    setError(syncError);
    clearSyncError();
  }, [syncError, clearSyncError]);
  const loadCodexModels = useCallback(async (): Promise<boolean> => {
    try {
      const models = await api.fetchCodexModels();
      setCodexModels(models);
      const selection = reconcileCodexSelection(
        models,
        codexSelectionRef.current.model,
        codexSelectionRef.current.reasoningEffort,
      );
      codexSelectionRef.current = selection;
      setCodexModel(selection.model);
      setCodexReasoningEffort(selection.reasoningEffort);
      return true;
    } catch {
      setCodexModels([]);
      return false;
    }
  }, []);
  useEffect(() => {
    void loadCodexModels();
  }, [loadCodexModels]);
  const recoverBackendData = useCallback(async (): Promise<boolean> => {
    if (recoveryInFlightRef.current) return false;
    recoveryInFlightRef.current = true;
    setBackendRecoveryState("refreshing");
    try {
      const [workspaceLoaded, modelsLoaded] = await Promise.all([
        refreshWorkspace(),
        loadCodexModels(),
      ]);
      const recovered = backendRecoverySucceeded(workspaceLoaded, modelsLoaded);
      backendWasOfflineRef.current = !recovered;
      setBackendRecoveryState(recovered ? "idle" : "failed");
      if (recovered) {
        clearSyncError();
        setError((current) =>
          current.startsWith("Failed to load ") || current.startsWith("Backend unavailable")
            ? ""
            : current,
        );
        refreshDoctor();
      }
      return recovered;
    } catch {
      backendWasOfflineRef.current = true;
      setBackendRecoveryState("failed");
      return false;
    } finally {
      recoveryInFlightRef.current = false;
    }
  }, [clearSyncError, loadCodexModels, refreshDoctor, refreshWorkspace]);
  useEffect(() => {
    if (status.kind === "offline") {
      backendWasOfflineRef.current = true;
      return;
    }
    if (
      shouldAttemptBackendRecovery(
        backendWasOfflineRef.current,
        status.kind,
        recoveryInFlightRef.current,
      )
    ) {
      void recoverBackendData();
    }
  }, [recoverBackendData, status]);
  const handleCodexModelChange = useCallback(
    (model: string) => {
      setCodexModel(model);
      const selected = codexModels.find((item) => item.model === model);
      const reasoningEffort = defaultReasoningEffort(selected);
      codexSelectionRef.current = { model, reasoningEffort };
      setCodexReasoningEffort(reasoningEffort);
    },
    [codexModels],
  );
  const handleCodexReasoningEffortChange = useCallback((reasoningEffort: string) => {
    codexSelectionRef.current = {
      ...codexSelectionRef.current,
      reasoningEffort,
    };
    setCodexReasoningEffort(reasoningEffort);
  }, []);
  const {
    voiceContext,
    getWorkdir,
    getProjectId,
    getChatId,
    stopActiveVoiceHandoff,
    resetActiveVoiceMessages,
    setVoiceContext,
    clearVoiceContext,
    ensureVoiceContext,
    activeCodexJob,
    liveVoiceHandlers,
  } = useLiveVoiceSessionHandlers({
    store,
    consoleForChat,
    updateAction,
    onBackgroundJobSettled: () => completeBackgroundCodexJobRef.current?.(),
  });
  const liveVoice = useLiveVoice({
    getWorkdir,
    getProjectId,
    getChatId,
    onAudio: (audioUrl) => void playResponseAudio(audioUrl),
    onDebug: (message) => consoleForChat(getChatId() || "").addDebug(message),
    ...liveVoiceHandlers,
  });
  useEffect(() => {
    completeBackgroundCodexJobRef.current = liveVoice.completeBackgroundCodexJob;
  }, [liveVoice.completeBackgroundCodexJob]);
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
    voiceContext,
    ensureVoiceContext,
    resetActiveVoiceMessages,
    stopActiveVoiceHandoff,
    setVoiceContext,
    clearVoiceContext,
  });
  const { streamAgent, streamCodex } = useStreamingChat({
    store,
    activeAbortControllerRef,
    consoleForChat,
    speak,
    playResponseAudio,
  });
  const {
    busy,
    busyChatId,
    failedSubmissions,
    send,
    clearFailedSubmission,
    clearFailedSubmissionsForScope,
    clearFailedSubmissionsForProject,
  } = useChatSubmit({
    input,
    mode,
    resetComposer,
    store,
    streamAgent,
    streamCodex,
    activeAbortControllerRef,
    setError,
    codexModel,
    codexReasoningEffort,
  });
  const { removeProject, removeChat } = store;
  const removeProjectWithRecovery = useCallback(
    (projectId: string) => {
      const chatIds = (store.chats[projectId] || []).map((chat) => chat.id);
      const consoleDeletion = beginConsoleDeletion(chatIds);
      void removeProject(projectId)
        .then((removed) => {
          if (removed) {
            clearFailedSubmissionsForProject(projectId);
            void commitConsoleDeletion(consoleDeletion);
          } else {
            rollbackConsoleDeletion(consoleDeletion);
          }
        })
        .catch(() => rollbackConsoleDeletion(consoleDeletion));
    },
    [
      beginConsoleDeletion,
      clearFailedSubmissionsForProject,
      commitConsoleDeletion,
      removeProject,
      rollbackConsoleDeletion,
      store.chats,
    ],
  );
  const removeChatWithRecovery = useCallback(
    (projectId: string, chatId: string) => {
      const consoleDeletion = beginConsoleDeletion([chatId]);
      void removeChat(projectId, chatId)
        .then((removed) => {
          if (removed) {
            clearFailedSubmissionsForScope(projectId, chatId);
            void commitConsoleDeletion(consoleDeletion);
          } else {
            rollbackConsoleDeletion(consoleDeletion);
          }
        })
        .catch(() => rollbackConsoleDeletion(consoleDeletion));
    },
    [
      beginConsoleDeletion,
      clearFailedSubmissionsForScope,
      commitConsoleDeletion,
      removeChat,
      rollbackConsoleDeletion,
    ],
  );
  const {
    confirmDialog,
    setConfirmDialog,
    renameDialog,
    setRenameDialog,
    handleRemoveProject,
    handleRemoveChat,
    handleRenameChat,
  } = useChatActionDialogs({
    removeProject: removeProjectWithRecovery,
    removeChat: removeChatWithRecovery,
  });

  const activeFailedSubmissions = failedSubmissionsForScope(
    failedSubmissions,
    store.activeProject?.id,
    store.activeChatId,
  );
  const activeFailedSubmission = activeFailedSubmissions[0] || null;

  const blockUnavailableRequest = useCallback((): boolean => {
    if (!isRequestUnavailable(status.kind, mode)) return false;
    setError(
      status.kind === "missing_key"
        ? "Add a Google API key before sending a Vodex request."
        : "Backend unavailable. Reconnect before sending a request.",
    );
    return true;
  }, [mode, status.kind]);
  const handleToggleVoice = useCallback(() => {
    if (
      isVoiceControlDisabled({
        voiceActive,
        hasProject: Boolean(store.activeProject),
        busy,
        statusKind: status.kind,
      })
    ) {
      setError(
        busy
          ? "Cancel the current response before starting voice."
          : !store.activeProject
            ? "Select a project before starting voice."
            : "Voice is unavailable until the backend is ready.",
      );
      return;
    }
    toggleVoice();
  }, [busy, status.kind, store.activeProject, toggleVoice, voiceActive]);

  const blockForegroundNavigation = useCallback(() => {
    setError("Cancel the current response before switching or deleting chats.");
  }, []);
  const blockVoiceScopeChange = useCallback(
    (projectId: string, chatId?: string, action = "deleting"): boolean => {
      const blocker = blockingVoiceActivity({
        projectId,
        chatId,
        voiceActive,
        voiceScope: voiceContext
          ? { projectId: voiceContext.project.id, chatId: voiceContext.chatId }
          : null,
        backgroundJobScope: activeCodexJob
          ? { projectId: activeCodexJob.projectId, chatId: activeCodexJob.chatId }
          : null,
      });
      if (!blocker) return false;

      const scope = chatId ? "conversation" : "project";
      setError(
        blocker === "job"
          ? `Wait for the voice-started Codex task to finish before ${action} this ${scope}.`
          : `End the live voice session before ${action} this ${scope}.`,
      );
      return true;
    },
    [activeCodexJob, voiceActive, voiceContext],
  );
  const selectChatSafely = useCallback(
    (projectId: string, chatId: string): boolean => {
      if (busy && chatId !== busyChatId) {
        blockForegroundNavigation();
        return false;
      }
      setError("");
      store.selectChat(projectId, chatId);
      if (isMobile) setMobileView("chat");
      return true;
    },
    [blockForegroundNavigation, busy, busyChatId, isMobile, setMobileView, store],
  );
  const openSearchResult = useSearchResultNavigation({
    chats: store.chats,
    selectChat: selectChatSafely,
    clearSearch,
    isMobile,
    setMobileView,
  });

  const { showJumpToLatest, jumpToLatest } = useMessageAutoScroll({
    scrollContainerRef: chatScrollRef,
    messageEndRef,
    contentKey: store.messages,
    conversationKey: store.activeChatId,
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
  }, []);
  const handleRestoreFailedSubmission = useCallback(() => {
    if (!activeFailedSubmission) return;
    restoreComposer(activeFailedSubmission.text);
    setMode(activeFailedSubmission.mode);
    const selection = reconcileCodexSelection(
      codexModels,
      activeFailedSubmission.model || codexSelectionRef.current.model,
      activeFailedSubmission.reasoningEffort || codexSelectionRef.current.reasoningEffort,
    );
    codexSelectionRef.current = selection;
    setCodexModel(selection.model);
    setCodexReasoningEffort(selection.reasoningEffort);
    clearFailedSubmission(
      activeFailedSubmission.project.id,
      activeFailedSubmission.chatId,
      activeFailedSubmission.userMessageId,
    );
    setError("");
  }, [activeFailedSubmission, clearFailedSubmission, codexModels, restoreComposer]);
  const dismissError = useCallback(() => {
    setError("");
  }, []);
  const dismissFailedSubmission = useCallback(() => {
    if (!activeFailedSubmission) return;
    clearFailedSubmission(
      activeFailedSubmission.project.id,
      activeFailedSubmission.chatId,
      activeFailedSubmission.userMessageId,
    );
  }, [activeFailedSubmission, clearFailedSubmission]);
  const retryBackend = useCallback(() => {
    if (backendRecoveryState === "failed" && status.kind !== "offline") {
      void recoverBackendData();
      return;
    }
    void refreshBackendStatus();
  }, [backendRecoveryState, recoverBackendData, refreshBackendStatus, status.kind]);
  const { voiceTitle, voiceMessage, liveStatusText, streamingStatusText, suggestions } =
    useChatDisplayState({
      liveVoice,
      voiceActive,
      busy,
      mode,
      messages: store.messages,
      activeCodexJob,
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
    searchError,
    railOpen,
    panelOpen,
    filePanelOpen,
    voiceActive,
    onMobileViewChange: (view) => {
      setMobileView(view);
      if (view === "explorer") setActivityView("chats");
      if (view === "files") setActivityView("files");
    },
    onSearchQueryChange: setSearchQuery,
    onOpenSearchResult: openSearchResult,
    onToggleRail: () => setRailOpen((open) => !open),
    onTogglePanel: () => setPanelOpen((open) => !open),
    onToggleFilePanel: () => setFilePanelOpen((open) => !open),
  };

  const workspaceLayoutProps: WorkspaceLayoutProps = {
    layout: {
      isMobile,
      mobileView,
      railOpen,
      panelOpen,
      filePanelOpen,
      railWidth,
      panelWidth,
      fileViewerWidth,
      theme: store.theme,
      activityView,
    },
    workspace: {
      projects: store.projects,
      chats: store.chats,
      activeProjectId: store.activeId,
      activeProject: store.activeProject,
      activeChatId: store.activeChatId,
      activeChatTitle: store.activeChat?.title,
      activeChatByProject: store.activeChatByProject,
      expandedProjects,
      visibleChatsCount,
    },
    chat: {
      messages: store.messages,
      mode,
      busy,
      suggestions,
      scrollContainerRef: chatScrollRef,
      messageEndRef,
      showJumpToLatest,
      liveStatusText,
      streamingStatusText,
      input,
      error,
      failedRequestError: activeFailedSubmission?.errorMessage || "",
      failedRequestText: activeFailedSubmission?.text || "",
      failedRequestCount: activeFailedSubmissions.length,
      backendRecoveryState,
      codexModels,
      codexModel,
      codexReasoningEffort,
      textareaRef,
    },
    voice: {
      title: voiceTitle,
      message: voiceMessage,
      contextLabel: voiceContextLabel,
      transcriptPreview: liveVoice.transcriptPreview,
      muted: liveVoice.muted,
      supported: liveVoice.supported,
      active: voiceActive,
      reconnecting: liveVoice.state === "reconnecting",
      codexActive: Boolean(activeCodexJob),
      inputMode: voiceInputMode,
    },
    console: {
      status,
      activeTab: activeConsoleTab,
      debugEntries,
      actions,
      handoffs,
      doctorChecks,
      voices,
      selectedVoiceURI,
      pendingAudioUrl,
    },
    handlers: {
      onNewProject: () => {
        if (busy) {
          setError("Cancel the current response before changing projects.");
          return;
        }
        setError("");
        setShowAdd(true);
      },
      onActivityViewChange: (view) => {
        setActivityView(view);
        if (isMobile) setMobileView(view === "files" ? "files" : "explorer");
      },
      onToggleTheme: () => store.setTheme(store.theme === "dark" ? "light" : "dark"),
      onOpenConsoleSettings: () => {
        setPanelOpen(true);
        openVoiceTab();
      },
      onToggleProject: toggleProjectExpanded,
      onCreateChat: (projectId) => {
        if (busy) {
          blockForegroundNavigation();
          return;
        }
        setError("");
        store.createChat(projectId);
        markProjectExpanded(projectId);
        if (isMobile) setMobileView("chat");
      },
      onRemoveProject: (projectId, name) => {
        if (busy) blockForegroundNavigation();
        else if (blockVoiceScopeChange(projectId)) return;
        else {
          setError("");
          handleRemoveProject(projectId, name);
        }
      },
      onSelectChat: selectChatSafely,
      onRenameChat: handleRenameChat,
      onRemoveChat: (projectId, chatId) => {
        if (busy) blockForegroundNavigation();
        else if (blockVoiceScopeChange(projectId, chatId)) return;
        else {
          setError("");
          handleRemoveChat(projectId, chatId);
        }
      },
      onShowMoreChats: showMoreChats,
      onOpenVoiceSettings: () => {
        setMobileView("console");
        openVoiceTab();
      },
      onChatKeyDown: handleChatSwitcherKeyDown,
      onStartRailDrag: startRailDrag,
      onStartPanelDrag: startPanelDrag,
      onStartFileViewerDrag: startFileViewerDrag,
      onModeChange: (nextMode) => {
        if (busy) {
          setError("Wait for the current response to finish before changing modes.");
          return;
        }
        setError("");
        setMode(nextMode);
      },
      onExportChat: () => void handleExportChat(),
      onToggleVoice: handleToggleVoice,
      onSuggestion: (suggestion) => {
        if (blockUnavailableRequest()) return;
        void send(suggestion);
      },
      onCommitChangeReview: (artifact) => void confirmCommitChangeReview(artifact),
      onRevertChangeReview: (artifact) => void confirmRevertChangeReview(artifact),
      onInputChange: onComposerInput,
      onSubmit: () => {
        if (blockUnavailableRequest()) return;
        void send();
      },
      onCancelTask: handleCancelTask,
      onRestoreFailedRequest: handleRestoreFailedSubmission,
      onDismissError: dismissError,
      onDismissFailedRequest: dismissFailedSubmission,
      onRetryBackend: retryBackend,
      onJumpToLatest: jumpToLatest,
      onCodexModelChange: handleCodexModelChange,
      onCodexReasoningEffortChange: handleCodexReasoningEffortChange,
      onToggleMute: liveVoice.toggleMute,
      onHoldToTalk: holdToTalk,
      onReleaseToMute: releaseToMute,
      onHideConsole: () => setPanelOpen(false),
      onBackToChat: () => setMobileView("chat"),
      onClearThread: () => {
        if (busy) {
          setError("Cancel the current response before clearing this chat.");
          return;
        }
        if (hasActiveBackgroundJob(store.messages)) {
          setError("Wait for the background Codex task to finish before clearing this chat.");
          return;
        }
        const projectId = store.activeProject?.id;
        const chatId = store.activeChatId;
        if (projectId && chatId && blockVoiceScopeChange(projectId, chatId, "clearing")) return;
        void clearThread().then((cleared) => {
          if (cleared && projectId && chatId) {
            clearFailedSubmissionsForScope(projectId, chatId);
          }
        });
      },
      onConsoleTabChange: setActiveConsoleTab,
      onRefreshDoctor: refreshDoctor,
      onSelectedVoiceChange: setSelectedVoiceURI,
      onVoiceInputModeChange: changeVoiceInputMode,
      onPlayResponseAudio: (audioUrl) => void playResponseAudio(audioUrl),
    },
  };

  const modalProps: AppModalsProps = {
    showAdd,
    projects: store.projects,
    confirmDialog,
    renameDialog,
    onCloseAdd: () => setShowAdd(false),
    onCreateProject: (project) => {
      if (busy) {
        setShowAdd(false);
        setError("Cancel the current response before changing projects.");
        return;
      }
      setError("");
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
