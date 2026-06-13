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
import { Project, CodexTimelineEvent, ChatArtifact } from "./types";
import { chatTitleFrom, cn } from "./utils";
import { appendArtifacts } from "./utils/artifacts";

import AddProjectModal from "./components/modals/AddProjectModal";
import ConfirmModal from "./components/modals/ConfirmModal";
import RenameChatModal from "./components/modals/RenameChatModal";
import ChatPanel from "./components/chat/ChatPanel";
import ConsolePanel from "./components/console/ConsolePanel";
import ActivityRail from "./components/layout/ActivityRail";
import AppTitleBar from "./components/layout/AppTitleBar";
import WorkspaceSidebar from "./components/layout/WorkspaceSidebar";

function appendCodexEvent(
  events: CodexTimelineEvent[] | undefined,
  event: CodexTimelineEvent,
): CodexTimelineEvent[] {
  const current = events || [];
  // Dedup on method + item_id (unique per Codex item). Avoid including summary
  // in the key since different items can share the same summary text.
  const key = `${event.method}:${event.item_id || ""}:${event.turn_id || ""}`;
  const existing = new Set(current.map((e) => `${e.method}:${e.item_id || ""}:${e.turn_id || ""}`));
  if (existing.has(key)) return current;
  return [...current, event].slice(-80);
}

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

  const stopActiveVoiceHandoff = useCallback(
    (detail = "Stopped before completion.") => {
      if (!activeVoiceActionIdRef.current) return;
      updateAction(activeVoiceActionIdRef.current, {
        status: "failed",
        detail,
      });
      activeVoiceActionIdRef.current = null;
    },
    [updateAction],
  );

  const {
    voices,
    selectedVoiceURI,
    setSelectedVoiceURI,
    pendingAudioUrl,
    speak,
    primeAudioPlayback,
    playResponseAudio,
  } = useSpeechPlayback({ setError });

  // Voice websocket configs triggers
  const voiceCtxRef = useRef<{ project: Project; chatId: string } | null>(null);
  const getWorkdir = useCallback(
    () => voiceCtxRef.current?.project.path ?? store.activeProject?.path,
    [store.activeProject],
  );
  const getProjectId = useCallback(
    () => voiceCtxRef.current?.project.id ?? store.activeProject?.id,
    [store.activeProject],
  );
  const getChatId = useCallback(
    () => voiceCtxRef.current?.chatId || store.activeChatId,
    [store.activeChatId],
  );

  const activeVoiceActionIdRef = useRef<string | null>(null);
  const activeUserVoiceMsgIdRef = useRef<string | null>(null);
  const activeAssistantVoiceMsgIdRef = useRef<string | null>(null);
  const activeAbortControllerRef = useRef<AbortController | null>(null);

  const liveVoice = useLiveVoice({
    getWorkdir,
    getProjectId,
    getChatId,
    onAudio: playResponseAudio,
    onDebug: addDebug,
    onUserTranscript: (text) => {
      const ctx = voiceCtxRef.current;
      if (!ctx) return;
      if (!activeUserVoiceMsgIdRef.current) {
        const id = crypto.randomUUID();
        activeUserVoiceMsgIdRef.current = id;
        store.appendMessage(ctx.chatId, {
          id,
          role: "user",
          text,
          workdir: ctx.project.path,
        });
        if ((store.messagesByChat[ctx.chatId] || []).length === 0) {
          store.renameChat(ctx.project.id, ctx.chatId, chatTitleFrom(text || "Voice message"));
        }
      } else {
        store.updateMessage(ctx.chatId, activeUserVoiceMsgIdRef.current, (m) => ({
          ...m,
          text: m.text + text,
        }));
      }
    },
    onAssistantDelta: (text) => {
      const ctx = voiceCtxRef.current;
      if (!ctx) return;
      if (!activeAssistantVoiceMsgIdRef.current) {
        const id = crypto.randomUUID();
        activeAssistantVoiceMsgIdRef.current = id;
        store.appendMessage(ctx.chatId, {
          id,
          role: "assistant",
          text,
          streaming: true,
        });
      } else {
        store.updateMessage(ctx.chatId, activeAssistantVoiceMsgIdRef.current, (m) => ({
          ...m,
          text: m.text + text,
        }));
      }
    },
    onInterrupted: () => {
      const ctx = voiceCtxRef.current;
      if (!ctx) return;
      stopActiveVoiceHandoff("Interrupted before completion.");
      if (activeAssistantVoiceMsgIdRef.current) {
        store.updateMessage(ctx.chatId, activeAssistantVoiceMsgIdRef.current, (m) => ({
          ...m,
          streaming: false,
          text: m.text + " [Interrupted]",
        }));
      }
      activeUserVoiceMsgIdRef.current = null;
      activeAssistantVoiceMsgIdRef.current = null;
    },
    onSessionRestarted: () => {
      const ctx = voiceCtxRef.current;
      if (!ctx) return;
      if (activeAssistantVoiceMsgIdRef.current) {
        store.updateMessage(ctx.chatId, activeAssistantVoiceMsgIdRef.current, (m) => ({
          ...m,
          streaming: false,
        }));
      }
      store.appendMessage(ctx.chatId, {
        id: crypto.randomUUID(),
        role: "assistant",
        text: "Voice session restarted. Context is preserved up to your last completed turn.",
        workdir: ctx.project.path,
      });
      activeUserVoiceMsgIdRef.current = null;
      activeAssistantVoiceMsgIdRef.current = null;
    },
    onTurnComplete: (userText, assistantText, usedCodex, workdir) => {
      const ctx = voiceCtxRef.current;
      if (!ctx) return;
      const finalUserText = userText.trim();
      const finalAssistantText = assistantText.trim();
      if (activeUserVoiceMsgIdRef.current) {
        store.updateMessage(ctx.chatId, activeUserVoiceMsgIdRef.current, (m) => ({
          ...m,
          text: finalUserText || m.text,
        }));
      } else if (finalUserText) {
        store.appendMessage(ctx.chatId, {
          id: crypto.randomUUID(),
          role: "user",
          text: finalUserText,
          workdir: ctx.project.path,
        });
      }
      if (activeAssistantVoiceMsgIdRef.current) {
        store.updateMessage(ctx.chatId, activeAssistantVoiceMsgIdRef.current, (m) => ({
          ...m,
          text: finalAssistantText || m.text,
          streaming: false,
          usedCodex,
          workdir,
        }));
      } else if (finalAssistantText || usedCodex) {
        store.appendMessage(ctx.chatId, {
          id: crypto.randomUUID(),
          role: "assistant",
          text: finalAssistantText,
          usedCodex,
          workdir,
        });
      }
      activeUserVoiceMsgIdRef.current = null;
      activeAssistantVoiceMsgIdRef.current = null;
    },
    onHandoffStart: (name, task, workdir) => {
      const ctx = voiceCtxRef.current;
      if (ctx && activeAssistantVoiceMsgIdRef.current) {
        store.updateMessage(ctx.chatId, activeAssistantVoiceMsgIdRef.current, (m) => ({
          ...m,
          usedCodex: true,
        }));
      }
      const id = addAction({
        title: "Voice handoff to Codex",
        status: "running",
        detail: task,
        streamingResponse: "",
        workdir: workdir || voiceCtxRef.current?.project.path,
      });
      activeVoiceActionIdRef.current = id;
    },
    onHandoffProgress: (name, text) => {
      if (activeVoiceActionIdRef.current) {
        updateAction(activeVoiceActionIdRef.current, (prev) => ({
          streamingResponse: (prev.streamingResponse || "") + text,
        }));
      }
    },
    onHandoffFailed: (name, message) => {
      if (activeVoiceActionIdRef.current) {
        updateAction(activeVoiceActionIdRef.current, {
          status: "failed",
          streamingResponse: message || "Handoff failed",
        });
        activeVoiceActionIdRef.current = null;
      }
    },
    onHandoffTimeout: () => {
      const ctx = voiceCtxRef.current;
      if (!ctx || !activeAssistantVoiceMsgIdRef.current) return;
      store.updateMessage(ctx.chatId, activeAssistantVoiceMsgIdRef.current, (m) => ({
        ...m,
        streaming: false,
        text:
          m.text ||
          "Codex finished the local work. The full output is available below, but Gemini did not finish a final response.",
      }));
    },
    onCodexEvent: (event) => {
      const ctx = voiceCtxRef.current;
      if (!ctx || !event) return;
      if (activeAssistantVoiceMsgIdRef.current) {
        store.updateMessage(ctx.chatId, activeAssistantVoiceMsgIdRef.current, (m) => ({
          ...m,
          usedCodex: true,
          codexEvents: appendCodexEvent(m.codexEvents, event as CodexTimelineEvent),
          codexStatus: String(event.status || m.codexStatus || ""),
          codexTurnId: String(event.turn_id || m.codexTurnId || ""),
          codexThreadId: String(event.thread_id || m.codexThreadId || ""),
        }));
      }
      // Keep prompt detail as the original task, do not overwrite with intermediate event summaries
    },
    onHandoff: (name, summary, workdir, details) => {
      addHandoff(name, summary);
      const ctx = voiceCtxRef.current;
      if (ctx) {
        const artifact = details?.artifact as ChatArtifact | undefined;
        const changeArtifact = details?.change_artifact as ChatArtifact | undefined;
        if (activeAssistantVoiceMsgIdRef.current) {
          store.updateMessage(ctx.chatId, activeAssistantVoiceMsgIdRef.current, (m) => ({
            ...m,
            usedCodex: true,
            codexEvents: (details?.codex_events || m.codexEvents || []) as CodexTimelineEvent[],
            codexStatus: String(details?.codex_status || m.codexStatus || ""),
            codexTurnId: String(details?.codex_turn_id || m.codexTurnId || ""),
            codexThreadId: String(details?.codex_thread_id || m.codexThreadId || ""),
            artifacts: appendArtifacts(m.artifacts, artifact, changeArtifact),
          }));
        } else {
          const id = crypto.randomUUID();
          activeAssistantVoiceMsgIdRef.current = id;
          store.appendMessage(ctx.chatId, {
            id,
            role: "assistant",
            text: "Codex finished the local work. The full output is available below while Gemini prepares the final response.",
            usedCodex: true,
            streaming: true,
            workdir,
            artifacts: appendArtifacts([], artifact, changeArtifact),
            codexEvents: (details?.codex_events || []) as CodexTimelineEvent[],
            codexStatus: String(details?.codex_status || ""),
            codexTurnId: String(details?.codex_turn_id || ""),
            codexThreadId: String(details?.codex_thread_id || ""),
          });
        }
      }
      if (activeVoiceActionIdRef.current) {
        updateAction(activeVoiceActionIdRef.current, {
          status: "done",
          workdir: workdir || voiceCtxRef.current?.project.path,
        });
        activeVoiceActionIdRef.current = null;
      } else {
        addAction({
          title: "Voice handoff to Codex",
          status: "done",
          detail: summary,
          streamingResponse: summary,
          workdir: workdir || voiceCtxRef.current?.project.path,
        });
      }
    },
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
    if (voiceCtxRef.current) return;
    voiceCtxRef.current =
      store.activeProject && store.activeChatId
        ? { project: store.activeProject, chatId: store.activeChatId }
        : null;
  }, [voiceActive, store.activeProject, store.activeChatId]);

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
    activeUserVoiceMsgIdRef.current = null;
    activeAssistantVoiceMsgIdRef.current = null;
    if (voiceActive) {
      stopActiveVoiceHandoff("Stopped before completion.");
      liveVoice.stop();
      voiceCtxRef.current = null;
    } else if (store.activeProject) {
      const chatId = store.activeChatId || store.createChat(store.activeProject.id).id;
      voiceCtxRef.current = { project: store.activeProject, chatId };
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

      {/* Main Container */}
      <div className="flex flex-1 min-h-0 min-w-0">
        {/* Column 1: ActivityRail */}
        {!isMobile && (
          <ActivityRail
            theme={store.theme}
            onNewProject={() => setShowAdd(true)}
            onToggleTheme={() => store.setTheme(store.theme === "dark" ? "light" : "dark")}
            onOpenConsoleSettings={() => {
              setPanelOpen(true);
              openVoiceTab();
            }}
          />
        )}

        {/* Column 2: ExplorerPanel (Resizable Sidebar) */}
        {(!isMobile ? railOpen : mobileView === "explorer") && (
          <WorkspaceSidebar
            isMobile={isMobile}
            width={railWidth}
            projects={store.projects}
            chats={store.chats}
            activeProjectId={store.activeId}
            activeChatByProject={store.activeChatByProject}
            expandedProjects={expandedProjects}
            visibleChatsCount={visibleChatsCount}
            theme={store.theme}
            onAddProject={() => setShowAdd(true)}
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
            onToggleTheme={() => store.setTheme(store.theme === "dark" ? "light" : "dark")}
            onOpenVoiceSettings={() => {
              setMobileView("console");
              openVoiceTab();
            }}
            onChatKeyDown={handleChatSwitcherKeyDown}
          />
        )}

        {/* Column 2 Resizer Handle */}
        {!isMobile && railOpen && (
          <div
            className="w-1 cursor-col-resize hover:bg-accent/40 active:bg-accent transition-colors bg-line-soft shrink-0"
            onMouseDown={startRailDrag}
          />
        )}

        {/* Column 3: ChatPanel */}
        {(!isMobile || mobileView === "chat") && (
          <ChatPanel
            isMobile={isMobile}
            title={store.activeChat?.title || "No Thread Selected"}
            messageCount={store.messages.length}
            mode={mode}
            onModeChange={setMode}
            onExport={handleExportChat}
            exportDisabled={!store.activeChatId || store.messages.length === 0}
            voiceSupported={liveVoice.supported}
            voiceActive={voiceActive}
            voiceDisabled={!store.activeProject}
            onToggleVoice={toggleVoice}
            busy={busy}
            activeProject={store.activeProject}
            messages={store.messages}
            suggestions={suggestions}
            messageEndRef={messageEndRef}
            onAddProject={() => setShowAdd(true)}
            onSuggestion={(suggestion) => void send(suggestion)}
            onCommitChangeReview={confirmCommitChangeReview}
            onRevertChangeReview={confirmRevertChangeReview}
            liveStatusText={liveStatusText}
            streamingStatusText={streamingStatusText}
            voiceTitle={voiceTitle}
            voiceMessage={liveVoice.message}
            voiceContextLabel={voiceContextLabel}
            voiceTranscriptPreview={liveVoice.transcriptPreview}
            voiceMuted={liveVoice.muted}
            voiceInputMode={voiceInputMode}
            input={input}
            hasActiveProject={Boolean(store.activeProject)}
            error={error}
            textareaRef={textareaRef}
            onInputChange={onComposerInput}
            onSubmit={() => void send()}
            onCancelTask={handleCancelTask}
            onToggleMute={liveVoice.toggleMute}
            onHoldToTalk={holdToTalk}
            onReleaseToMute={releaseToMute}
          />
        )}

        {/* Column 3 Resizer Handle */}
        {!isMobile && panelOpen && (
          <div
            className="w-1 cursor-col-resize hover:bg-accent/40 active:bg-accent transition-colors bg-line-soft shrink-0"
            onMouseDown={startPanelDrag}
          />
        )}

        {/* Column 4: ConsolePanel (Resizable Sidebar) */}
        {(!isMobile ? panelOpen : mobileView === "console") && (
          <ConsolePanel
            isMobile={isMobile}
            width={panelWidth}
            status={status}
            canClear={Boolean(store.activeChatId)}
            activeTab={activeConsoleTab}
            debugEntries={debugEntries}
            actions={actions}
            handoffs={handoffs}
            messages={store.messages}
            doctorChecks={doctorChecks}
            voices={voices}
            selectedVoiceURI={selectedVoiceURI}
            voiceInputMode={voiceInputMode}
            pendingAudioUrl={pendingAudioUrl}
            onHide={() => setPanelOpen(false)}
            onBackToChat={() => setMobileView("chat")}
            onClear={clearThread}
            onTabChange={setActiveConsoleTab}
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
        )}
      </div>

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
