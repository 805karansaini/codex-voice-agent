import React, { useCallback, useEffect, useRef, useState } from "react";

import { useProjectStore } from "./hooks/useProjectStore";
import { useLiveVoice } from "./hooks/useLiveVoice";
import { useStreamingChat } from "./hooks/useStreamingChat";
import { useSpeechPlayback } from "./hooks/useSpeechPlayback";
import { useConsoleSession } from "./hooks/useConsoleSession";
import { useAppLayout } from "./hooks/useAppLayout";
import { useProjectInfo } from "./hooks/useProjectInfo";
import { useWorkspaceSearch } from "./hooks/useWorkspaceSearch";
import { useSetupDoctor } from "./hooks/useSetupDoctor";
import { useChangeReviewActions } from "./hooks/useChangeReviewActions";
import { useBackendStatus } from "./hooks/useBackendStatus";
import { useChatExport } from "./hooks/useChatExport";
import { useChatActionDialogs } from "./hooks/useChatActionDialogs";
import { useChatDisplayState } from "./hooks/useChatDisplayState";
import { useMessageAutoScroll } from "./hooks/useMessageAutoScroll";
import { useComposerInput } from "./hooks/useComposerInput";
import { useSearchResultNavigation } from "./hooks/useSearchResultNavigation";
import { useChatSwitcherKeyboard } from "./hooks/useChatSwitcherKeyboard";
import { useClearThread } from "./hooks/useClearThread";
import { useWorkspaceSidebarState } from "./hooks/useWorkspaceSidebarState";
import { useVoiceInputMode } from "./hooks/useVoiceInputMode";
import { useConsolePanelState } from "./hooks/useConsolePanelState";
import { useLiveVoiceSessionHandlers } from "./hooks/useLiveVoiceSessionHandlers";
import { Project } from "./types";
import { chatTitleFrom, cn } from "./utils";

import AddProjectModal from "./components/modals/AddProjectModal";
import ConfirmModal from "./components/modals/ConfirmModal";
import RenameChatModal from "./components/modals/RenameChatModal";
import AppTitleBar from "./components/layout/AppTitleBar";
import WorkspaceLayout from "./components/layout/WorkspaceLayout";

