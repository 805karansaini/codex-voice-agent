import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowUp,
  Cable,
  ChevronRight,
  Circle,
  FileCode2,
  Folder,
  FolderPlus,
  GitBranch,
  Mic,
  MicOff,
  Moon,
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
} from "lucide-react";

import { useProjectStore } from "./hooks/useProjectStore";
import { useLiveVoice } from "./hooks/useLiveVoice";
import * as api from "./services/api";
import { Project, ActionEntry, Handoff, DebugEntry, PendingAction, ProjectInfo } from "./types";
import { loadJSON, saveJSON, chatTitleFrom, cn } from "./utils";

import AddProjectModal from "./components/modals/AddProjectModal";
import ActionPreviewModal from "./components/modals/ActionPreviewModal";
import MarkdownRenderer from "./components/common/MarkdownRenderer";

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

function riskyActionReason(text: string): string {
  const lower = text.toLowerCase();
  if (
    /\b(git\s+pull|git\s+push|git\s+merge|git\s+rebase|git\s+reset|git\s+checkout|commit|delete|remove|rm\s+-|install|npm\s+i|npm\s+install|pip\s+install|uv\s+add|write|edit|modify)\b/.test(
      lower
    ) ||
    /\b(pull|push|merge|rebase|reset|checkout)\b.*\bgit\b/.test(lower) ||
    /\bgit\b.*\b(pull|push|merge|rebase|reset|checkout)\b/.test(lower)
  ) {
    return "This may change files, dependencies, or git state in the selected folder.";
  }
  return "";
}

async function readSseStream(res: Response, onEvent: (evt: any) => void) {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()));
      } catch {}
    }
  }
}

