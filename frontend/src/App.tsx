import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Folder,
  GitBranch,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Sparkles,
  SquareTerminal,
} from "lucide-react";

import { useProjectStore } from "./hooks/useProjectStore";
import { useLiveVoice } from "./hooks/useLiveVoice";
import { useStreamingChat } from "./hooks/useStreamingChat";
import { useSpeechPlayback } from "./hooks/useSpeechPlayback";
import { useConsoleSession } from "./hooks/useConsoleSession";
import * as api from "./services/api";
import {
  Project,
  ProjectInfo,
  CodexTimelineEvent,
  ChatArtifact,
  SearchResult,
  DoctorCheck,
} from "./types";
import { loadJSON, saveJSON, chatTitleFrom, cn } from "./utils";
import { appendArtifacts } from "./utils/artifacts";

import AddProjectModal from "./components/modals/AddProjectModal";
import ConfirmModal, { ConfirmDialogState } from "./components/modals/ConfirmModal";
import RenameChatModal, { RenameDialogState } from "./components/modals/RenameChatModal";
import ChatTopBar from "./components/chat/ChatTopBar";
import ComposerFooter from "./components/chat/ComposerFooter";
import ChatStream from "./components/chat/ChatStream";
import ConsoleTabs, { ConsoleTabId } from "./components/console/ConsoleTabs";
import ConsoleStreamPanel from "./components/console/ConsoleStreamPanel";
import ConsoleHandoffsPanel from "./components/console/ConsoleHandoffsPanel";
import ConsoleActionsPanel from "./components/console/ConsoleActionsPanel";
import ConsoleVoicePanel from "./components/console/ConsoleVoicePanel";
import ConsoleStatsFooter from "./components/console/ConsoleStatsFooter";
import ConsoleHeader from "./components/console/ConsoleHeader";
import ActivityRail from "./components/layout/ActivityRail";
import WorkspaceSidebar from "./components/layout/WorkspaceSidebar";