export function App() {
  const store = useProjectStore();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"agent" | "codex">("agent");

  const { voiceInputMode, setVoiceInputMode } = useVoiceInputMode();

  const [showAdd, setShowAdd] = useState(false);
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

  useMessageAutoScroll({
    messageEndRef,
    messageCount: store.messages.length,
    busy,
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
    onAudio: playResponseAudio,
    onDebug: addDebug,
    ...liveVoiceHandlers,
  });
  const voiceActive = liveVoice.active;
  const voiceContext = voiceCtxRef.current;
  const voiceContextChat = voiceContext
    ? (store.chats[voiceContext.project.id] || []).find((chat) => chat.id === voiceContext.chatId)
    : null;
  const voiceContextLabel = voiceContext
    ? `${voiceContext.project.name} / ${voiceContextChat?.title || "New chat"}`
    : "";

  useEffect(() => {
    if (!voiceActive) return;
    ensureVoiceContext();
  }, [ensureVoiceContext, voiceActive]);

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

  const send = useCallback(
    async (raw?: string, projectOverride?: Project, chatOverride?: string) => {
      const text = (raw ?? input).trim();
      const project = projectOverride || store.activeProject;
      if (!text || busy || !project) return;

      let chatId = chatOverride || store.activeChatId;
      let createdChatForSend = false;
      if (!chatId) {
        chatId = store.createChat(project.id, { title: chatTitleFrom(text) }).id;
        createdChatForSend = true;
      }

      resetComposer();
      setError("");
      setBusy(true);

      if (!createdChatForSend && (store.messagesByChat[chatId] || []).length === 0) {
        store.renameChat(project.id, chatId, chatTitleFrom(text));
      }

      store.appendMessage(chatId, {
        id: crypto.randomUUID(),
        role: "user",
        text,
        workdir: project.path,
      });

      try {
        if (mode === "codex") {
          await streamCodex(text, project, chatId);
        } else {
          await streamAgent(text, project, chatId);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        activeAbortControllerRef.current = null;
        setBusy(false);
      }
    },
    [busy, input, mode, resetComposer, store, streamAgent, streamCodex],
  );

  const handleCancelTask = useCallback(() => {
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
      activeAbortControllerRef.current = null;
    }
    liveVoice.cancelTask();
  }, [liveVoice]);

  const holdToTalk = useCallback(() => {
    if (voiceInputMode !== "push" || !voiceActive) return;
    liveVoice.setMuted(false);
  }, [liveVoice, voiceActive, voiceInputMode]);

  const releaseToMute = useCallback(() => {
    if (voiceInputMode !== "push" || !voiceActive) return;
    liveVoice.setMuted(true);
  }, [liveVoice, voiceActive, voiceInputMode]);

  const toggleVoice = () => {
    primeAudioPlayback();
    resetActiveVoiceMessages();
    if (voiceActive) {
      stopActiveVoiceHandoff("Stopped before completion.");
      liveVoice.stop();
      clearVoiceContext();
    } else if (store.activeProject) {
      const chatId = store.activeChatId || store.createChat(store.activeProject.id).id;
      setVoiceContext(store.activeProject, chatId);
      liveVoice.start();
      if (voiceInputMode === "push") {
        liveVoice.setMuted(true);
      }
    }
  };

  const { voiceTitle, liveStatusText, streamingStatusText, suggestions } = useChatDisplayState({
    liveVoice,
    voiceActive,
    busy,
    mode,
    messages: store.messages,
  });

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className={cn(
        "flex h-screen w-screen flex-col overflow-hidden bg-surface-0 text-fg",
        isDragging && "select-none",
      )}
    >
      <AppTitleBar
        isMobile={isMobile}
        mobileView={mobileView}
        activeProjectName={store.activeProject?.name || "No Project"}
        activeChatTitle={store.activeChat?.title}
        projectInfo={projectInfo}
        searchQuery={searchQuery}
        searchResults={searchResults}
        searching={searching}
        railOpen={railOpen}
        panelOpen={panelOpen}
        voiceActive={voiceActive}
        onMobileViewChange={setMobileView}
        onSearchQueryChange={setSearchQuery}
        onOpenSearchResult={openSearchResult}
        onToggleRail={() => setRailOpen((open) => !open)}
        onTogglePanel={() => setPanelOpen((open) => !open)}
      />

      <WorkspaceLayout
        isMobile={isMobile}
        mobileView={mobileView}
        railOpen={railOpen}
        panelOpen={panelOpen}
        railWidth={railWidth}
        panelWidth={panelWidth}
        theme={store.theme}
        projects={store.projects}
        chats={store.chats}
        activeProjectId={store.activeId}
        activeProject={store.activeProject}
        activeChatId={store.activeChatId}
        activeChatTitle={store.activeChat?.title}
        activeChatByProject={store.activeChatByProject}
        expandedProjects={expandedProjects}
        visibleChatsCount={visibleChatsCount}
        messages={store.messages}
        mode={mode}
        busy={busy}
        suggestions={suggestions}
        messageEndRef={messageEndRef}
        liveStatusText={liveStatusText}
        streamingStatusText={streamingStatusText}
        voiceTitle={voiceTitle}
        voiceMessage={liveVoice.message}
        voiceContextLabel={voiceContextLabel}
        voiceTranscriptPreview={liveVoice.transcriptPreview}
        voiceMuted={liveVoice.muted}
        voiceSupported={liveVoice.supported}
        voiceActive={voiceActive}
        voiceInputMode={voiceInputMode}
        input={input}
        error={error}
        textareaRef={textareaRef}
        status={status}
        activeConsoleTab={activeConsoleTab}
        debugEntries={debugEntries}
        actions={actions}
        handoffs={handoffs}
        doctorChecks={doctorChecks}
        voices={voices}
        selectedVoiceURI={selectedVoiceURI}
        pendingAudioUrl={pendingAudioUrl}
        onNewProject={() => setShowAdd(true)}
        onToggleTheme={() => store.setTheme(store.theme === "dark" ? "light" : "dark")}
        onOpenConsoleSettings={() => {
          setPanelOpen(true);
          openVoiceTab();
        }}
        onToggleProject={toggleProjectExpanded}
        onCreateChat={(projectId) => {
          store.createChat(projectId);
          markProjectExpanded(projectId);
          if (isMobile) {
            setMobileView("chat");
          }
        }}
        onRemoveProject={handleRemoveProject}
        onSelectChat={(projectId, chatId) => {
          store.selectChat(projectId, chatId);
          if (isMobile) {
            setMobileView("chat");
          }
        }}
        onRenameChat={handleRenameChat}
        onRemoveChat={handleRemoveChat}
        onShowMoreChats={showMoreChats}
        onOpenVoiceSettings={() => {
          setMobileView("console");
          openVoiceTab();
        }}
        onChatKeyDown={handleChatSwitcherKeyDown}
        onStartRailDrag={startRailDrag}
        onStartPanelDrag={startPanelDrag}
        onModeChange={setMode}
        onExportChat={handleExportChat}
        onToggleVoice={toggleVoice}
        onSuggestion={(suggestion) => void send(suggestion)}
        onCommitChangeReview={confirmCommitChangeReview}
        onRevertChangeReview={confirmRevertChangeReview}
        onInputChange={onComposerInput}
        onSubmit={() => void send()}
        onCancelTask={handleCancelTask}
        onToggleMute={liveVoice.toggleMute}
        onHoldToTalk={holdToTalk}
        onReleaseToMute={releaseToMute}
        onHideConsole={() => setPanelOpen(false)}
        onBackToChat={() => setMobileView("chat")}
        onClearThread={clearThread}
        onConsoleTabChange={setActiveConsoleTab}
        onRefreshDoctor={refreshDoctor}
        onSelectedVoiceChange={setSelectedVoiceURI}
        onVoiceInputModeChange={(nextMode) => {
          setVoiceInputMode(nextMode);
          if (voiceActive) {
            liveVoice.setMuted(nextMode === "push");
          }
        }}
        onPlayResponseAudio={(audioUrl) => void playResponseAudio(audioUrl)}
      />

      {/* Modals rendering */}
      {showAdd && (
        <AddProjectModal
          onClose={() => setShowAdd(false)}
          onCreate={(p) => {
            store.createProject(p);
            setShowAdd(false);
          }}
          usedColors={store.projects.map((p) => p.color)}
          existingPaths={store.projects.map((p) => p.path)}
        />
      )}
      {confirmDialog && (
        <ConfirmModal dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />
      )}
      {renameDialog && (
        <RenameChatModal
          dialog={renameDialog}
          onClose={() => setRenameDialog(null)}
          onRename={store.renameChat}
        />
      )}
    </div>
  );
}
export default App;