export function App() {
  const store = useProjectStore();

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"agent" | "codex">("agent");
  const [status, setStatus] = useState("Checking backend");
  const [model, setModel] = useState("Gemini Live");
  
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState("");
  const [pendingAudioUrl, setPendingAudioUrl] = useState("");
  
  const [debugEntries, setDebugEntries] = useState<DebugEntry[]>([]);
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [actions, setActions] = useState<ActionEntry[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  
  const [showAdd, setShowAdd] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  
  const [railWidth, setRailWidth] = useState(() => loadJSON<number>("cva.railWidth.v2", 268));
  const [panelWidth, setPanelWidth] = useState(() => loadJSON<number>("cva.panelWidth.v2", 380));
  const [isDragging, setIsDragging] = useState(false);
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);
  const [activeConsoleTab, setActiveConsoleTab] = useState<"stream" | "actions" | "handoffs" | "voice">("stream");

  const responseAudioRef = useRef<HTMLAudioElement | null>(null);
  const consoleLoadedChatRef = useRef("");
  const consoleSaveTimerRef = useRef<number | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

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
        const preferred = PREFERRED_VOICE_NAMES.map((n) =>
          browserVoices.find((v) => v.name.toLowerCase().includes(n.toLowerCase()))
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
    api.fetchHealth()
      .then((data) => {
        setStatus(data.has_google_api_key ? "Ready" : "Missing Google API key");
        setModel(data.gemini_model || "Gemini Live");
      })
      .catch(() => setStatus("Backend offline"));
  }, []);

  useEffect(() => {
    const chatId = store.activeChatId;
    consoleLoadedChatRef.current = "";
    setActions([]);
    setHandoffs([]);
    setDebugEntries([]);
    if (!chatId) return;
    let cancelled = false;
    api.fetchConsoleState(chatId)
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
    api.getProjectInfo(store.activeProject.path)
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
    return () => { cancelled = true; };
  }, [store.activeProject]);

  const addDebug = useCallback((message: string) => {
    const time = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setDebugEntries((current) => [{ id: crypto.randomUUID(), time, message }, ...current].slice(0, 40));
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
    (
      id: string,
      patch: Partial<ActionEntry> | ((prev: ActionEntry) => Partial<ActionEntry>)
    ) => {
      setActions((current) =>
        current.map((action) => {
          if (action.id === id) {
            const resolvedPatch = typeof patch === "function" ? patch(action) : patch;
            return { ...action, ...resolvedPatch };
          }
          return action;
        })
      );
    },
    []
  );

  const speak = useCallback(
    (text: string) => {
      if (!text || !("speechSynthesis" in window)) return;
      const utterance = new SpeechSynthesisUtterance(text.slice(0, 500));
      const v = voices.find((x) => x.voiceURI === selectedVoiceURI);
      if (v) utterance.voice = v;
      utterance.rate = 0.94;
      utterance.pitch = 1.05;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    },
    [selectedVoiceURI, voices]
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
  const getWorkdir = useCallback(() => voiceCtxRef.current?.project.path ?? store.activeProject?.path, [
    store.activeProject,
  ]);
  const getProjectId = useCallback(() => voiceCtxRef.current?.project.id ?? store.activeProject?.id, [
    store.activeProject,
  ]);
  const getChatId = useCallback(() => voiceCtxRef.current?.chatId ?? store.activeChatId, [
    store.activeChatId,
  ]);

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
    onTurnComplete: (userText, assistantText, usedCodex, workdir) => {
      const ctx = voiceCtxRef.current;
      if (!ctx) return;
      if (activeUserVoiceMsgIdRef.current) {
        store.updateMessage(ctx.chatId, activeUserVoiceMsgIdRef.current, (m) => ({
          ...m,
          text: userText || m.text,
        }));
      } else {
        store.appendMessage(ctx.chatId, {
          id: crypto.randomUUID(),
          role: "user",
          text: userText,
          workdir: ctx.project.path,
        });
      }
      if (activeAssistantVoiceMsgIdRef.current) {
        store.updateMessage(ctx.chatId, activeAssistantVoiceMsgIdRef.current, (m) => ({
          ...m,
          text: assistantText || m.text,
          streaming: false,
          usedCodex,
          workdir,
        }));
      } else {
        store.appendMessage(ctx.chatId, {
          id: crypto.randomUUID(),
          role: "assistant",
          text: assistantText,
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
        workdir: workdir || voiceCtxRef.current?.project.path,
      });
      activeVoiceActionIdRef.current = id;
    },
    onHandoffProgress: (name, text) => {
      if (activeVoiceActionIdRef.current) {
        updateAction(activeVoiceActionIdRef.current, (prev) => ({
          detail: prev.detail + text,
        }));
      }
    },
    onHandoffFailed: (name, message) => {
      if (activeVoiceActionIdRef.current) {
        updateAction(activeVoiceActionIdRef.current, {
          status: "failed",
          detail: message,
        });
        activeVoiceActionIdRef.current = null;
      }
    },
    onHandoff: (name, summary, workdir) => {
      addHandoff(name, summary);
      if (activeVoiceActionIdRef.current) {
        updateAction(activeVoiceActionIdRef.current, {
          status: "done",
          detail: summary,
          workdir: workdir || voiceCtxRef.current?.project.path,
        });
        activeVoiceActionIdRef.current = null;
      } else {
        addAction({
          title: "Voice handoff to Codex",
          status: "done",
          detail: summary,
          workdir: workdir || voiceCtxRef.current?.project.path,
        });
      }
    },
  });
  const voiceActive = liveVoice.active;

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
      let cancelled = false;

      try {
        const res = await api.postCodexStream({
          task,
          workdir: project.path,
          projectId: project.id,
          chatId,
        }, controller.signal);

        if (!res.ok || !res.body) {
          const payload = await res.json().catch(() => ({}));
          store.updateMessage(chatId, assistantId, (m) => ({
            ...m,
            streaming: false,
            text: m.text || "Codex request failed.",
          }));
          updateAction(actionId, {
            status: "failed",
            detail: payload.detail || "Codex request failed",
          });
          throw new Error(payload.detail || "Codex request failed");
        }

        const handle = (evt: any) => {
          if (evt.type === "delta" && evt.text) {
            finalText += evt.text;
            store.updateMessage(chatId, assistantId, (m) => ({ ...m, text: m.text + evt.text }));
          } else if (evt.type === "done") {
            finalText = String(evt.text ?? finalText);
            store.updateMessage(chatId, assistantId, (m) => ({
              ...m,
              text: finalText || m.text,
              streaming: false,
              workdir: evt.workdir,
            }));
            updateAction(actionId, {
              status: "done",
              detail: finalText ? `Completed. ${finalText.slice(0, 180)}` : "Completed.",
              workdir: evt.workdir || project.path,
            });
            addHandoff("run_codex_task", finalText.slice(0, 160));
          } else if (evt.type === "error") {
            store.updateMessage(chatId, assistantId, (m) => ({ ...m, streaming: false }));
            updateAction(actionId, { status: "failed", detail: String(evt.message || "Codex failed") });
            setError(String(evt.message || "Codex failed"));
          }
        };

        await readSseStream(res, handle);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          cancelled = true;
          store.updateMessage(chatId, assistantId, (m) => ({
            ...m,
            streaming: false,
            text: m.text || "Cancelled.",
          }));
          updateAction(actionId, {
            status: "failed",
            detail: "Cancelled by user.",
          });
          return;
        }
        throw err;
      } finally {
        activeAbortControllerRef.current = null;
      }

      store.updateMessage(chatId, assistantId, (m) =>
        m.streaming ? { ...m, streaming: false } : m
      );
      if (!cancelled && finalText) speak(finalText);
    },
    [addAction, addHandoff, speak, store.appendMessage, store.updateMessage, updateAction]
  );

  const streamAgent = useCallback(
    async (message: string, project: Project, chatId: string) => {
      const assistantId = crypto.randomUUID();
      store.appendMessage(chatId, { id: assistantId, role: "assistant", text: "", streaming: true });

      const controller = new AbortController();
      activeAbortControllerRef.current = controller;
      let cancelled = false;
      let finalText = "";
      let finalAudioUrl = "";
      let usedCodex = false;
      let activeActionId = "";

      try {
        const res = await api.postChatStream({
          message,
          workdir: project.path,
          projectId: project.id,
          chatId,
        }, controller.signal);

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
          if (evt.type === "delta" && evt.text) {
            finalText += evt.text;
            store.updateMessage(chatId, assistantId, (m) => ({ ...m, text: m.text + evt.text }));
          } else if (evt.type === "tool_call") {
            usedCodex = true;
            activeActionId = addAction({
              title: "Agent handoff to Codex",
              status: "running",
              detail: String(evt.task || "Local task"),
              workdir: String(evt.workdir || project.path),
            });
            store.updateMessage(chatId, assistantId, (m) => ({ ...m, usedCodex: true }));
          } else if (evt.type === "tool_progress" && evt.text) {
            if (activeActionId) {
              updateAction(activeActionId, (prev) => ({
                detail: prev.detail + evt.text,
              }));
            }
          } else if (evt.type === "status") {
            if (activeActionId) {
              updateAction(activeActionId, {
                detail: evt.message,
              });
            }
          } else if (evt.type === "tool_result") {
            usedCodex = true;
            const summary = String(evt.result || "").slice(0, 180);
            addHandoff(String(evt.name || "run_codex_task"), summary);
            if (activeActionId) {
              updateAction(activeActionId, {
                status: "done",
                detail: summary ? `Completed. ${summary}` : "Codex task completed.",
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
                detail: String(evt.message || "Agent failed"),
              });
            }
            setError(String(evt.message || "Agent failed"));
          }
        });

        store.updateMessage(chatId, assistantId, (m) =>
          m.streaming ? { ...m, streaming: false } : m
        );
        if (!cancelled && finalAudioUrl) await playResponseAudio(finalAudioUrl);
        else if (!cancelled && finalText) speak(finalText);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          cancelled = true;
          store.updateMessage(chatId, assistantId, (m) => ({
            ...m,
            streaming: false,
            text: m.text || "Cancelled.",
          }));
          if (activeActionId) {
            updateAction(activeActionId, {
              status: "failed",
              detail: "Cancelled by user.",
            });
          }
          return;
        }
        throw err;
      } finally {
        activeAbortControllerRef.current = null;
      }
    },
    [addAction, addHandoff, playResponseAudio, speak, store.appendMessage, store.updateMessage, updateAction]
  );

  const send = useCallback(
    async (raw?: string, skipPreview = false, projectOverride?: Project, chatOverride?: string) => {
      const text = (raw ?? input).trim();
      const project = projectOverride || store.activeProject;
      if (!text || busy || !project) return;
      
      let chatId = chatOverride || store.activeChatId;
      if (!chatId) {
        chatId = store.createChat(project.id).id;
      }

      const risk = riskyActionReason(text);
      if (risk && !skipPreview) {
        setPendingAction({ text, project, chatId, mode, reason: risk });
        return;
      }

      setInput("");
      setError("");
      setBusy(true);

      if ((store.messagesByChat[chatId] || []).length === 0) {
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
    [busy, input, mode, store, streamAgent, streamCodex]
  );

  const handleCancelTask = useCallback(() => {
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
      activeAbortControllerRef.current = null;
    }
    liveVoice.cancelTask();
  }, [liveVoice]);

  const toggleVoice = () => {
    primeAudioPlayback();
    activeUserVoiceMsgIdRef.current = null;
    activeAssistantVoiceMsgIdRef.current = null;
    if (voiceActive) {
      liveVoice.stop();
      voiceCtxRef.current = null;
    } else if (store.activeProject && store.activeChatId) {
      voiceCtxRef.current = { project: store.activeProject, chatId: store.activeChatId };
      liveVoice.start();
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
    if (window.confirm(`Remove project “${name}”? This clears its chats and local history.`)) {
      store.removeProject(id);
    }
  };

  const handleRemoveChat = (projectId: string, chatId: string) => {
    if (window.confirm("Delete this conversation?")) {
      store.removeChat(projectId, chatId);
    }
  };

  const handleRenameChat = (projectId: string, chatId: string, title: string) => {
    const next = window.prompt("Rename conversation", title);
    if (next !== null) {
      store.renameChat(projectId, chatId, next);
    }
  };

  const statusClass =
    status === "Ready" ? "ready" : status === "Backend offline" ? "offline" : "warn";

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

  const suggestions =
    mode === "codex"
      ? [
          "List the files in this directory",
          "Show the git status",
          "Run the test suite",
          "Summarize this codebase",
        ]
      : [
          "How many files are in this project?",
          "What changed in the last commit?",
          "Pull the latest from git",
          "Explain the project structure",
        ];

  return (
    <div className={cn("flex h-screen w-screen flex-col overflow-hidden bg-surface-0 text-fg", isDragging && "select-none")}>
      {/* TitleBar */}
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
              <span className="px-1 text-[12.5px] text-fg truncate max-w-[240px]">{store.activeChat.title}</span>
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
          <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[11.5px] text-fg-muted">
            <Search className="h-3.5 w-3.5" />
            <span>Scope: {store.activeProject ? store.activeProject.path : "Select a project"}</span>
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
                : "border-line bg-surface-2 text-fg-muted hover:text-fg hover:bg-surface-3"
            )}
          >
            {railOpen ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeftOpen className="h-3.5 w-3.5" />}
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
                : "border-line bg-surface-2 text-fg-muted hover:text-fg hover:bg-surface-3"
            )}
          >
            {panelOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
          </button>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex flex-1 min-h-0 min-w-0">
        
        {/* Column 1: ActivityRail */}
        <div className="w-14 shrink-0 flex flex-col justify-between items-center border-r border-line bg-surface-1 py-3">
          <div className="flex flex-col gap-1 w-full px-2">
            <button
              title="Chats"
              className="group relative flex h-11 w-full flex-col items-center justify-center gap-0.5 rounded-md bg-surface-2 text-accent"
            >
              <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-accent" />
              <SquareTerminal className="h-4.5 w-4.5" />
              <span className="font-mono text-[9px] uppercase tracking-wider scale-90">Chats</span>
            </button>
            <button
              title="Files coming soon"
              disabled
              className="group flex h-11 w-full cursor-not-allowed flex-col items-center justify-center gap-0.5 rounded-md text-fg-dim opacity-35"
            >
              <FileCode2 className="h-4.5 w-4.5" />
              <span className="font-mono text-[9px] uppercase tracking-wider scale-90">Files</span>
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
              {store.theme === "dark" ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
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

        {/* Column 2: ExplorerPanel (Resizable Sidebar) */}
        {railOpen && (
          <aside
            style={{ width: `${railWidth}px` }}
            className="flex h-full min-h-0 flex-col border-r border-line bg-surface-1 shrink-0"
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

            <nav className="flex-1 overflow-y-auto py-1">
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
                  const pChats = store.chats[p.id] || [];
                  const activeChatId = store.activeChatByProject[p.id] || "";

                  return (
                    <div key={p.id} className="px-1">
                      <div className={cn(
                        "group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors",
                        isActive ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2/60 hover:text-fg"
                      )}>
                        <button
                          onClick={() => store.setActiveId(p.id)}
                          className="flex items-center gap-1.5 flex-1 min-w-0"
                        >
                          <ChevronRight
                            className={cn("h-3.5 w-3.5 text-fg-dim transition-transform shrink-0", isActive && "rotate-90")}
                          />
                          <span
                            className="h-2 w-2 rounded-sm shrink-0"
                            style={{ background: p.color }}
                          />
                          <span className="truncate text-[13px] font-medium">{p.name}</span>
                        </button>
                        
                        <button
                          title="Remove Project"
                          onClick={() => handleRemoveProject(p.id, p.name)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-surface-3 hover:text-danger text-fg-dim transition-all shrink-0"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>

                      {isActive && (
                        <div className="ml-5 mt-0.5 mb-1 border-l border-line-soft pl-2">
                          {pChats.map((c) => {
                            const isChatActive = c.id === activeChatId;
                            return (
                              <div
                                key={c.id}
                                className={cn(
                                  "group flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12.5px] transition-colors",
                                  isChatActive ? "bg-accent/10 text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg"
                                )}
                              >
                                <button
                                  onClick={() => store.selectChat(p.id, c.id)}
                                  className="flex items-center gap-1.5 flex-1 min-w-0"
                                  title={c.title}
                                >
                                  <span className="truncate">{c.title}</span>
                                </button>
                                
                                <button
                                  title="Rename chat"
                                  onClick={() => handleRenameChat(p.id, c.id, c.title)}
                                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-surface-3 hover:text-fg text-fg-dim transition-all shrink-0"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button
                                  title="Delete chat"
                                  onClick={() => handleRemoveChat(p.id, c.id)}
                                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-surface-3 hover:text-danger text-fg-dim transition-all shrink-0"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            );
                          })}
                          <button
                            onClick={() => store.createChat(p.id)}
                            className="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] text-fg-dim hover:bg-surface-2 hover:text-accent"
                          >
                            <Plus className="h-3 w-3" /> New chat
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </nav>

          </aside>
        )}

        {/* Column 2 Resizer Handle */}
        {railOpen && (
          <div
            className="w-1 cursor-col-resize hover:bg-accent/40 active:bg-accent transition-colors bg-line-soft shrink-0"
            onMouseDown={startRailDrag}
          />
        )}

        {/* Column 3: ChatPanel */}
        <main className="flex flex-1 min-w-0 min-h-0 flex-col bg-surface-0 relative">
          
          {/* Main Topbar */}
          <div className="flex items-center justify-between border-b border-line bg-surface-1/40 px-5 py-2.5 shrink-0">
            <div className="flex min-w-0 items-center gap-3">
              <h2 className="truncate text-[14px] font-semibold tracking-tight">
                {store.activeChat?.title || "No Thread Selected"}
              </h2>
              {store.messages.length > 0 && (
                <span className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted shrink-0">
                  {store.messages.length} turns
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Mode Toggle */}
              <div className="inline-flex items-center rounded-md border border-line bg-surface-2 p-0.5">
                {(["agent", "codex"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={cn(
                      "rounded px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-wider transition-colors",
                      mode === m ? "bg-surface-3 text-fg" : "text-fg-dim hover:text-fg"
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>

              {/* Voice Live Button */}
              {liveVoice.supported && (
                <button
                  onClick={toggleVoice}
                  disabled={!store.activeProject}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed",
                    voiceActive
                      ? "border-accent bg-accent/15 text-accent glow-accent"
                      : "border-line bg-surface-2 text-fg-muted hover:text-fg"
                  )}
                >
                  <Circle className={cn("h-2 w-2 fill-current", voiceActive && "pulse-dot")} />
                  {voiceActive ? "Live" : "Idle"}
                </button>
              )}

            </div>
          </div>

          {/* Messages Stream */}
          <section className="flex-1 overflow-y-auto px-5 py-6 scroll-smooth">
            <div className="mx-auto flex max-w-[760px] flex-col gap-6">
              
              {!store.activeProject ? (
                <div className="text-center py-20 px-4 max-w-md mx-auto">
                  <div className="w-12 h-12 rounded-xl bg-accent/15 text-accent flex items-center justify-center mx-auto mb-4 border border-accent/25">
                    <FolderPlus className="h-6 w-6" />
                  </div>
                  <h3 className="text-base font-semibold">Connect a Project</h3>
                  <p className="text-[13px] text-fg-muted mt-1.5 leading-relaxed">
                    A project links the agent to a folder on your system.
                    It can read files, write code, run commands, and execute tests directly in place.
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
                  <h3 className="text-sm font-semibold tracking-tight">{store.activeProject.name}</h3>
                  <p className="text-[12.5px] font-mono text-accent mt-1 truncate max-w-md mx-auto">{store.activeProject.path}</p>
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
                store.messages.map((m, idx) => {
                  const isUser = m.role === "user";
                  if (isUser) {
                    return (
                      <article
                        key={m.id}
                        className="flex w-full justify-end animate-in fade-in duration-200"
                      >
                        <div className="max-w-[80%] rounded-xl px-4 py-3 text-[13.5px] leading-relaxed shadow-sm bg-surface-2 border border-line text-fg">
                          {m.text ? (
                            <div className="prose prose-invert max-w-none">
                              <MarkdownRenderer content={m.text} />
                            </div>
                          ) : null}
                        </div>
                      </article>
                    );
                  } else {
                    return (
                      <article
                        key={m.id}
                        className="flex w-full justify-start animate-in fade-in duration-200"
                      >
                        <div className="flex-1 text-[13.5px] leading-relaxed text-fg/95 px-1 py-1 max-w-[90%]">
                          {m.text ? (
                            <div className="prose prose-invert max-w-none">
                              <MarkdownRenderer content={m.text} />
                            </div>
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
                        </div>
                      </article>
                    );
                  }
                })
              )}

              {busy && mode === "agent" && !store.messages.some((m) => m.streaming) && (
                <article className="flex justify-start w-full">
                  <div className="flex-1 px-1 py-1 max-w-[90%]">
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

          {/* Composer Footer */}
          <footer className="border-t border-line bg-surface-1/40 px-5 py-3 shrink-0">
            <div className="mx-auto max-w-[760px]">
              {voiceActive && (
                <div className="mb-3 rounded-lg border border-accent/25 bg-surface-2 p-3.5 shadow-lg flex items-center gap-3.5 animate-in slide-in-from-bottom-2 duration-200">
                  {/* Equalizer */}
                  <div className={cn("equalizer shrink-0", liveVoice.muted && "paused")}>
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>

                  {/* Body Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] font-semibold text-fg tracking-tight leading-none flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-dot" />
                      {voiceTitle}
                    </p>
                    <p className="text-[11.5px] text-fg-muted mt-1 truncate">{liveVoice.message}</p>
                    {liveVoice.transcriptPreview && (
                      <p className="text-[11.5px] text-accent font-mono italic mt-1 truncate bg-accent/5 border border-accent/10 rounded px-1.5 py-0.5 max-w-full">
                        "{liveVoice.transcriptPreview}"
                      </p>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={liveVoice.toggleMute}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors",
                        liveVoice.muted
                          ? "border-danger/30 bg-danger/10 text-danger"
                          : "border-line bg-surface-3 text-fg-muted hover:text-fg"
                      )}
                    >
                      {liveVoice.muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                      <span>{liveVoice.muted ? "Unmute" : "Mute"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={toggleVoice}
                      className="flex items-center gap-1.5 rounded-md bg-danger text-white px-3 py-1.5 text-[11.5px] font-semibold hover:brightness-110 transition-colors shadow-sm"
                    >
                      <MicOff className="h-3.5 w-3.5" />
                      <span>End</span>
                    </button>
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-line bg-surface-1 ring-accent-focus transition-all overflow-hidden">
                <textarea
                  value={input}
                  onChange={onComposerInput}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  disabled={!store.activeProject || busy}
                  rows={2}
                  placeholder={
                    !store.activeProject
                      ? "Create or select a project folder to start…"
                      : "Type operator commands, ask questions, or describe changes…"
                  }
                  className="block w-full resize-none bg-transparent px-3.5 py-3 text-[13.5px] leading-relaxed text-fg placeholder:text-fg-dim focus:outline-none disabled:opacity-50"
                />
                
                <div className="flex items-center justify-between border-t border-line-soft px-2 py-1.5 bg-surface-1/80">
                  <div className="flex items-center gap-0.5">
                    {liveVoice.supported && (
                      <button
                        title={voiceTitle}
                        onClick={toggleVoice}
                        disabled={!store.activeProject}
                        className={cn(
                          "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] disabled:opacity-40 transition-colors",
                          voiceActive
                            ? "bg-accent/15 text-accent font-semibold"
                            : "text-fg-muted hover:bg-surface-2 hover:text-fg"
                        )}
                      >
                        {liveVoice.muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                        <span>Voice</span>
                      </button>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {busy && (
                      <button
                        onClick={handleCancelTask}
                        className="rounded px-2.5 py-1 text-[11px] font-mono uppercase bg-danger/10 hover:bg-danger/25 text-danger font-semibold border border-danger/20 transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      onClick={() => void send()}
                      disabled={!input.trim() || !store.activeProject || busy}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[12px] font-semibold transition-all",
                        input.trim() && store.activeProject && !busy
                          ? "bg-accent text-accent-foreground hover:brightness-110 shadow-sm"
                          : "bg-surface-2 text-fg-dim cursor-not-allowed"
                      )}
                    >
                      <span>Send</span>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
              
              {error && (
                <div className="mt-2 text-xs text-danger flex items-center gap-1.5 font-mono px-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-danger inline-block animate-ping" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          </footer>
        </main>

      {/* Column 3 Resizer Handle */}
      {panelOpen && (
        <div
          className="w-1 cursor-col-resize hover:bg-accent/40 active:bg-accent transition-colors bg-line-soft shrink-0"
          onMouseDown={startPanelDrag}
        />
      )}

      {/* Column 4: ConsolePanel (Resizable Sidebar) */}
      {panelOpen && (
        <aside
          style={{ width: `${panelWidth}px` }}
          className="flex h-full min-h-0 flex-col border-l border-line bg-surface-1 shrink-0"
        >
          {/* Console Header */}
          <div className="flex items-center justify-between border-b border-line-soft px-3 py-2.5 shrink-0">
            <div className="flex items-center gap-2">
              <SquareTerminal className="h-3.5 w-3.5 text-accent" />
              <span className="text-[12.5px] font-semibold tracking-tight">Console</span>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                title="Hide console panel"
                onClick={() => setPanelOpen(false)}
                className="grid h-6 w-6 place-items-center rounded text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              
              <button
                onClick={clearThread}
                disabled={!store.activeChatId}
                className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border border-line bg-surface-2 text-fg-dim hover:text-fg hover:border-fg-muted disabled:opacity-40"
              >
                Clear
              </button>
              
              <span className="flex items-center gap-1.5 font-mono text-[10px] text-fg-dim">
                <span className={cn("h-1.5 w-1.5 rounded-full pulse-dot", status === "Ready" ? "bg-success" : "bg-danger")} />
                {status === "Ready" ? "online" : "offline"}
              </span>
            </div>
          </div>

          {/* Console Tabs */}
          <div className="flex items-center gap-0.5 border-b border-line-soft px-2 pt-1.5 shrink-0">
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
                  onClick={() => setActiveConsoleTab(t.id)}
                  className={cn(
                    "relative flex items-center gap-1.5 px-2.5 py-2 text-[11.5px] transition-colors",
                    active ? "text-fg" : "text-fg-dim hover:text-fg"
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {t.label}
                  {active && <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-t bg-accent" />}
                </button>
              );
            })}
          </div>

          {/* Console Contents */}
          <div className="flex-1 overflow-y-auto p-3">
            {activeConsoleTab === "stream" && (
              <div className="font-mono text-[11px] leading-relaxed">
                {debugEntries.length === 0 ? (
                  <div className="text-center py-12 text-fg-dim italic">Waiting for events…</div>
                ) : (
                  debugEntries.map((l) => (
                    <div key={l.id} className="grid grid-cols-[82px_1fr] items-baseline gap-2 py-0.5 border-b border-line-soft/30">
                      <span className="text-fg-dim shrink-0">{l.time}</span>
                      <span className="text-fg/85 break-all whitespace-pre-wrap">{l.message}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeConsoleTab === "actions" && (
              <div className="space-y-2">
                {actions.length === 0 ? (
                  <div className="text-center py-12 text-fg-dim italic">No operator actions logged.</div>
                ) : (
                  actions.map((a) => (
                    <div key={a.id} className="panel p-2.5 text-xs bg-surface-2 border border-line">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] text-accent font-semibold">{a.title}</span>
                        <span className={cn(
                          "px-1.5 py-0.2 rounded font-mono text-[9px] font-bold uppercase",
                          a.status === "running" ? "bg-accent/10 text-accent animate-pulse" :
                          a.status === "done" ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
                        )}>
                          {a.status}
                        </span>
                      </div>
                      <p className="mt-1.5 font-mono text-[10.5px] text-fg-muted whitespace-pre-wrap break-all">{a.detail}</p>
                      {a.workdir && (
                        <div className="mt-1 text-[9px] text-fg-dim font-mono border-t border-line-soft/40 pt-1 flex items-center gap-1">
                          <Folder className="h-2.5 w-2.5" />
                          <span className="truncate">{a.workdir}</span>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {activeConsoleTab === "handoffs" && (
              <div className="space-y-2">
                {handoffs.length === 0 ? (
                  <div className="text-center py-12 text-fg-dim italic">No handoffs between Agent and Codex.</div>
                ) : (
                  handoffs.map((d, i) => (
                    <div key={d.id} className="panel p-2.5 text-xs bg-surface-2 border border-line">
                      <div className="flex items-center gap-2 font-mono text-[10.5px]">
                        <span className="text-fg-muted">agent</span>
                        <ChevronRight className="h-3 w-3 text-accent" />
                        <span className="text-accent">codex</span>
                        <span className="ml-auto text-fg-dim font-semibold">#{handoffs.length - i}</span>
                      </div>
                      <p className="mt-1.5 text-[11.5px] text-fg-muted leading-relaxed whitespace-pre-wrap">{d.summary}</p>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeConsoleTab === "voice" && (
              <div className="space-y-4 text-xs">
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
                    Used if Gemini Gateway doesn't return direct audio chunks, synthesized on this browser.
                  </p>
                </div>



                {pendingAudioUrl && (
                  <div className="panel p-3 bg-danger/5 border border-danger/20 rounded-md">
                    <p className="text-danger font-semibold text-[11px] mb-2">Browser autoplay was blocked.</p>
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
          <div className="grid grid-cols-2 border-t border-line-soft shrink-0 bg-surface-1/40">
            <div className="px-3 py-1.5">
              <div className="label text-[9px]">conversation size</div>
              <div className="mt-0.5 flex items-baseline gap-0.5">
                <span className="font-mono text-[13px] font-semibold text-fg tabular-nums">{store.messages.length}</span>
                <span className="font-mono text-[9px] text-fg-dim">turns</span>
              </div>
            </div>
            <div className="px-3 py-1.5 border-l border-line-soft">
              <div className="label text-[9px]">estimated context</div>
              <div className="mt-0.5 flex items-baseline gap-0.5">
                <span className="font-mono text-[13px] font-semibold text-fg tabular-nums">
                  {Math.round(store.messages.reduce((acc, m) => acc + (m.text?.length || 0), 0) / 4.2).toLocaleString()}
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

      {pendingAction && (
        <ActionPreviewModal
          action={pendingAction}
          onCancel={() => setPendingAction(null)}
          onRun={() => {
            const action = pendingAction;
            setPendingAction(null);
            primeAudioPlayback();
            void send(action.text, true, action.project, action.chatId);
          }}
        />
      )}
    </div>
  );
}
export default App;