type VoiceInputMode = "open" | "push";

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

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"agent" | "codex">("agent");
  const [status, setStatus] = useState("Checking backend");

  const [voiceInputMode, setVoiceInputMode] = useState<VoiceInputMode>(() =>
    loadJSON<VoiceInputMode>("cva.voiceInputMode.v1", "open"),
  );

  const [showAdd, setShowAdd] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [renameDialog, setRenameDialog] = useState<RenameDialogState | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);

  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 768 : false,
  );
  const [mobileView, setMobileView] = useState<"explorer" | "chat" | "console">("chat");
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const [railWidth, setRailWidth] = useState(() => loadJSON<number>("cva.railWidth.v2", 268));
  const [panelWidth, setPanelWidth] = useState(() => loadJSON<number>("cva.panelWidth.v2", 380));
  const [isDragging, setIsDragging] = useState(false);
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);
  const [activeConsoleTab, setActiveConsoleTab] = useState<ConsoleTabId>("stream");
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [visibleChatsCount, setVisibleChatsCount] = useState<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [doctorChecks, setDoctorChecks] = useState<DoctorCheck[]>([]);

  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Resize drags
  const startRailDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(180, Math.min(420, moveEvent.clientX - 56));
      setRailWidth(newWidth);
    };
    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  const startPanelDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(260, Math.min(600, window.innerWidth - moveEvent.clientX));
      setPanelWidth(newWidth);
    };
    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  // Persist layout sizing
  useEffect(() => saveJSON("cva.railWidth.v2", railWidth), [railWidth]);
  useEffect(() => saveJSON("cva.panelWidth.v2", panelWidth), [panelWidth]);
  useEffect(() => saveJSON("cva.voiceInputMode.v1", voiceInputMode), [voiceInputMode]);

  // Scroll messages
  const scrollToBottom = () => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [store.messages.length, busy]);

  // Fetch backend health status
  useEffect(() => {
    api
      .fetchHealth()
      .then((data) => {
        setStatus(data.has_google_api_key ? "Ready" : "Missing Google API key");
      })
      .catch(() => setStatus("Backend offline"));
  }, []);

  const refreshDoctor = useCallback(() => {
    api
      .fetchDoctor()
      .then(async (report) => {
        const canRequestMic = typeof navigator.mediaDevices?.getUserMedia === "function";
        let micCheck: DoctorCheck = {
          name: "Microphone permission",
          ok: canRequestMic,
          message: canRequestMic
            ? "Browser can request microphone access"
            : "Microphone API unavailable",
          fix: "Use a browser with microphone support and allow microphone access when prompted.",
        };
        try {
          const permissions = navigator.permissions;
          if (permissions?.query) {
            const status = await permissions.query({ name: "microphone" as PermissionName });
            micCheck = {
              name: "Microphone permission",
              ok: status.state === "granted" || status.state === "prompt",
              message:
                status.state === "granted"
                  ? "Allowed"
                  : status.state === "prompt"
                    ? "Will ask when voice starts"
                    : "Blocked",
              fix: "Allow microphone access in the browser or system privacy settings.",
            };
          }
        } catch {
          // Some browsers do not expose microphone permission through Permissions API.
        }
        setDoctorChecks([...(report.checks || []), micCheck]);
      })
      .catch(() => setDoctorChecks([]));
  }, []);

  useEffect(() => {
    refreshDoctor();
  }, [refreshDoctor]);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isMobile) return;
    const target = e.target as HTMLElement;
    if (
      target.tagName === "TEXTAREA" ||
      target.tagName === "INPUT" ||
      target.tagName === "SELECT" ||
      target.closest("pre") ||
      target.closest(".code-block-pre")
    ) {
      touchStartX.current = null;
      touchStartY.current = null;
      return;
    }
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!isMobile || touchStartX.current === null || touchStartY.current === null) return;

    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;

    const diffX = touchEndX - touchStartX.current;
    const diffY = touchEndY - touchStartY.current;

    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 60) {
      if (diffX > 0) {
        if (mobileView === "console") {
          setMobileView("chat");
        } else if (mobileView === "chat") {
          setMobileView("explorer");
        }
      } else {
        if (mobileView === "explorer") {
          setMobileView("chat");
        } else if (mobileView === "chat") {
          setMobileView("console");
        }
      }
    }

    touchStartX.current = null;
    touchStartY.current = null;
  };

  // Validate path and check git statistics
  useEffect(() => {
    setProjectInfo(null);
    if (!store.activeProject) return;
    let cancelled = false;
    api
      .getProjectInfo(store.activeProject.path)
      .then((info) => {
        if (!cancelled) setProjectInfo(info);
      })
      .catch(() => {
        if (!cancelled) {
          setProjectInfo({
            path: store.activeProject!.path,
            name: store.activeProject!.name,
            exists: false,
            is_git: false,
            branch: null,
            file_count: null,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [store.activeProject]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      api
        .searchContent(query)
        .then((results) => {
          if (!cancelled) setSearchResults(results);
        })
        .catch(() => {
          if (!cancelled) setSearchResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

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

      setInput("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
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
    [busy, input, mode, store, streamAgent, streamCodex],
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

  const clearThread = () => {
    if (!store.activeProject || !store.activeChatId) return;
    const chatId = store.activeChatId;
    store.clearChatThread(store.activeChatId);
    clearConsoleState();
    setError("");
    api.deleteConsoleState(chatId).catch(() => {});
  };

  const onComposerInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 168)}px`;
  };

  const handleRemoveProject = (id: string, name: string) => {
    setConfirmDialog({
      title: "Remove project",
      body: `Remove ${name}? This clears its chats and local history.`,
      actionLabel: "Remove",
      danger: true,
      onConfirm: () => store.removeProject(id),
    });
  };

  const handleRemoveChat = (projectId: string, chatId: string) => {
    setConfirmDialog({
      title: "Delete conversation",
      body: "Delete this conversation and its local history?",
      actionLabel: "Delete",
      danger: true,
      onConfirm: () => store.removeChat(projectId, chatId),
    });
  };

  const handleRenameChat = (projectId: string, chatId: string, title: string) => {
    setRenameDialog({ projectId, chatId, initialTitle: title });
  };

  const handleRevertChangeReview = async (artifact: ChatArtifact) => {
    const files = artifact.changed_files || [];
    if (!artifact.workdir || files.length === 0) {
      setError("This change review artifact does not include files to revert.");
      return;
    }
    const actionId = addAction({
      title: "Revert Codex changes",
      status: "running",
      detail: files.join(", "),
      workdir: artifact.workdir,
    });
    try {
      const result = await api.revertChangeReview(artifact.workdir, files);
      updateAction(actionId, {
        status: "done",
        streamingResponse: `Reverted ${result.reverted_files.length} file${result.reverted_files.length === 1 ? "" : "s"}.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to revert changes";
      updateAction(actionId, { status: "failed", streamingResponse: message });
      setError(message);
    }
  };

  const commitMessageForChangeReview = (artifact: ChatArtifact) => {
    const files = artifact.changed_files || [];
    if (files.length === 1) return `Apply Codex changes to ${files[0]}`;
    return `Apply Codex changes to ${files.length} files`;
  };

  const handleCommitChangeReview = async (artifact: ChatArtifact) => {
    const files = artifact.changed_files || [];
    if (!artifact.workdir || files.length === 0) {
      setError("This change review artifact does not include files to commit.");
      return;
    }
    const message = commitMessageForChangeReview(artifact);
    const actionId = addAction({
      title: "Commit Codex changes",
      status: "running",
      detail: message,
      workdir: artifact.workdir,
    });
    try {
      const result = await api.commitChangeReview(artifact.workdir, files, message);
      updateAction(actionId, {
        status: "done",
        streamingResponse: `Committed ${result.committed_files.length} file${result.committed_files.length === 1 ? "" : "s"} as ${result.commit}.`,
      });
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "Failed to commit changes";
      updateAction(actionId, { status: "failed", streamingResponse: messageText });
      setError(messageText);
    }
  };

  const confirmCommitChangeReview = (artifact: ChatArtifact) => {
    const files = artifact.changed_files || [];
    setConfirmDialog({
      title: "Commit Codex changes?",
      body: `Stage and commit ${files.length} changed file${files.length === 1 ? "" : "s"} from this turn. Other local files will not be staged.`,
      actionLabel: "Commit",
      onConfirm: () => void handleCommitChangeReview(artifact),
    });
  };

  const confirmRevertChangeReview = (artifact: ChatArtifact) => {
    const files = artifact.changed_files || [];
    setConfirmDialog({
      title: "Revert Codex changes?",
      body: `Restore ${files.length} changed file${files.length === 1 ? "" : "s"} from this turn back to HEAD. Untracked files in this change set will be removed.`,
      actionLabel: "Revert",
      danger: true,
      onConfirm: () => void handleRevertChangeReview(artifact),
    });
  };

  const handleExportChat = async () => {
    if (!store.activeChatId) return;
    try {
      const { blob, filename } = await api.exportChatMarkdown(store.activeChatId);
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export chat");
    }
  };

  const openSearchResult = (result: SearchResult) => {
    if (!result.chat_id) return;
    let projectId = result.project_id || "";
    if (!projectId) {
      for (const [candidateProjectId, projectChats] of Object.entries(store.chats)) {
        if (projectChats.some((chat) => chat.id === result.chat_id)) {
          projectId = candidateProjectId;
          break;
        }
      }
    }
    if (!projectId) return;
    store.selectChat(projectId, result.chat_id);
    setSearchQuery("");
    setSearchResults([]);
    if (isMobile) setMobileView("chat");
  };

  const handleChatSwitcherKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-chat-switcher]"),
    );
    if (buttons.length === 0) return;
    const currentIndex = buttons.indexOf(event.currentTarget);
    if (currentIndex === -1) return;
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : event.key === "ArrowUp"
            ? Math.max(0, currentIndex - 1)
            : Math.min(buttons.length - 1, currentIndex + 1);
    buttons[nextIndex]?.focus();
  };

  const formatElapsed = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  const voiceTitle =
    liveVoice.state === "connecting"
      ? "Connecting…"
      : liveVoice.state === "live"
        ? "Live conversation"
        : liveVoice.state === "thinking"
          ? "Gemini is responding"
          : liveVoice.state === "working"
            ? `Codex is working (${formatElapsed(liveVoice.elapsed)})`
            : liveVoice.state === "error"
              ? "Voice needs attention"
              : "Live voice";
  const liveStatusText = [
    voiceActive ? voiceTitle : "",
    voiceActive ? liveVoice.message : "",
    busy ? "Assistant response in progress" : "",
  ]
    .filter(Boolean)
    .join(". ");
  const activeStreamingMessage = [...store.messages]
    .reverse()
    .find((message) => message.streaming && message.role === "assistant");
  const streamingStatusText = activeStreamingMessage?.text
    ? `Assistant response update: ${activeStreamingMessage.text.slice(-500)}`
    : busy
      ? "Assistant response in progress"
      : "";

  const suggestions =
    mode === "codex"
      ? [
          "List the files in this directory",
          "Show the git status",
          "Run the test suite",
          "Summarize this codebase",
        ]
      : [
          "Find all TODOs in the codebase",
          "What changed in the last commit?",
          "Explain the main entry point of the project",
          "Explain the project structure",
        ];

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className={cn(
        "flex h-screen w-screen flex-col overflow-hidden bg-surface-0 text-fg",
        isDragging && "select-none",
      )}
    >
      {/* TitleBar */}
      {!isMobile ? (
        <header className="flex h-11 shrink-0 items-center gap-4 border-b border-line bg-surface-1 px-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/15 text-accent">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <span className="text-[13px] font-semibold tracking-tight">Codex</span>
            <span className="mx-1 text-fg-dim">/</span>
            <button className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] text-fg-muted hover:bg-surface-2 hover:text-fg">
              <Folder className="h-3.5 w-3.5 text-accent/80" />
              {store.activeProject?.name || "No Project"}
            </button>
            {store.activeChat && (
              <>
                <span className="text-fg-dim">/</span>
                <span className="px-1 text-[12.5px] text-fg truncate max-w-[240px]">
                  {store.activeChat.title}
                </span>
              </>
            )}
            {projectInfo?.is_git && projectInfo.branch && (
              <>
                <span className="text-fg-dim">/</span>
                <button className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-[11px] text-fg-muted hover:bg-surface-2 hover:text-accent">
                  <GitBranch className="h-3 w-3" />
                  {projectInfo.branch}
                </button>
              </>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[11.5px] text-fg-muted">
                <Search className="h-3.5 w-3.5" />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search chats"
                  className="w-48 bg-transparent text-[11.5px] text-fg outline-none placeholder:text-fg-dim"
                />
              </div>
              {searchQuery.trim().length >= 2 && (
                <div className="absolute right-0 top-8 z-30 w-80 overflow-hidden rounded-md border border-line bg-surface-1 shadow-xl">
                  <div className="border-b border-line-soft px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-fg-dim">
                    {searching
                      ? "Searching"
                      : `${searchResults.length} result${searchResults.length === 1 ? "" : "s"}`}
                  </div>
                  <div className="max-h-80 overflow-y-auto py-1">
                    {!searching && searchResults.length === 0 ? (
                      <div className="px-3 py-3 text-[12px] text-fg-dim">No matches found.</div>
                    ) : (
                      searchResults.map((result) => (
                        <button
                          key={`${result.type}-${result.id}`}
                          onClick={() => openSearchResult(result)}
                          className="flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-surface-2"
                        >
                          <span className="flex items-center gap-2 text-[12px] font-semibold text-fg">
                            <span className="rounded border border-line-soft px-1.5 py-0.5 font-mono text-[9px] uppercase text-fg-dim">
                              {result.type}
                            </span>
                            {result.title || "Result"}
                          </span>
                          <span className="max-h-9 overflow-hidden text-[11.5px] leading-relaxed text-fg-muted">
                            {result.snippet || "No preview available."}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <button
              title={railOpen ? "Hide workspace sidebar" : "Show workspace sidebar"}
              aria-label={railOpen ? "Hide workspace sidebar" : "Show workspace sidebar"}
              aria-pressed={railOpen}
              onClick={() => setRailOpen((open) => !open)}
              className={cn(
                "grid h-7 w-7 place-items-center rounded-md border transition-colors",
                railOpen
                  ? "border-line bg-surface-3 text-fg"
                  : "border-line bg-surface-2 text-fg-muted hover:text-fg hover:bg-surface-3",
              )}
            >
              {railOpen ? (
                <PanelLeftClose className="h-3.5 w-3.5" />
              ) : (
                <PanelLeftOpen className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              title={panelOpen ? "Hide console panel" : "Show console panel"}
              aria-label={panelOpen ? "Hide console panel" : "Show console panel"}
              aria-pressed={panelOpen}
              onClick={() => setPanelOpen((open) => !open)}
              className={cn(
                "grid h-7 w-7 place-items-center rounded-md border transition-colors",
                panelOpen
                  ? "border-line bg-surface-3 text-fg"
                  : "border-line bg-surface-2 text-fg-muted hover:text-fg hover:bg-surface-3",
              )}
            >
              {panelOpen ? (
                <PanelRightClose className="h-3.5 w-3.5" />
              ) : (
                <PanelRightOpen className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </header>
      ) : (
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-surface-1 px-3">
          <button
            onClick={() => setMobileView(mobileView === "explorer" ? "chat" : "explorer")}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface-2 text-fg-muted",
              mobileView === "explorer" && "bg-surface-3 text-accent border-accent/30",
            )}
          >
            <Menu className="h-4.5 w-4.5" />
          </button>

          <div className="flex flex-col items-center min-w-0">
            <span className="text-[13px] font-semibold tracking-tight truncate max-w-[200px]">
              {mobileView === "explorer"
                ? "Workspace"
                : mobileView === "console"
                  ? "Console"
                  : store.activeProject?.name || "No Project"}
            </span>
            {mobileView === "chat" && store.activeChat && (
              <span className="text-[10px] text-fg-dim truncate max-w-[200px] leading-tight">
                {store.activeChat.title}
              </span>
            )}
          </div>

          <button
            onClick={() => setMobileView(mobileView === "console" ? "chat" : "console")}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface-2 text-fg-muted relative",
              mobileView === "console" && "bg-surface-3 text-accent border-accent/30",
            )}
          >
            <SquareTerminal className="h-4.5 w-4.5" />
            {voiceActive && (
              <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-accent" />
            )}
          </button>
        </header>
      )}

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
              setActiveConsoleTab("voice");
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
            onToggleProject={(projectId, expanded) => {
              setExpandedProjects((prev) => ({
                ...prev,
                [projectId]: !expanded,
              }));
            }}
            onCreateChat={(projectId) => {
              store.createChat(projectId);
              setExpandedProjects((prev) => ({
                ...prev,
                [projectId]: true,
              }));
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
            onShowMoreChats={(projectId) => {
              setVisibleChatsCount((prev) => ({
                ...prev,
                [projectId]: (prev[projectId] || 5) + 5,
              }));
            }}
            onToggleTheme={() => store.setTheme(store.theme === "dark" ? "light" : "dark")}
            onOpenVoiceSettings={() => {
              setMobileView("console");
              setActiveConsoleTab("voice");
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
          <main className="flex flex-1 min-w-0 min-h-0 flex-col bg-surface-0 relative">
            <ChatTopBar
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
            />
            <ChatStream
              isMobile={isMobile}
              busy={busy}
              mode={mode}
              activeProject={store.activeProject}
              messages={store.messages}
              suggestions={suggestions}
              messageEndRef={messageEndRef}
              onAddProject={() => setShowAdd(true)}
              onSuggestion={(suggestion) => void send(suggestion)}
              onCommitChangeReview={confirmCommitChangeReview}
              onRevertChangeReview={confirmRevertChangeReview}
            />

            <ComposerFooter
              isMobile={isMobile}
              liveStatusText={liveStatusText}
              streamingStatusText={streamingStatusText}
              voiceActive={voiceActive}
              voiceTitle={voiceTitle}
              voiceMessage={liveVoice.message}
              voiceContextLabel={voiceContextLabel}
              voiceTranscriptPreview={liveVoice.transcriptPreview}
              voiceMuted={liveVoice.muted}
              voiceSupported={liveVoice.supported}
              voiceInputMode={voiceInputMode}
              input={input}
              busy={busy}
              hasActiveProject={Boolean(store.activeProject)}
              error={error}
              textareaRef={textareaRef}
              onInputChange={onComposerInput}
              onSubmit={() => void send()}
              onCancelTask={handleCancelTask}
              onToggleVoice={toggleVoice}
              onToggleMute={liveVoice.toggleMute}
              onHoldToTalk={holdToTalk}
              onReleaseToMute={releaseToMute}
            />
          </main>
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
          <aside
            style={isMobile ? { width: "100%" } : { width: `${panelWidth}px` }}
            className={cn(
              "flex h-full min-h-0 flex-col bg-surface-1 shrink-0",
              !isMobile ? "border-l border-line" : "w-full",
            )}
          >
            <ConsoleHeader
              isMobile={isMobile}
              status={status}
              canClear={Boolean(store.activeChatId)}
              onHide={() => setPanelOpen(false)}
              onBackToChat={() => setMobileView("chat")}
              onClear={clearThread}
            />

            <ConsoleTabs activeTab={activeConsoleTab} onChange={setActiveConsoleTab} />

            {/* Console Contents */}
            <div className="flex-1 overflow-y-auto p-3">
              {activeConsoleTab === "stream" && <ConsoleStreamPanel entries={debugEntries} />}

              {activeConsoleTab === "actions" && <ConsoleActionsPanel actions={actions} />}

              {activeConsoleTab === "handoffs" && <ConsoleHandoffsPanel handoffs={handoffs} />}

              {activeConsoleTab === "voice" && (
                <ConsoleVoicePanel
                  doctorChecks={doctorChecks}
                  voices={voices}
                  selectedVoiceURI={selectedVoiceURI}
                  voiceInputMode={voiceInputMode}
                  pendingAudioUrl={pendingAudioUrl}
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

            <ConsoleStatsFooter messages={store.messages} />
          </aside>
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
