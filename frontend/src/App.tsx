import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Cable,
  ChevronRight,
  FileCode2,
  Folder,
  FolderPlus,
  GitBranch,
  Moon,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  Search,
  Settings,
  Sparkles,
  SquareTerminal,
  Sun,
  Trash2,
  Waves,
  X,
  Zap,
  MoreHorizontal,
} from "lucide-react";

import { useProjectStore } from "./hooks/useProjectStore";
import { useLiveVoice } from "./hooks/useLiveVoice";
import * as api from "./services/api";
import {
  Project,
  ActionEntry,
  Handoff,
  DebugEntry,
  ProjectInfo,
  CodexTimelineEvent,
  ChatArtifact,
  SearchResult,
  DoctorCheck,
} from "./types";
import { loadJSON, saveJSON, chatTitleFrom, cn } from "./utils";
import { appendArtifacts, changeArtifacts } from "./utils/artifacts";
import { readSseStream } from "./utils/sse";

import AddProjectModal from "./components/modals/AddProjectModal";
import ConfirmModal, { ConfirmDialogState } from "./components/modals/ConfirmModal";
import RenameChatModal, { RenameDialogState } from "./components/modals/RenameChatModal";
import MarkdownRenderer from "./components/common/MarkdownRenderer";
import ArtifactCard from "./components/artifacts/ArtifactCard";
import ChangeReviewChip from "./components/artifacts/ChangeReviewChip";
import CodexTimeline from "./components/codex/CodexTimeline";
import ChatTopBar from "./components/chat/ChatTopBar";
import ComposerFooter from "./components/chat/ComposerFooter";

const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAwF0AAIC7AAACABAAZGF0YQAAAAA=";

const PREFERRED_VOICE_NAMES = [
  "Samantha",
  "Karen",
  "Moira",
  "Tessa",
  "Google UK English Female",
  "Google US English",
  "Microsoft Aria",
  "Microsoft Jenny",
  "Zira",
];

type VoiceInputMode = "open" | "push";

const VOICE_INPUT_MODES: { id: VoiceInputMode; label: string }[] = [
  { id: "open", label: "Open mic" },
  { id: "push", label: "Push to talk" },
];

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

function codexTokenTotal(messages: { codexEvents?: CodexTimelineEvent[] }[]): number {
  return messages.reduce((total, message) => {
    const usageEvents = (message.codexEvents || []).filter((event) => event.token_usage);
    const latestUsage = usageEvents[usageEvents.length - 1]?.token_usage;
    return total + (latestUsage?.total_tokens || 0);
  }, 0);
}

