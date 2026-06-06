import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  CaretLeft,
  CaretRight,
  TreeStructure,
} from "@phosphor-icons/react";

import { useProjectStore } from "./hooks/useProjectStore";
import { useLiveVoice } from "./hooks/useLiveVoice";
import * as api from "./services/api";
import { Project, ActionEntry, Handoff, DebugEntry, PendingAction, ProjectInfo } from "./types";
import { loadJSON, saveJSON, chatTitleFrom } from "./utils";

import ProjectsRail from "./components/sidebar/ProjectsRail";
import ChatArea from "./components/chat/ChatArea";
import Composer from "./components/chat/Composer";
import ContextPanel from "./components/console/ContextPanel";
import WorkspaceDashboard from "./components/chat/WorkspaceDashboard";
import AddProjectModal from "./components/modals/AddProjectModal";
import ActionPreviewModal from "./components/modals/ActionPreviewModal";

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
  
  const [railWidth, setRailWidth] = useState(() => loadJSON<number>("cva.railWidth.v1", 288));
  const [panelWidth, setPanelWidth] = useState(() => loadJSON<number>("cva.panelWidth.v1", 420));
  const [isDragging, setIsDragging] = useState(false);
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);

  const responseAudioRef = useRef<HTMLAudioElement | null>(null);
  const consoleLoadedChatRef = useRef("");
  const consoleSaveTimerRef = useRef<number | null>(null);

  // Resize drags
  const startRailDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(200, Math.min(450, moveEvent.clientX));
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
      const newWidth = Math.max(300, Math.min(650, window.innerWidth - moveEvent.clientX));
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
  useEffect(() => saveJSON("cva.railWidth.v1", railWidth), [railWidth]);
  useEffect(() => saveJSON("cva.panelWidth.v1", panelWidth), [panelWidth]);

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

  return (
    <div
      className={`app ${isDragging ? "dragging" : ""}`}
      data-rail={railOpen ? "open" : "closed"}
      data-panel={panelOpen ? "open" : "closed"}
      style={{
        ["--rail-w" as any]: railOpen ? `${railWidth}px` : "0px",
        ["--panel-w" as any]: panelOpen ? `${panelWidth}px` : "0px",
      }}
    >
      {/* Left sidebar */}
      {railOpen && (
        <ProjectsRail
          projects={store.projects}
          activeId={store.activeId}
          chats={store.chats}
          activeChatByProject={store.activeChatByProject}
          status={status}
          statusClass={statusClass}
          theme={store.theme}
          setTheme={store.setTheme}
          setActiveId={store.setActiveId}
          onNewProject={() => setShowAdd(true)}
          onRemoveProject={store.removeProject}
          onSelectChat={store.selectChat}
          onRenameChat={store.renameChat}
          onRemoveChat={store.removeChat}
          onCreateChat={store.createChat}
        />
      )}

      {!railOpen && (
        <button
          className="reopen left"
          type="button"
          onClick={() => setRailOpen(true)}
          aria-label="Show projects"
        >
          <CaretRight size={15} weight="bold" />
        </button>
      )}

      {railOpen && <div className="resizer left-resizer" onMouseDown={startRailDrag} />}

      {/* Primary chat scroll view */}
      <section className="chat">
        <header className="topbar">
          <div className="topbarLeft">
            <button
              className="collapseBtn"
              type="button"
              onClick={() => setRailOpen((v) => !v)}
              aria-label="Toggle projects"
            >
              <CaretLeft
                size={16}
                weight="bold"
                style={{ transform: railOpen ? "none" : "rotate(180deg)" }}
              />
            </button>
            <div className="topbarChatGroup">
              <span className="topbarChatLabel">
                <span className="chatTitleText">{store.activeChat?.title || "New conversation"}</span>
              </span>
            </div>
          </div>

          <div className="topbarCenter">
            <WorkspaceDashboard
              project={store.activeProject}
              projectInfo={projectInfo}
              messagesCount={store.messages.length}
            />
          </div>

          <div className="topbarRight">
            <div className="modeToggle" role="tablist" aria-label="Mode">
              <button
                className={mode === "agent" ? "active" : ""}
                onClick={() => setMode("agent")}
                type="button"
              >
                Agent
              </button>
              <button
                className={`codex ${mode === "codex" ? "active" : ""}`}
                onClick={() => setMode("codex")}
                type="button"
              >
                Codex
              </button>
            </div>
            <div className={`runState ${busy || voiceActive ? "busy" : ""}`}>
              <span className="dot" />
              {voiceActive ? "Live" : busy ? "Working" : "Idle"}
            </div>
            <button
              className="collapseBtn"
              type="button"
              onClick={() => setPanelOpen((v) => !v)}
              aria-label="Toggle context panel"
            >
              <TreeStructure size={17} weight="bold" />
            </button>
          </div>
        </header>

        <ChatArea
          activeProject={store.activeProject}
          messages={store.messages}
          busy={busy}
          mode={mode}
          onSend={(text) => void send(text, false)}
          onNewProjectClick={() => setShowAdd(true)}
        />

        <Composer
          input={input}
          onInputChange={onComposerInput}
          onSubmit={() => void send()}
          voiceActive={voiceActive}
          onVoiceToggle={toggleVoice}
          voiceSupported={liveVoice.supported}
          voiceMuted={liveVoice.muted}
          voiceToggleMute={liveVoice.toggleMute}
          voiceMessage={liveVoice.message}
          voiceState={liveVoice.state}
          voiceTranscriptPreview={liveVoice.transcriptPreview}
          voiceTitle={voiceTitle}
          busy={busy}
          hasActiveProject={store.activeProject !== null}
          activeProjectPath={store.activeProject?.path}
          mode={mode}
          error={error}
          primeAudio={primeAudioPlayback}
          onCancelTask={handleCancelTask}
        />
      </section>

      {panelOpen && <div className="resizer right-resizer" onMouseDown={startPanelDrag} />}

      {!panelOpen && (
        <button
          className="reopen right"
          type="button"
          onClick={() => setPanelOpen(true)}
          aria-label="Show console"
        >
          <CaretLeft size={15} weight="bold" />
        </button>
      )}

      {/* Right context panel */}
      {panelOpen && (
        <ContextPanel
          actions={actions}
          handoffs={handoffs}
          debugEntries={debugEntries}
          voices={voices}
          selectedVoiceURI={selectedVoiceURI}
          onSelectVoice={setSelectedVoiceURI}
          pendingAudioUrl={pendingAudioUrl}
          playResponseAudio={playResponseAudio}
          onClear={clearThread}
          hasActiveProject={store.activeProject !== null}
        />
      )}

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