export function App() {
  const store = useProjectStore();

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"agent" | "codex">("agent");
  const [status, setStatus] = useState("Checking backend");

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState("");
  const [pendingAudioUrl, setPendingAudioUrl] = useState("");
  const [voiceInputMode, setVoiceInputMode] = useState<VoiceInputMode>(() =>
    loadJSON<VoiceInputMode>("cva.voiceInputMode.v1", "open"),
  );

  const [debugEntries, setDebugEntries] = useState<DebugEntry[]>([]);
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [actions, setActions] = useState<ActionEntry[]>([]);

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
  const [activeConsoleTab, setActiveConsoleTab] = useState<
    "stream" | "actions" | "handoffs" | "voice"
  >("stream");
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [visibleChatsCount, setVisibleChatsCount] = useState<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [doctorChecks, setDoctorChecks] = useState<DoctorCheck[]>([]);

  const responseAudioRef = useRef<HTMLAudioElement | null>(null);
  const consoleLoadedChatRef = useRef("");
  const consoleSaveTimerRef = useRef<number | null>(null);
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

  // Load browser SpeechSynthesis voices
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const loadVoices = () => {
      const browserVoices = window.speechSynthesis.getVoices();
      setVoices(browserVoices);
      setSelectedVoiceURI((current) => {
        if (current || browserVoices.length === 0) return current;
        const preferred =
          PREFERRED_VOICE_NAMES.map((n) =>
            browserVoices.find((v) => v.name.toLowerCase().includes(n.toLowerCase())),
          ).find(Boolean) ||
          browserVoices.find((v) => v.lang.toLowerCase().startsWith("en")) ||
          browserVoices[0];
        return preferred?.voiceURI || "";
      });
    };
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, []);

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

  useEffect(() => {
    const chatId = store.activeChatId;
    consoleLoadedChatRef.current = "";
    setActions([]);
    setHandoffs([]);
    setDebugEntries([]);
    if (!chatId) return;
    let cancelled = false;
    api
      .fetchConsoleState(chatId)
      .then((state) => {
        if (cancelled) return;
        setActions(state.actions || []);
        setHandoffs(state.handoffs || []);
        setDebugEntries(state.debugEntries || []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) consoleLoadedChatRef.current = chatId;
      });
    return () => {
      cancelled = true;
    };
  }, [store.activeChatId]);

  useEffect(() => {
    const chatId = store.activeChatId;
    if (!chatId || consoleLoadedChatRef.current !== chatId) return;
    if (consoleSaveTimerRef.current) window.clearTimeout(consoleSaveTimerRef.current);
    consoleSaveTimerRef.current = window.setTimeout(() => {
      // Console state is local operator telemetry; concurrent tabs may still
      // overwrite each other, but chat switching is guarded above.
      void api.saveConsoleState(chatId, { actions, handoffs, debugEntries }).catch(() => {});
    }, 250);
    return () => {
      if (consoleSaveTimerRef.current) window.clearTimeout(consoleSaveTimerRef.current);
    };
  }, [actions, handoffs, debugEntries, store.activeChatId]);

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

  const addDebug = useCallback((message: string) => {
    const time = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setDebugEntries((current) =>
      [{ id: crypto.randomUUID(), time, message }, ...current].slice(0, 40),
    );
  }, []);

  const addHandoff = useCallback((name: string, summary: string) => {
    setHandoffs((current) => [{ id: crypto.randomUUID(), name, summary }, ...current].slice(0, 12));
  }, []);

  const addAction = useCallback((action: Omit<ActionEntry, "id">) => {
    const id = crypto.randomUUID();
    setActions((current) => [{ id, ...action }, ...current].slice(0, 16));
    return id;
  }, []);

  const updateAction = useCallback(
    (id: string, patch: Partial<ActionEntry> | ((prev: ActionEntry) => Partial<ActionEntry>)) => {
      setActions((current) =>
        current.map((action) => {
          if (action.id === id) {
            const resolvedPatch = typeof patch === "function" ? patch(action) : patch;
            return { ...action, ...resolvedPatch };
          }
          return action;
        }),
      );
    },
    [],
  );

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

  const speak = useCallback(
    (text: string) => {
      if (!text || !("speechSynthesis" in window)) return;
      let spokenText = text.trim();
      if (spokenText.length > 500) {
        const preview = spokenText.slice(0, 500);
        const sentenceEnd = Math.max(
          preview.lastIndexOf("."),
          preview.lastIndexOf("!"),
          preview.lastIndexOf("?"),
        );
        const wordEnd = preview.lastIndexOf(" ");
        const cutAt =
          sentenceEnd > 240 ? sentenceEnd + 1 : wordEnd > 240 ? wordEnd : preview.length;
        spokenText = preview.slice(0, cutAt).trim();
      }
      const utterance = new SpeechSynthesisUtterance(spokenText);
      const v = voices.find((x) => x.voiceURI === selectedVoiceURI);
      if (v) utterance.voice = v;
      utterance.rate = 0.94;
      utterance.pitch = 1.05;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    },
    [selectedVoiceURI, voices],
  );

  const primeAudioPlayback = useCallback(() => {
    const audio = new Audio(SILENT_WAV);
    audio.volume = 0;
    audio.play().catch(() => undefined);
  }, []);

  const playResponseAudio = useCallback(async (audioUrl: string) => {
    window.speechSynthesis?.cancel();
    responseAudioRef.current?.pause();
    const audio = new Audio(audioUrl);
    responseAudioRef.current = audio;
    try {
      await audio.play();
      setPendingAudioUrl("");
    } catch {
      setPendingAudioUrl(audioUrl);
      setError("Audio is ready, but the browser blocked autoplay. Tap Play response.");
    }
  }, []);

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

  const streamCodex = useCallback(
    async (task: string, project: Project, chatId: string) => {
      const actionId = addAction({
        title: "Codex task",
        status: "running",
        detail: task,
        workdir: project.path,
      });
      const assistantId = crypto.randomUUID();
      store.appendMessage(chatId, {
        id: assistantId,
        role: "assistant",
        text: "",
        usedCodex: true,
        streaming: true,
      });

      const controller = new AbortController();
      activeAbortControllerRef.current = controller;

      let finalText = "";

      try {
        const res = await api.postCodexStream(
          {
            task,
            workdir: project.path,
            projectId: project.id,
            chatId,
          },
          controller.signal,
        );

        if (!res.ok || !res.body) {
          const payload = await res.json().catch(() => ({}));
          store.updateMessage(chatId, assistantId, (m) => ({
            ...m,
            streaming: false,
            text: m.text || "Codex request failed.",
          }));
          updateAction(actionId, {
            status: "failed",
            streamingResponse: payload.detail || "Codex request failed",
          });
          throw new Error(payload.detail || "Codex request failed");
        }

        const handle = (evt: any) => {
          if (evt.type === "codex_event" && evt.method) {
            store.updateMessage(chatId, assistantId, (m) => ({
              ...m,
              codexEvents: appendCodexEvent(m.codexEvents, evt as CodexTimelineEvent),
              codexStatus: String(evt.status || m.codexStatus || ""),
              codexTurnId: String(evt.turn_id || m.codexTurnId || ""),
              codexThreadId: String(evt.thread_id || m.codexThreadId || ""),
            }));
          } else if (evt.type === "delta" && evt.text) {
            finalText += evt.text;
            store.updateMessage(chatId, assistantId, (m) => ({ ...m, text: m.text + evt.text }));
            updateAction(actionId, (prev) => ({
              streamingResponse: (prev.streamingResponse || "") + evt.text,
            }));
          } else if (evt.type === "done") {
            finalText = String(evt.text ?? finalText);
            store.updateMessage(chatId, assistantId, (m) => ({
              ...m,
              text: finalText || m.text,
              streaming: false,
              workdir: evt.workdir,
              codexEvents: (evt.events || m.codexEvents || []) as CodexTimelineEvent[],
              codexStatus: String(evt.status || m.codexStatus || ""),
              codexTurnId: String(evt.turn_id || m.codexTurnId || ""),
              codexThreadId: String(evt.thread_id || m.codexThreadId || ""),
              artifacts: appendArtifacts(
                m.artifacts,
                evt.artifact as ChatArtifact | undefined,
                evt.change_artifact as ChatArtifact | undefined,
              ),
            }));
            updateAction(actionId, {
              status: "done",
              streamingResponse: finalText,
              workdir: evt.workdir || project.path,
            });
            addHandoff("run_codex_task", finalText.slice(0, 160));
          } else if (evt.type === "error") {
            store.updateMessage(chatId, assistantId, (m) => ({ ...m, streaming: false }));
            updateAction(actionId, {
              status: "failed",
              streamingResponse: String(evt.message || "Codex failed"),
            });
            setError(String(evt.message || "Codex failed"));
          }
        };

        await readSseStream(res, handle);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          store.updateMessage(chatId, assistantId, (m) => ({
            ...m,
            streaming: false,
            text: m.text || "Cancelled.",
          }));
          updateAction(actionId, {
            status: "failed",
            streamingResponse: "Cancelled by user.",
          });
          return;
        }
        throw err;
      } finally {
        activeAbortControllerRef.current = null;
      }

      store.updateMessage(chatId, assistantId, (m) =>
        m.streaming ? { ...m, streaming: false } : m,
      );
      if (finalText) speak(finalText);
    },
    [addAction, addHandoff, speak, store, updateAction],
  );

  const streamAgent = useCallback(
    async (message: string, project: Project, chatId: string) => {
      const assistantId = crypto.randomUUID();
      store.appendMessage(chatId, {
        id: assistantId,
        role: "assistant",
        text: "",
        streaming: true,
      });

      const controller = new AbortController();
      activeAbortControllerRef.current = controller;
      let finalText = "";
      let finalAudioUrl = "";
      let usedCodex = false;
      let activeActionId = "";

      try {
        const res = await api.postChatStream(
          {
            message,
            workdir: project.path,
            projectId: project.id,
            chatId,
          },
          controller.signal,
        );

        if (!res.ok || !res.body) {
          const payload = await res.json().catch(() => ({}));
          store.updateMessage(chatId, assistantId, (m) => ({
            ...m,
            streaming: false,
            text: m.text || "Agent request failed.",
          }));
          throw new Error(payload.detail || "Agent request failed");
        }

        await readSseStream(res, (evt) => {
          if (evt.type === "codex_event" && evt.event) {
            const event = evt.event as CodexTimelineEvent;
            store.updateMessage(chatId, assistantId, (m) => ({
              ...m,
              usedCodex: true,
              codexEvents: appendCodexEvent(m.codexEvents, event),
              codexStatus: String(event.status || m.codexStatus || ""),
              codexTurnId: String(event.turn_id || m.codexTurnId || ""),
              codexThreadId: String(event.thread_id || m.codexThreadId || ""),
            }));
            // Keep prompt detail as the original task
          } else if (evt.type === "delta" && evt.text) {
            finalText += evt.text;
            store.updateMessage(chatId, assistantId, (m) => ({ ...m, text: m.text + evt.text }));
          } else if (evt.type === "tool_call") {
            usedCodex = true;
            activeActionId = addAction({
              title: "Agent handoff to Codex",
              status: "running",
              detail: String(evt.task || "Local task"),
              streamingResponse: "",
              workdir: String(evt.workdir || project.path),
            });
            store.updateMessage(chatId, assistantId, (m) => ({ ...m, usedCodex: true }));
          } else if (evt.type === "tool_progress" && evt.text) {
            if (activeActionId) {
              updateAction(activeActionId, (prev) => ({
                streamingResponse: (prev.streamingResponse || "") + evt.text,
              }));
            }
          } else if (evt.type === "status") {
            // Keep prompt detail unchanged
          } else if (evt.type === "tool_result") {
            usedCodex = true;
            const summary = String(evt.result || "").slice(0, 180);
            addHandoff(String(evt.name || "run_codex_task"), summary);
            store.updateMessage(chatId, assistantId, (m) => ({
              ...m,
              usedCodex: true,
              codexEvents: (evt.codex_events || m.codexEvents || []) as CodexTimelineEvent[],
              codexStatus: String(evt.codex_status || m.codexStatus || ""),
              codexTurnId: String(evt.codex_turn_id || m.codexTurnId || ""),
              codexThreadId: String(evt.codex_thread_id || m.codexThreadId || ""),
              artifacts: appendArtifacts(
                m.artifacts,
                evt.artifact as ChatArtifact | undefined,
                evt.change_artifact as ChatArtifact | undefined,
              ),
            }));
            if (activeActionId) {
              updateAction(activeActionId, {
                status: "done",
                workdir: String(evt.workdir || project.path),
              });
            }
          } else if (evt.type === "done") {
            finalText = String(evt.text ?? finalText);
            finalAudioUrl = String(evt.audio_data_url || "");
            usedCodex = usedCodex || (Array.isArray(evt.tool_calls) && evt.tool_calls.length > 0);
            store.updateMessage(chatId, assistantId, (m) => ({
              ...m,
              text: finalText || m.text || "Done.",
              streaming: false,
              usedCodex,
              workdir: evt.workdir || project.path,
              codexEvents: (evt.codex_events || m.codexEvents || []) as CodexTimelineEvent[],
              codexStatus: String(evt.codex_status || m.codexStatus || ""),
              codexTurnId: String(evt.codex_turn_id || m.codexTurnId || ""),
              codexThreadId: String(evt.codex_thread_id || m.codexThreadId || ""),
            }));
          } else if (evt.type === "error") {
            store.updateMessage(chatId, assistantId, (m) => ({
              ...m,
              streaming: false,
              text: m.text || "Agent failed.",
            }));
            if (activeActionId) {
              updateAction(activeActionId, {
                status: "failed",
                streamingResponse: String(evt.message || "Agent failed"),
              });
            }
            setError(String(evt.message || "Agent failed"));
          }
        });

        store.updateMessage(chatId, assistantId, (m) =>
          m.streaming ? { ...m, streaming: false } : m,
        );
        if (finalAudioUrl) await playResponseAudio(finalAudioUrl);
        else if (finalText) speak(finalText);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          store.updateMessage(chatId, assistantId, (m) => ({
            ...m,
            streaming: false,
            text: m.text || "Cancelled.",
          }));
          if (activeActionId) {
            updateAction(activeActionId, {
              status: "failed",
              streamingResponse: "Cancelled by user.",
            });
          }
          return;
        }
        throw err;
      } finally {
        activeAbortControllerRef.current = null;
      }
    },
    [addAction, addHandoff, playResponseAudio, speak, store, updateAction],
  );

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
    setHandoffs([]);
    setActions([]);
    setDebugEntries([]);
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
          <div className="w-14 shrink-0 flex flex-col justify-between items-center border-r border-line bg-surface-1 py-3">
            <div className="flex flex-col gap-1 w-full px-2">
              <button
                title="Chats"
                className="group relative flex h-11 w-full flex-col items-center justify-center gap-0.5 rounded-md bg-surface-2 text-accent"
              >
                <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-accent" />
                <SquareTerminal className="h-4.5 w-4.5" />
                <span className="font-mono text-[9px] uppercase tracking-wider scale-90">
                  Chats
                </span>
              </button>
              <button
                title="Files coming soon"
                disabled
                className="group flex h-11 w-full cursor-not-allowed flex-col items-center justify-center gap-0.5 rounded-md text-fg-dim opacity-35"
              >
                <FileCode2 className="h-4.5 w-4.5" />
                <span className="font-mono text-[9px] uppercase tracking-wider scale-90">
                  Files
                </span>
              </button>
              <button
                title="Runs coming soon"
                disabled
                className="group flex h-11 w-full cursor-not-allowed flex-col items-center justify-center gap-0.5 rounded-md text-fg-dim opacity-35"
              >
                <Activity className="h-4.5 w-4.5" />
                <span className="font-mono text-[9px] uppercase tracking-wider scale-90">Runs</span>
              </button>
              <button
                title="MCP toolkits coming soon"
                disabled
                className="group flex h-11 w-full cursor-not-allowed flex-col items-center justify-center gap-0.5 rounded-md text-fg-dim opacity-35"
              >
                <Cable className="h-4.5 w-4.5" />
                <span className="font-mono text-[9px] uppercase tracking-wider scale-90">MCP</span>
              </button>
            </div>

            <div className="flex flex-col items-center gap-2.5 w-full px-2">
              <button
                title="New project"
                onClick={() => setShowAdd(true)}
                className="grid h-9 w-9 place-items-center rounded-md text-fg-dim hover:bg-surface-2 hover:text-accent border border-dashed border-line"
              >
                <Plus className="h-4.5 w-4.5" />
              </button>
              <button
                title={store.theme === "dark" ? "Switch to light" : "Switch to dark"}
                onClick={() => store.setTheme(store.theme === "dark" ? "light" : "dark")}
                className="grid h-9 w-9 place-items-center rounded-md text-fg-dim hover:bg-surface-2 hover:text-fg"
              >
                {store.theme === "dark" ? (
                  <Sun className="h-4.5 w-4.5" />
                ) : (
                  <Moon className="h-4.5 w-4.5" />
                )}
              </button>
              <button
                title="Console Settings"
                onClick={() => {
                  setPanelOpen(true);
                  setActiveConsoleTab("voice");
                }}
                className="grid h-9 w-9 place-items-center rounded-md text-fg-dim hover:bg-surface-2 hover:text-fg"
              >
                <Settings className="h-4.5 w-4.5" />
              </button>
              <span className="h-px w-6 bg-line-soft" />
            </div>
          </div>
        )}

        {/* Column 2: ExplorerPanel (Resizable Sidebar) */}
        {(!isMobile ? railOpen : mobileView === "explorer") && (
          <aside
            style={isMobile ? { width: "100%" } : { width: `${railWidth}px` }}
            className={cn(
              "flex h-full min-h-0 flex-col bg-surface-1 shrink-0",
              !isMobile ? "border-r border-line" : "w-full",
            )}
          >
            <div className="flex items-center justify-between border-b border-line-soft px-3 py-2.5 shrink-0">
              <span className="label">Workspace</span>
              <button
                title="Add Project"
                onClick={() => setShowAdd(true)}
                className="grid h-6 w-6 place-items-center rounded text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto py-1" aria-label="Workspace chats">
              {store.projects.length === 0 ? (
                <div className="p-4 text-center">
                  <p className="text-[12.5px] text-fg-dim">No projects yet.</p>
                  <button
                    onClick={() => setShowAdd(true)}
                    className="mt-2 text-[12px] text-accent hover:underline flex items-center gap-1 mx-auto"
                  >
                    <Plus className="h-3 w-3" /> Add folder
                  </button>
                </div>
              ) : (
                store.projects.map((p) => {
                  const isActive = p.id === store.activeId;
                  const isExpanded =
                    expandedProjects[p.id] !== undefined ? expandedProjects[p.id] : isActive;
                  const pChats = store.chats[p.id] || [];
                  const activeChatId = store.activeChatByProject[p.id] || "";

                  const getChatLimit = (
                    projectId: string,
                    chatsList: typeof pChats,
                    activeId: string,
                  ) => {
                    const userLimit = visibleChatsCount[projectId] || 5;
                    if (!activeId) return userLimit;
                    const activeIdx = chatsList.findIndex((c) => c.id === activeId);
                    if (activeIdx === -1) return userLimit;
                    if (activeIdx >= userLimit) {
                      return Math.ceil((activeIdx + 1) / 5) * 5;
                    }
                    return userLimit;
                  };

                  const chatLimit = getChatLimit(p.id, pChats, activeChatId);
                  const visibleChats = pChats.slice(0, chatLimit);

                  return (
                    <div key={p.id} className="px-1">
                      <div
                        className={cn(
                          "group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors",
                          isActive
                            ? "bg-surface-2 text-fg"
                            : "text-fg-muted hover:bg-surface-2/60 hover:text-fg",
                        )}
                      >
                        <button
                          onClick={() => {
                            setExpandedProjects((prev) => ({
                              ...prev,
                              [p.id]: !isExpanded,
                            }));
                          }}
                          className="flex items-center gap-1.5 flex-1 min-w-0"
                        >
                          <ChevronRight
                            className={cn(
                              "h-3.5 w-3.5 text-fg-dim transition-transform shrink-0",
                              isExpanded && "rotate-90",
                            )}
                          />
                          <span
                            className="h-2 w-2 rounded-sm shrink-0"
                            style={{ background: p.color }}
                          />
                          <span className="truncate text-[13px] font-medium">{p.name}</span>
                        </button>

                        <button
                          title="New chat"
                          onClick={(e) => {
                            e.stopPropagation();
                            store.createChat(p.id);
                            setExpandedProjects((prev) => ({
                              ...prev,
                              [p.id]: true,
                            }));
                            if (isMobile) {
                              setMobileView("chat");
                            }
                          }}
                          className={cn(
                            "p-0.5 rounded hover:bg-surface-3 hover:text-accent text-fg-dim transition-all shrink-0",
                            isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                          )}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>

                        <button
                          title="Remove Project"
                          onClick={() => handleRemoveProject(p.id, p.name)}
                          className={cn(
                            "p-0.5 rounded hover:bg-surface-3 hover:text-danger text-fg-dim transition-all shrink-0",
                            isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                          )}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="ml-5 mt-0.5 mb-1 border-l border-line-soft pl-2">
                          {visibleChats.map((c) => {
                            const isChatActive = c.id === activeChatId;
                            return (
                              <div
                                key={c.id}
                                className={cn(
                                  "group flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12.5px] transition-colors",
                                  isChatActive
                                    ? "bg-accent/10 text-fg"
                                    : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                                )}
                              >
                                <button
                                  data-chat-switcher
                                  aria-current={isChatActive ? "page" : undefined}
                                  onClick={() => {
                                    store.selectChat(p.id, c.id);
                                    if (isMobile) {
                                      setMobileView("chat");
                                    }
                                  }}
                                  onKeyDown={handleChatSwitcherKeyDown}
                                  className="flex items-center gap-1.5 flex-1 min-w-0"
                                  title={c.title}
                                >
                                  <span className="truncate">{c.title}</span>
                                </button>

                                <button
                                  title="Rename chat"
                                  onClick={() => handleRenameChat(p.id, c.id, c.title)}
                                  className={cn(
                                    "p-0.5 rounded hover:bg-surface-3 hover:text-fg text-fg-dim transition-all shrink-0",
                                    isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                                  )}
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button
                                  title="Delete chat"
                                  onClick={() => handleRemoveChat(p.id, c.id)}
                                  className={cn(
                                    "p-0.5 rounded hover:bg-surface-3 hover:text-danger text-fg-dim transition-all shrink-0",
                                    isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                                  )}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            );
                          })}
                          {pChats.length > chatLimit && (
                            <button
                              onClick={() => {
                                setVisibleChatsCount((prev) => ({
                                  ...prev,
                                  [p.id]: (prev[p.id] || 5) + 5,
                                }));
                              }}
                              className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-fg-dim hover:bg-surface-2 hover:text-accent font-medium border border-dashed border-line-soft/60"
                              title="Show more chats"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </nav>

            {isMobile && (
              <div className="border-t border-line bg-surface-2 p-3 flex items-center justify-between gap-3 shrink-0">
                <button
                  onClick={() => store.setTheme(store.theme === "dark" ? "light" : "dark")}
                  className="flex items-center gap-2 rounded-md border border-line bg-surface-1 px-3 py-1.5 text-xs text-fg-muted hover:text-fg hover:bg-surface-3 flex-1 justify-center"
                >
                  {store.theme === "dark" ? (
                    <Sun className="h-4 w-4" />
                  ) : (
                    <Moon className="h-4 w-4" />
                  )}
                  <span>{store.theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
                </button>

                <button
                  onClick={() => {
                    setMobileView("console");
                    setActiveConsoleTab("voice");
                  }}
                  className="flex items-center gap-2 rounded-md border border-line bg-surface-1 px-3 py-1.5 text-xs text-fg-muted hover:text-fg hover:bg-surface-3 flex-1 justify-center"
                >
                  <Settings className="h-4 w-4" />
                  <span>Voice Settings</span>
                </button>
              </div>
            )}
          </aside>
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
            {/* Messages Stream */}
            <section
              aria-busy={busy || store.messages.some((message) => message.streaming)}
              aria-label="Chat conversation"
              className={cn(
                "flex-1 overflow-y-auto scroll-smooth",
                isMobile ? "px-3 py-4" : "px-5 py-6",
              )}
            >
              <div className="mx-auto flex max-w-[760px] flex-col gap-6">
                {!store.activeProject ? (
                  <div className="text-center py-20 px-4 max-w-md mx-auto">
                    <div className="w-12 h-12 rounded-xl bg-accent/15 text-accent flex items-center justify-center mx-auto mb-4 border border-accent/25">
                      <FolderPlus className="h-6 w-6" />
                    </div>
                    <h3 className="text-base font-semibold">Connect a Project</h3>
                    <p className="text-[13px] text-fg-muted mt-1.5 leading-relaxed">
                      A project links the agent to a folder on your system. It can read files, write
                      code, run commands, and execute tests directly in place.
                    </p>
                    <button
                      onClick={() => setShowAdd(true)}
                      className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground hover:brightness-110 transition-all glow-accent"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add project
                    </button>
                  </div>
                ) : store.messages.length === 0 ? (
                  <div className="py-12 px-4 text-center max-w-xl mx-auto">
                    <div className="w-10 h-10 rounded-lg bg-surface-2 border border-line flex items-center justify-center mx-auto mb-4 text-fg-muted">
                      <SquareTerminal className="h-5 w-5" />
                    </div>
                    <h3 className="text-sm font-semibold tracking-tight">
                      {store.activeProject.name}
                    </h3>
                    <p className="text-[12.5px] font-mono text-accent mt-1 truncate max-w-md mx-auto">
                      {store.activeProject.path}
                    </p>
                    <p className="text-[13px] text-fg-muted mt-2">
                      Enter a prompt below or start a live voice session.
                    </p>

                    <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left max-w-lg mx-auto">
                      {suggestions.map((s) => (
                        <button
                          key={s}
                          onClick={() => void send(s)}
                          className="flex items-center gap-2 p-3 text-[12.5px] rounded-lg border border-line bg-surface-1 hover:bg-surface-2 transition-all group"
                        >
                          <Zap className="h-3.5 w-3.5 text-accent shrink-0 group-hover:scale-110 transition-transform" />
                          <span className="truncate text-fg-muted group-hover:text-fg">{s}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  store.messages.map((m) => {
                    const isUser = m.role === "user";
                    if (isUser) {
                      return (
                        <article
                          key={m.id}
                          className="flex w-full justify-end animate-in fade-in duration-200"
                        >
                          <div
                            className={cn(
                              "rounded-xl px-4 py-3 text-[13.5px] leading-relaxed shadow-sm bg-surface-2 border border-line text-fg",
                              isMobile ? "max-w-[90%]" : "max-w-[80%]",
                            )}
                          >
                            {m.text ? <MarkdownRenderer content={m.text} /> : null}
                          </div>
                        </article>
                      );
                    } else {
                      const diffs = changeArtifacts(m.artifacts);
                      return (
                        <article
                          key={m.id}
                          className="flex w-full justify-start animate-in fade-in duration-200"
                        >
                          <div
                            className={cn(
                              "flex-1 text-[13.5px] leading-relaxed text-fg/95 px-1 py-1",
                              isMobile ? "max-w-[98%]" : "max-w-[90%]",
                            )}
                          >
                            {m.text ? (
                              <MarkdownRenderer content={m.text} />
                            ) : (
                              m.streaming && (
                                <div className="flex flex-col gap-1.5 py-1">
                                  <span className="h-2 bg-fg-dim/15 rounded w-full animate-pulse" />
                                  <span className="h-2 bg-fg-dim/15 rounded w-4/5 animate-pulse" />
                                  <span className="h-2 bg-fg-dim/15 rounded w-3/5 animate-pulse" />
                                </div>
                              )
                            )}
                            {m.streaming && m.text && <span className="caret animate-pulse" />}
                            {diffs.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {diffs.map((artifact) => (
                                  <ChangeReviewChip
                                    key={artifact.id}
                                    artifact={artifact}
                                    onCommit={confirmCommitChangeReview}
                                    onRevert={confirmRevertChangeReview}
                                  />
                                ))}
                              </div>
                            )}
                            {m.artifacts && m.artifacts.length > 0 && (
                              <div className="mt-3 flex flex-col gap-2">
                                {m.artifacts.map((artifact) => (
                                  <ArtifactCard
                                    key={artifact.id}
                                    artifact={artifact}
                                    defaultOpen={artifact.content_type === "diff"}
                                  />
                                ))}
                              </div>
                            )}
                            {(m.usedCodex || (m.codexEvents && m.codexEvents.length > 0)) && (
                              <CodexTimeline events={m.codexEvents} status={m.codexStatus} />
                            )}
                          </div>
                        </article>
                      );
                    }
                  })
                )}

                {busy && mode === "agent" && !store.messages.some((m) => m.streaming) && (
                  <article className="flex justify-start w-full">
                    <div
                      className={cn("flex-1 px-1 py-1", isMobile ? "max-w-[98%]" : "max-w-[90%]")}
                    >
                      <div className="flex flex-col gap-1.5 py-1">
                        <span className="h-2 bg-fg-dim/15 rounded w-full animate-pulse" />
                        <span className="h-2 bg-fg-dim/15 rounded w-5/6 animate-pulse" />
                        <span className="h-2 bg-fg-dim/15 rounded w-2/3 animate-pulse" />
                      </div>
                    </div>
                  </article>
                )}

                <div ref={messageEndRef} />
              </div>
            </section>

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
            {/* Console Header */}
            <div className="flex items-center justify-between border-b border-line-soft px-3 py-2.5 shrink-0">
              <div className="flex items-center gap-2">
                <SquareTerminal className="h-3.5 w-3.5 text-accent" />
                <span className="text-[12.5px] font-semibold tracking-tight">Console</span>
              </div>

              <div className="flex items-center gap-2">
                {!isMobile ? (
                  <button
                    title="Hide console panel"
                    onClick={() => setPanelOpen(false)}
                    className="grid h-6 w-6 place-items-center rounded text-fg-muted hover:bg-surface-2 hover:text-fg"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    title="Go back to chat"
                    onClick={() => setMobileView("chat")}
                    className="grid h-6 w-6 place-items-center rounded text-fg-muted hover:bg-surface-2 hover:text-fg"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}

                <button
                  onClick={clearThread}
                  disabled={!store.activeChatId}
                  className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border border-line bg-surface-2 text-fg-dim hover:text-fg hover:border-fg-muted disabled:opacity-40"
                >
                  Clear
                </button>

                <span className="flex items-center gap-1.5 font-mono text-[10px] text-fg-dim">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full pulse-dot",
                      status === "Ready" ? "bg-success" : "bg-danger",
                    )}
                  />
                  {status === "Ready" ? "online" : "offline"}
                </span>
              </div>
            </div>

            {/* Console Tabs */}
            <div
              className="flex items-center gap-0.5 border-b border-line-soft px-2 pt-1.5 shrink-0 overflow-x-auto"
              role="tablist"
              aria-label="Console views"
            >
              {(
                [
                  { id: "stream", label: "Stream", icon: Activity },
                  { id: "actions", label: "Actions", icon: Zap },
                  { id: "handoffs", label: "Handoffs", icon: Cable },
                  { id: "voice", label: "Voice", icon: Waves },
                ] as const
              ).map((t) => {
                const active = activeConsoleTab === t.id;
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    id={`console-tab-${t.id}`}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls={`console-panel-${t.id}`}
                    onClick={() => setActiveConsoleTab(t.id)}
                    className={cn(
                      "relative flex items-center gap-1.5 px-2.5 py-2 text-[11.5px] transition-colors shrink-0",
                      active ? "text-fg" : "text-fg-dim hover:text-fg",
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {t.label}
                    {active && (
                      <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-t bg-accent" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Console Contents */}
            <div className="flex-1 overflow-y-auto p-3">
              {activeConsoleTab === "stream" && (
                <div
                  id="console-panel-stream"
                  role="tabpanel"
                  aria-labelledby="console-tab-stream"
                  className="font-mono text-[11px] leading-relaxed"
                >
                  {debugEntries.length === 0 ? (
                    <div className="text-center py-12 text-fg-dim italic">Waiting for events…</div>
                  ) : (
                    debugEntries.map((l) => (
                      <div
                        key={l.id}
                        className="grid grid-cols-[82px_1fr] items-baseline gap-2 py-0.5 border-b border-line-soft/30"
                      >
                        <span className="text-fg-dim shrink-0">{l.time}</span>
                        <span className="text-fg/85 break-all whitespace-pre-wrap">
                          {l.message}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeConsoleTab === "actions" && (
                <div
                  id="console-panel-actions"
                  role="tabpanel"
                  aria-labelledby="console-tab-actions"
                  className="space-y-2"
                >
                  {actions.length === 0 ? (
                    <div className="text-center py-12 text-fg-dim italic">
                      No operator actions logged.
                    </div>
                  ) : (
                    actions.map((a) => {
                      const hasResponse =
                        a.streamingResponse != null && a.streamingResponse.length > 0;
                      return (
                        <div
                          key={a.id}
                          className="panel p-0 text-xs bg-surface-2 border border-line overflow-hidden"
                        >
                          {/* Header */}
                          <div className="flex items-center justify-between px-3 py-2 border-b border-line-soft/40">
                            <span className="font-mono text-[11px] text-accent font-semibold">
                              {a.title}
                            </span>
                            <span
                              className={cn(
                                "px-1.5 py-0.5 rounded font-mono text-[9px] font-bold uppercase",
                                a.status === "running"
                                  ? "bg-accent/10 text-accent animate-pulse"
                                  : a.status === "done"
                                    ? "bg-success/15 text-success"
                                    : "bg-danger/15 text-danger",
                              )}
                            >
                              {a.status}
                            </span>
                          </div>
                          {/* Chat timeline inside the action card */}
                          <div className="action-chat-timeline">
                            {/* Prompt/Request — right-aligned like a user message */}
                            <div className="action-chat-row justify-end">
                              <div className="action-chat-bubble-user">{a.detail}</div>
                            </div>

                            {/* Response — left-aligned like an assistant message */}
                            {hasResponse ? (
                              <div className="action-chat-row justify-start">
                                <div
                                  className={cn(
                                    "action-chat-response-text",
                                    a.status === "failed" && "text-danger",
                                  )}
                                >
                                  <MarkdownRenderer content={a.streamingResponse || ""} />
                                  {a.status === "running" && <span className="caret" />}
                                </div>
                              </div>
                            ) : a.status === "running" ? (
                              <div className="action-chat-row justify-start">
                                <div className="action-chat-response-text">
                                  <div className="flex flex-col gap-1.5 py-1 w-full">
                                    <span className="h-1.5 bg-fg-dim/15 rounded w-full animate-pulse" />
                                    <span className="h-1.5 bg-fg-dim/15 rounded w-4/5 animate-pulse" />
                                    <span className="h-1.5 bg-fg-dim/15 rounded w-3/5 animate-pulse" />
                                  </div>
                                </div>
                              </div>
                            ) : a.status === "failed" ? (
                              <div className="action-chat-row justify-start">
                                <div className="action-chat-response-text text-danger font-medium">
                                  Failed to execute operator action.
                                </div>
                              </div>
                            ) : null}
                          </div>
                          {a.workdir && (
                            <div className="px-3 py-1.5 text-[9px] text-fg-dim font-mono border-t border-line-soft/40 flex items-center gap-1">
                              <Folder className="h-2.5 w-2.5" />
                              <span className="truncate">{a.workdir}</span>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {activeConsoleTab === "handoffs" && (
                <div
                  id="console-panel-handoffs"
                  role="tabpanel"
                  aria-labelledby="console-tab-handoffs"
                  className="space-y-2"
                >
                  {handoffs.length === 0 ? (
                    <div className="text-center py-12 text-fg-dim italic">
                      No handoffs between Agent and Codex.
                    </div>
                  ) : (
                    handoffs.map((d, i) => (
                      <div
                        key={d.id}
                        className="panel p-2.5 text-xs bg-surface-2 border border-line"
                      >
                        <div className="flex items-center gap-2 font-mono text-[10.5px]">
                          <span className="text-fg-muted">agent</span>
                          <ChevronRight className="h-3 w-3 text-accent" />
                          <span className="text-accent">codex</span>
                          <span className="ml-auto text-fg-dim font-semibold">
                            #{handoffs.length - i}
                          </span>
                        </div>
                        <p className="mt-1.5 text-[11.5px] text-fg-muted leading-relaxed whitespace-pre-wrap">
                          {d.summary}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeConsoleTab === "voice" && (
                <div
                  id="console-panel-voice"
                  role="tabpanel"
                  aria-labelledby="console-tab-voice"
                  className="space-y-4 text-xs"
                >
                  <div className="panel p-3 bg-surface-2 border border-line">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="label font-semibold">Setup doctor</span>
                      <button
                        onClick={refreshDoctor}
                        className="rounded border border-line bg-surface-3 px-2 py-1 font-mono text-[10px] uppercase text-fg-dim hover:text-fg"
                      >
                        Refresh
                      </button>
                    </div>
                    <div className="space-y-2">
                      {doctorChecks.length === 0 ? (
                        <p className="text-[11.5px] text-fg-dim">No setup report available.</p>
                      ) : (
                        doctorChecks.map((check) => (
                          <div
                            key={check.name}
                            className="rounded border border-line-soft bg-surface-1 px-2.5 py-2"
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "h-2 w-2 rounded-full",
                                  check.ok ? "bg-success" : "bg-danger",
                                )}
                              />
                              <span className="font-semibold text-fg">{check.name}</span>
                              <span className="ml-auto text-[10px] font-mono uppercase text-fg-dim">
                                {check.ok ? "ready" : "needs setup"}
                              </span>
                            </div>
                            <p className="mt-1 text-[11.5px] text-fg-muted">{check.message}</p>
                            {!check.ok && check.fix && (
                              <p className="mt-1 text-[11px] text-accent">{check.fix}</p>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="panel p-3 bg-surface-2 border border-line">
                    <label className="label mb-2 block font-semibold">Microphone mode</label>
                    <div className="grid grid-cols-2 gap-1 rounded-md border border-line bg-surface-1 p-1">
                      {VOICE_INPUT_MODES.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => {
                            setVoiceInputMode(option.id);
                            if (voiceActive) {
                              liveVoice.setMuted(option.id === "push");
                            }
                          }}
                          className={cn(
                            "rounded px-2 py-1.5 text-[11.5px] font-semibold transition-colors",
                            voiceInputMode === option.id
                              ? "bg-surface-3 text-fg shadow-sm"
                              : "text-fg-dim hover:text-fg",
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="panel p-3 bg-surface-2 border border-line">
                    <label className="label mb-2 block font-semibold">Fallback TTS Voice</label>
                    <select
                      className="w-full rounded-md border border-line bg-surface-3 px-2 py-1.5 text-[12.5px] focus:border-accent focus:outline-none text-fg"
                      value={selectedVoiceURI}
                      onChange={(e) => setSelectedVoiceURI(e.target.value)}
                      disabled={voices.length === 0}
                    >
                      {voices.length === 0 && <option value="">Browser default</option>}
                      {voices.map((v) => (
                        <option value={v.voiceURI} key={v.voiceURI}>
                          {v.name} ({v.lang})
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-[10.5px] text-fg-dim leading-relaxed">
                      Used if Gemini Gateway doesn't return direct audio chunks, synthesized on this
                      browser.
                    </p>
                  </div>

                  {pendingAudioUrl && (
                    <div className="panel p-3 bg-danger/5 border border-danger/20 rounded-md">
                      <p className="text-danger font-semibold text-[11px] mb-2">
                        Browser autoplay was blocked.
                      </p>
                      <button
                        onClick={() => void playResponseAudio(pendingAudioUrl)}
                        className="w-full bg-danger text-white rounded py-1 px-3 hover:brightness-110 font-semibold text-[11.5px]"
                      >
                        Play Response Audio
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Stats Footer bar */}
            <div className="grid grid-cols-3 border-t border-line-soft shrink-0 bg-surface-1/40">
              <div className="px-3 py-1.5">
                <div className="label text-[9px]">conversation size</div>
                <div className="mt-0.5 flex items-baseline gap-0.5">
                  <span className="font-mono text-[13px] font-semibold text-fg tabular-nums">
                    {store.messages.length}
                  </span>
                  <span className="font-mono text-[9px] text-fg-dim">turns</span>
                </div>
              </div>
              <div className="px-3 py-1.5 border-l border-line-soft">
                <div className="label text-[9px]">estimated context</div>
                <div className="mt-0.5 flex items-baseline gap-0.5">
                  <span className="font-mono text-[13px] font-semibold text-fg tabular-nums">
                    {Math.round(
                      store.messages.reduce((acc, m) => acc + (m.text?.length || 0), 0) / 4.2,
                    ).toLocaleString()}
                  </span>
                  <span className="font-mono text-[9px] text-fg-dim">≈ tokens</span>
                </div>
              </div>
              <div className="px-3 py-1.5 border-l border-line-soft">
                <div className="label text-[9px]">codex usage</div>
                <div className="mt-0.5 flex items-baseline gap-0.5">
                  <span className="font-mono text-[13px] font-semibold text-fg tabular-nums">
                    {codexTokenTotal(store.messages).toLocaleString()}
                  </span>
                  <span className="font-mono text-[9px] text-fg-dim">tokens</span>
                </div>
              </div>
            </div>
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
