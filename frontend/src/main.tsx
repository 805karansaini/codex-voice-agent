import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUp,
  Broom,
  BracketsCurly,
  CaretLeft,
  CaretRight,
  ChatText,
  Cpu,
  DotsThreeVertical,
  FileMagnifyingGlass,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Lightning,
  Microphone,
  MicrophoneSlash,
  Moon,
  PencilSimple,
  Plugs,
  Plus,
  SpeakerHigh,
  Sun,
  Terminal,
  TerminalWindow,
  Trash,
  TreeStructure,
} from "@phosphor-icons/react";
import "./styles.css";

/* ---------------------------------------------------------------- types */

type Role = "user" | "assistant";

type Message = {
  id: string;
  role: Role;
  text: string;
  usedCodex?: boolean;
  streaming?: boolean;
  workdir?: string;
};

type ProjectInfo = {
  path: string;
  name: string;
  exists: boolean;
  is_git: boolean;
  branch: string | null;
  file_count: number | null;
};

type Project = {
  id: string;
  name: string;
  path: string;
  color: string;
  createdAt: number;
};

type Chat = {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
};

type AgentResponse = {
  reply?: string;
  tool_calls?: unknown[];
  workdir?: string;
  audio_data_url?: string | null;
};

type HistoryRow = {
  id: string;
  role: Role;
  text: string;
  meta?: {
    direct_codex?: boolean;
    tool_calls?: unknown[];
    workdir?: string;
    project_id?: string;
    chat_id?: string;
  };
};

type LiveVoiceState = "idle" | "connecting" | "live" | "thinking" | "error";

type DebugEntry = { id: string; time: string; message: string };
type Handoff = { id: string; name: string; summary: string };
type ActionEntry = {
  id: string;
  title: string;
  status: "running" | "done" | "failed";
  detail: string;
  workdir?: string;
};
type PendingAction = {
  text: string;
  project: Project;
  chatId: string;
  mode: "agent" | "codex";
  reason: string;
};

/* ---------------------------------------------------------------- consts */

const API = import.meta.env.VITE_API_BASE_URL || "";
const LIVE_AUDIO_RATE = 16000;
const MAX_BUFFERED_AUDIO_CHUNKS = 360;
const RECONNECT_DELAY_MS = 900;
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAwF0AAIC7AAACABAAZGF0YQAAAAA=";

const PROJECT_COLORS = ["#c8f23a", "#f3b85a", "#7fd1c4", "#8ab4ff", "#ff9f7a", "#c79bff"];
const PREFERRED_VOICE_NAMES = [
  "Samantha", "Karen", "Moira", "Tessa",
  "Google UK English Female", "Google US English",
  "Microsoft Aria", "Microsoft Jenny", "Zira",
];

const LS_PROJECTS = "cva.projects.v1";
const LS_ACTIVE = "cva.activeProject.v1";
const LS_THREADS = "cva.threads.v1"; // legacy: one thread per project (migrated to chats)
const LS_CHATS = "cva.chats.v1";
const LS_MESSAGES = "cva.messages.v1";
const LS_ACTIVE_CHAT = "cva.activeChat.v1";
const LS_THEME = "cva.theme.v1";

/* ---------------------------------------------------------------- storage */

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota */
  }
}

/* ---------------------------------------------------------------- chat state */

type ChatState = {
  chats: Record<string, Chat[]>; // keyed by projectId, newest first
  messages: Record<string, Message[]>; // keyed by chatId
  activeChat: Record<string, string>; // projectId -> active chatId
};

function chatTitleFrom(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean;
}

// Hydrate chat state from localStorage. The first time the new multi-chat model
// runs we migrate the legacy single-thread-per-project store so existing
// conversations are not lost — each old project thread becomes one chat.
function loadChatState(): ChatState {
  if (localStorage.getItem(LS_CHATS) !== null) {
    return {
      chats: loadJSON<Record<string, Chat[]>>(LS_CHATS, {}),
      messages: loadJSON<Record<string, Message[]>>(LS_MESSAGES, {}),
      activeChat: loadJSON<Record<string, string>>(LS_ACTIVE_CHAT, {}),
    };
  }
  const legacy = loadJSON<Record<string, Message[]>>(LS_THREADS, {});
  const chats: Record<string, Chat[]> = {};
  const messages: Record<string, Message[]> = {};
  const activeChat: Record<string, string> = {};
  for (const [projectId, msgs] of Object.entries(legacy)) {
    const id = crypto.randomUUID();
    const firstUser = msgs.find((m) => m.role === "user");
    chats[projectId] = [{ id, projectId, title: firstUser ? chatTitleFrom(firstUser.text) : "Chat 1", createdAt: Date.now() }];
    messages[id] = msgs;
    activeChat[projectId] = id;
  }
  return { chats, messages, activeChat };
}

/* ---------------------------------------------------------------- audio utils */

function websocketUrl(path: string) {
  if (API.startsWith("http")) return `${API.replace(/^http/, "ws")}${path}`;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

function encodePcmChunk(input: Float32Array, sourceRate: number) {
  const ratio = sourceRate / LIVE_AUDIO_RATE;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const pcm = new Int16Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let total = 0;
    let samples = 0;
    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      total += input[sampleIndex];
      samples += 1;
    }
    const sample = Math.max(-1, Math.min(1, samples ? total / samples : input[start] || 0));
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

/* ---------------------------------------------------------------- live voice hook */

function useLiveVoice({
  getWorkdir,
  getProjectId,
  getChatId,
  onTurn,
  onAudio,
  onDebug,
  onHandoff,
}: {
  getWorkdir: () => string | undefined;
  getProjectId: () => string | undefined;
  getChatId: () => string | undefined;
  onTurn: (userText: string, assistantText: string, usedCodex: boolean) => void;
  onAudio: (audioUrl: string) => void;
  onDebug: (message: string) => void;
  onHandoff: (name: string, summary: string) => void;
}) {
  const [state, setState] = useState<LiveVoiceState>("idle");
  const [message, setMessage] = useState("Gemini Live voice is ready.");
  const [userPreview, setUserPreview] = useState("");
  const [assistantPreview, setAssistantPreview] = useState("");
  const websocketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const bufferedAudioRef = useRef<string[]>([]);
  const reconnectTimerRef = useRef<number | null>(null);
  const manuallyStoppedRef = useRef(false);
  const usedCodexRef = useRef(false);
  const cbRef = useRef({ onTurn, onAudio, onDebug, onHandoff, getWorkdir, getProjectId, getChatId });

  useEffect(() => {
    cbRef.current = { onTurn, onAudio, onDebug, onHandoff, getWorkdir, getProjectId, getChatId };
  }, [onTurn, onAudio, onDebug, onHandoff, getWorkdir, getProjectId, getChatId]);

  const log = useCallback((text: string) => cbRef.current.onDebug(text), []);

  const stopMicrophone = useCallback(async () => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    processorRef.current = null;
    sourceRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (contextRef.current && contextRef.current.state !== "closed") {
      await contextRef.current.close().catch(() => undefined);
    }
    contextRef.current = null;
  }, []);

  const flushBufferedAudio = useCallback((websocket: WebSocket) => {
    if (bufferedAudioRef.current.length === 0) return;
    const buffered = bufferedAudioRef.current.splice(0);
    buffered.forEach((payload) => websocket.send(payload));
  }, []);

  const connectSocket = useCallback(() => {
    const websocket = new WebSocket(websocketUrl("/api/live"));
    websocketRef.current = websocket;

    websocket.onopen = () => {
      log("Live channel connected.");
      // Forward the active project's directory so Codex handoffs run there.
      const workdir = cbRef.current.getWorkdir();
      const projectId = cbRef.current.getProjectId();
      const chatId = cbRef.current.getChatId();
      if (workdir) websocket.send(JSON.stringify({ type: "config", workdir, project_id: projectId, chat_id: chatId }));
      flushBufferedAudio(websocket);
      setState("live");
      setMessage("Live with Gemini — speak naturally, pause to let the agent answer.");
    };

    websocket.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === "ready" || payload.type === "debug") {
        log(payload.message || payload.type);
      } else if (payload.type === "user_transcript") {
        setUserPreview((current) => `${current}${payload.text || ""}`);
        setState("thinking");
        setMessage("Heard you — composing a reply.");
      } else if (payload.type === "assistant_delta") {
        setAssistantPreview((current) => `${current}${payload.text || ""}`);
        setState("thinking");
        setMessage("Gemini is replying.");
      } else if (payload.type === "turn_complete") {
        const userText = String(payload.user_text || "").trim();
        const assistantText = String(payload.assistant_text || "").trim();
        if (userText || assistantText) {
          cbRef.current.onTurn(userText || "Voice message", assistantText || "Done.", usedCodexRef.current);
        }
        usedCodexRef.current = false;
        if (payload.audio_data_url) cbRef.current.onAudio(payload.audio_data_url);
        setUserPreview("");
        setAssistantPreview("");
        setState("live");
        setMessage("Live with Gemini — speak again when ready.");
      } else if (payload.type === "interrupted") {
        setAssistantPreview("");
        log("Response interrupted by new speech.");
      } else if (payload.type === "tool_call") {
        usedCodexRef.current = true;
        cbRef.current.onHandoff(payload.name || "run_codex_task", String(payload.result || "").trim() || "Codex task completed.");
        log(`Codex handoff: ${payload.name || "tool"}.`);
      } else if (payload.type === "error") {
        setState("error");
        setMessage(payload.message || "Live voice failed.");
        log(`Live voice error: ${payload.message || "unknown error"}`);
      }
    };

    websocket.onerror = () => log("Live channel error.");

    websocket.onclose = () => {
      websocketRef.current = null;
      if (manuallyStoppedRef.current) {
        void stopMicrophone();
        setState("idle");
        setMessage("Gemini Live voice is ready.");
        return;
      }
      if (streamRef.current) {
        setState("connecting");
        setMessage("Connection dropped — reconnecting microphone stream.");
        if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null;
          connectSocket();
        }, RECONNECT_DELAY_MS);
        return;
      }
      setState("idle");
      setMessage("Gemini Live voice is ready.");
    };

    return websocket;
  }, [flushBufferedAudio, log, stopMicrophone]);

  const stop = useCallback(async () => {
    manuallyStoppedRef.current = true;
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    bufferedAudioRef.current = [];
    await stopMicrophone();
    websocketRef.current?.send(JSON.stringify({ type: "close" }));
    websocketRef.current?.close();
    websocketRef.current = null;
    setState("idle");
    setMessage("Gemini Live voice is ready.");
  }, [stopMicrophone]);

  const start = useCallback(async () => {
    if (state === "connecting" || state === "live" || state === "thinking") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof window.AudioContext === "undefined") {
      setState("error");
      setMessage("This browser cannot open live microphone audio.");
      return;
    }
    setState("connecting");
    setMessage("Connecting live microphone to Gemini.");
    setUserPreview("");
    setAssistantPreview("");
    manuallyStoppedRef.current = false;
    usedCodexRef.current = false;
    bufferedAudioRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      streamRef.current = stream;
      contextRef.current = audioContext;
      sourceRef.current = source;
      processorRef.current = processor;
      connectSocket();

      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        const payload = JSON.stringify({
          type: "audio",
          mime_type: `audio/pcm;rate=${LIVE_AUDIO_RATE}`,
          data: encodePcmChunk(input, audioContext.sampleRate),
        });
        const websocket = websocketRef.current;
        if (websocket?.readyState === WebSocket.OPEN) {
          websocket.send(payload);
          return;
        }
        bufferedAudioRef.current.push(payload);
        if (bufferedAudioRef.current.length > MAX_BUFFERED_AUDIO_CHUNKS) {
          bufferedAudioRef.current.splice(0, bufferedAudioRef.current.length - MAX_BUFFERED_AUDIO_CHUNKS);
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
    } catch (err) {
      await stopMicrophone();
      websocketRef.current?.close();
      websocketRef.current = null;
      setState("error");
      setMessage(err instanceof Error ? err.message : "Could not start live voice.");
    }
  }, [connectSocket, state, stopMicrophone]);

  useEffect(() => () => void stop(), [stop]);

  return {
    active: state === "connecting" || state === "live" || state === "thinking",
    supported: Boolean(
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
        typeof window.AudioContext !== "undefined" &&
        typeof window.WebSocket !== "undefined",
    ),
    state,
    message,
    transcriptPreview: userPreview || assistantPreview,
    start,
    stop,
  };
}

/* ---------------------------------------------------------------- helpers */

function glyphFor(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/* ---------------------------------------------------------------- Add Project modal */

function normalizePath(raw: string) {
  let p = raw.trim();
  if (p.length > 1 && p.endsWith("/")) p = p.replace(/\/+$/, "");
  return p;
}

function historyRowsToMessages(rows: HistoryRow[]): Message[] {
  return rows
    .filter((row) => row.role === "user" || row.role === "assistant")
    .map((row) => ({
      id: row.id,
      role: row.role,
      text: row.text,
      usedCodex: Boolean(row.meta?.direct_codex || (Array.isArray(row.meta?.tool_calls) && row.meta.tool_calls.length > 0)),
      workdir: row.meta?.workdir,
    }));
}

function riskyActionReason(text: string) {
  const lower = text.toLowerCase();
  if (
    /\b(git\s+pull|git\s+push|git\s+merge|git\s+rebase|git\s+reset|git\s+checkout|commit|delete|remove|rm\s+-|install|npm\s+i|npm\s+install|pip\s+install|uv\s+add|write|edit|modify)\b/.test(lower) ||
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
      try { onEvent(JSON.parse(line.slice(5).trim())); } catch { /* ignore partial */ }
    }
  }
}

function AddProjectModal({
  onClose,
  onCreate,
  usedColors,
  existingPaths,
}: {
  onClose: () => void;
  onCreate: (p: Omit<Project, "id" | "createdAt">) => void;
  usedColors: string[];
  existingPaths: string[];
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const nextColor = PROJECT_COLORS.find((c) => !usedColors.includes(c)) || PROJECT_COLORS[0];
  const [color, setColor] = useState(nextColor);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [picking, setPicking] = useState(false);
  const pathRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Opens a real native OS folder dialog via the local backend, which returns
  // the true absolute path (the browser picker only gives the folder name).
  const browse = async () => {
    setError("");
    setPicking(true);
    try {
      const res = await fetch(`${API}/api/fs/pick`, { method: "POST" });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error((payload as any).detail || "picker failed");
      }
      const data = (await res.json()) as { path: string | null; cancelled: boolean };
      if (data.cancelled || !data.path) return;
      setPath(data.path);
      if (!name.trim()) setName(data.path.split("/").filter(Boolean).pop() || "");
    } catch (err) {
      setError(
        err instanceof Error && /not available/i.test(err.message)
          ? err.message
          : "Couldn’t open the native folder picker. Paste the absolute path instead.",
      );
    } finally {
      setPicking(false);
    }
  };

  const submit = async () => {
    const cleanName = name.trim();
    const cleanPath = normalizePath(path);
    if (!cleanName || !cleanPath) return;
    setError("");
    setChecking(true);
    try {
      // Validate against the real filesystem so we point at the original folder
      // (never create or duplicate one) and resolve symlinks for de-duplication.
      const res = await fetch(`${API}/api/project/info?path=${encodeURIComponent(cleanPath)}`);
      if (res.status === 404) {
        setError("That directory does not exist. Paste the full absolute path to an existing folder.");
        return;
      }
      if (!res.ok) {
        setError("Could not reach the backend to validate the path. Is it running?");
        return;
      }
      const info = (await res.json()) as ProjectInfo;
      const resolved = info.path || cleanPath;
      if (existingPaths.includes(resolved)) {
        setError("This folder is already a project.");
        return;
      }
      onCreate({ name: cleanName, path: resolved, color });
    } catch {
      setError("Could not reach the backend to validate the path. Is it running?");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modalHead">
          <h3>Add a project</h3>
          <p>
            Point the agent at an existing folder on this machine. It works in that folder <strong>in place</strong> —
            nothing is copied, so your original files are the only files.
          </p>
        </div>
        <div className="modalBody">
          <div className="field">
            <label htmlFor="pName">Project name</label>
            <input
              id="pName"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Codex Voice Agent"
              onKeyDown={(e) => e.key === "Enter" && (document.getElementById("pPath") as HTMLInputElement)?.focus()}
            />
          </div>
          <div className="field">
            <label htmlFor="pPath">Directory (absolute path)</label>
            <div className="pathRow">
              <input
                id="pPath"
                ref={pathRef}
                className="mono"
                value={path}
                onChange={(e) => { setPath(e.target.value); if (error) setError(""); }}
                placeholder="/Users/you/Projects/my-app"
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
              <button className="browseBtn" type="button" onClick={browse} disabled={picking}>
                <FolderOpen size={16} weight="bold" /> {picking ? "Opening…" : "Browse"}
              </button>
            </div>
            <p className="hint">
              Click <strong>Browse</strong> to pick a folder with the native dialog (fills the real absolute path), or
              paste a full path like <span className="mono">/Users/karansaini/Projects/app</span>.
            </p>
          </div>
          <div className="field">
            <label>Accent</label>
            <div className="swatches">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`swatch ${c === color ? "on" : ""}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  aria-label={`Accent ${c}`}
                />
              ))}
            </div>
          </div>
          {error && <div className="modalError"><Plugs size={15} weight="bold" /> {error}</div>}
        </div>
        <div className="modalFoot">
          <button className="btnGhost" type="button" onClick={onClose}>Cancel</button>
          <button className="btnPrimary" type="button" onClick={submit} disabled={!name.trim() || !path.trim() || checking}>
            {checking ? "Checking…" : "Create project"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ActionPreviewModal({
  action,
  onCancel,
  onRun,
}: {
  action: PendingAction;
  onCancel: () => void;
  onRun: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onRun();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, onRun]);

  return (
    <div className="overlay" onMouseDown={onCancel}>
      <div className="modal actionPreview" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modalHead">
          <h3>Review before running</h3>
          <p>This task may change the selected folder. Check the target before continuing.</p>
        </div>
        <div className="modalBody">
          <div className="previewWarning">
            <Plugs size={16} weight="bold" />
            <span>{action.reason}</span>
          </div>
          <div className="previewGrid">
            <div>
              <span>Project</span>
              <b>{action.project.name}</b>
            </div>
            <div>
              <span>Mode</span>
              <b>{action.mode === "codex" ? "Codex direct" : "Agent"}</b>
            </div>
            <div className="wide">
              <span>Working folder</span>
              <code>{action.project.path}</code>
            </div>
          </div>
          <div className="previewTask">
            <span>Task</span>
            <p>{action.text}</p>
          </div>
        </div>
        <div className="modalFoot">
          <button className="btnGhost" type="button" onClick={onCancel}>Cancel</button>
          <button className="btnPrimary dangerRun" type="button" onClick={onRun}>
            Run in this folder
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- App */

function App() {
  const [projects, setProjects] = useState<Project[]>(() => loadJSON<Project[]>(LS_PROJECTS, []));
  const [activeId, setActiveId] = useState<string>(() => loadJSON<string>(LS_ACTIVE, ""));
  const initialChatState = useRef(loadChatState()).current;
  const [chats, setChats] = useState<Record<string, Chat[]>>(initialChatState.chats);
  const [messagesByChat, setMessagesByChat] = useState<Record<string, Message[]>>(initialChatState.messages);
  const [activeChatByProject, setActiveChatByProject] = useState<Record<string, string>>(initialChatState.activeChat);
  const [theme, setTheme] = useState<"dark" | "light">(() => loadJSON<"dark" | "light">(LS_THEME, "dark"));

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
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);

  const streamRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const responseAudioRef = useRef<HTMLAudioElement | null>(null);

  const active = useMemo(() => projects.find((p) => p.id === activeId) || null, [projects, activeId]);
  const projectChats = active ? chats[active.id] || [] : [];
  const activeChatId = active ? activeChatByProject[active.id] || "" : "";
  const activeChat = projectChats.find((c) => c.id === activeChatId) || null;
  const messages = activeChatId ? messagesByChat[activeChatId] || [] : [];

  /* persistence */
  useEffect(() => saveJSON(LS_PROJECTS, projects), [projects]);
  useEffect(() => saveJSON(LS_ACTIVE, activeId), [activeId]);
  useEffect(() => saveJSON(LS_CHATS, chats), [chats]);
  useEffect(() => saveJSON(LS_MESSAGES, messagesByChat), [messagesByChat]);
  useEffect(() => saveJSON(LS_ACTIVE_CHAT, activeChatByProject), [activeChatByProject]);
  useEffect(() => {
    saveJSON(LS_THEME, theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  /* chats (conversations inside a project) */
  const persistChat = useCallback((chat: Chat) => {
    fetch(`${API}/api/chats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chat),
    }).catch(() => undefined);
  }, []);

  const createChat = useCallback(
    (projectId: string, opts?: { title?: string; activate?: boolean }) => {
      const chat: Chat = { id: crypto.randomUUID(), projectId, title: opts?.title || "New chat", createdAt: Date.now() };
      setChats((current) => ({ ...current, [projectId]: [chat, ...(current[projectId] || [])] }));
      setMessagesByChat((current) => ({ ...current, [chat.id]: [] }));
      if (opts?.activate !== false) setActiveChatByProject((current) => ({ ...current, [projectId]: chat.id }));
      persistChat(chat);
      return chat;
    },
    [persistChat],
  );

  const selectChat = useCallback((projectId: string, chatId: string) => {
    setActiveChatByProject((current) => ({ ...current, [projectId]: chatId }));
  }, []);

  const renameChat = useCallback(
    (projectId: string, chatId: string, title: string) => {
      const clean = title.trim();
      if (!clean) return;
      let updated: Chat | undefined;
      setChats((current) => {
        const next = (current[projectId] || []).map((c) => (c.id === chatId ? (updated = { ...c, title: clean }) : c));
        return { ...current, [projectId]: next };
      });
      if (updated) persistChat(updated);
    },
    [persistChat],
  );

  const removeChat = useCallback((projectId: string, chatId: string) => {
    window.speechSynthesis?.cancel();
    setChats((current) => ({ ...current, [projectId]: (current[projectId] || []).filter((c) => c.id !== chatId) }));
    // If the removed chat was active, clear it; the ensure-active effect picks the next one (or creates one).
    setActiveChatByProject((current) => (current[projectId] === chatId ? { ...current, [projectId]: "" } : current));
    setMessagesByChat((current) => {
      const next = { ...current };
      delete next[chatId];
      return next;
    });
    fetch(`${API}/api/chats/${encodeURIComponent(chatId)}`, { method: "DELETE" }).catch(() => undefined);
  }, []);

  /* voices */
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const loadVoices = () => {
      const browserVoices = window.speechSynthesis.getVoices();
      setVoices(browserVoices);
      setSelectedVoiceURI((current) => {
        if (current || browserVoices.length === 0) return current;
        const preferred =
          PREFERRED_VOICE_NAMES.map((n) => browserVoices.find((v) => v.name.toLowerCase().includes(n.toLowerCase()))).find(Boolean) ||
          browserVoices.find((v) => v.lang.toLowerCase().startsWith("en")) ||
          browserVoices[0];
        return preferred?.voiceURI || "";
      });
    };
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, []);

  /* health */
  useEffect(() => {
    fetch(`${API}/api/health`)
      .then((r) => r.json())
      .then((data) => {
        setStatus(data.has_google_api_key ? "Ready" : "Missing Google API key");
        setModel(data.gemini_model || "Gemini Live");
      })
      .catch(() => setStatus("Backend offline"));
  }, []);

  /* server-backed projects */
  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/projects`)
      .then((r) => (r.ok ? (r.json() as Promise<Project[]>) : Promise.reject()))
      .then((serverProjects) => {
        if (cancelled || serverProjects.length === 0) return;
        setProjects((current) => {
          const byId = new Map(current.map((project) => [project.id, project]));
          for (const project of serverProjects) byId.set(project.id, project);
          return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
        });
        setActiveId((current) => current || serverProjects[0]?.id || "");
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  /* server-backed chats */
  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/chats`)
      .then((r) => (r.ok ? (r.json() as Promise<Chat[]>) : Promise.reject()))
      .then((serverChats) => {
        if (cancelled || serverChats.length === 0) return;
        setChats((current) => {
          const grouped = new Map<string, Map<string, Chat>>();
          for (const [pid, list] of Object.entries(current)) grouped.set(pid, new Map(list.map((c) => [c.id, c])));
          for (const chat of serverChats) {
            if (!grouped.has(chat.projectId)) grouped.set(chat.projectId, new Map());
            grouped.get(chat.projectId)!.set(chat.id, chat);
          }
          const next: Record<string, Chat[]> = {};
          for (const [pid, byId] of grouped) next[pid] = Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
          return next;
        });
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: "smooth" });
    });
  }, []);

  useEffect(() => scrollToBottom(), [activeId, activeChatId, scrollToBottom]);

  // Every project needs at least one chat, and one of them must be active.
  useEffect(() => {
    if (!active) return;
    const list = chats[active.id] || [];
    if (list.length === 0) {
      createChat(active.id);
      return;
    }
    if (!list.some((c) => c.id === activeChatByProject[active.id])) {
      setActiveChatByProject((current) => ({ ...current, [active.id]: list[0].id }));
    }
  }, [active, chats, activeChatByProject, createChat]);

  // Hydrate the active chat's messages from server history (only if empty locally).
  useEffect(() => {
    if (!activeChatId) return;
    let cancelled = false;
    fetch(`${API}/api/history?chat_id=${encodeURIComponent(activeChatId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<HistoryRow[]>) : Promise.reject()))
      .then((rows) => {
        if (cancelled || rows.length === 0) return;
        setMessagesByChat((current) =>
          (current[activeChatId] || []).length > 0 ? current : { ...current, [activeChatId]: historyRowsToMessages(rows) },
        );
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [activeChatId]);

  // Validate the active folder and pull live git branch + file count for the panel.
  useEffect(() => {
    setProjectInfo(null);
    if (!active) return;
    let cancelled = false;
    fetch(`${API}/api/project/info?path=${encodeURIComponent(active.path)}`)
      .then((r) => (r.ok ? (r.json() as Promise<ProjectInfo>) : Promise.reject()))
      .then((info) => { if (!cancelled) setProjectInfo(info); })
      .catch(() => { if (!cancelled) setProjectInfo({ path: active.path, name: active.name, exists: false, is_git: false, branch: null, file_count: null }); });
    return () => { cancelled = true; };
  }, [active]);

  const addDebug = useCallback((message: string) => {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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

  const updateAction = useCallback((id: string, patch: Partial<ActionEntry>) => {
    setActions((current) => current.map((action) => (action.id === id ? { ...action, ...patch } : action)));
  }, []);

  const appendMessage = useCallback(
    (chatId: string, msg: Message) => {
      setMessagesByChat((current) => ({ ...current, [chatId]: [...(current[chatId] || []), msg] }));
      scrollToBottom();
    },
    [scrollToBottom],
  );

  const updateMessage = useCallback((chatId: string, id: string, patch: (m: Message) => Message) => {
    setMessagesByChat((current) => {
      const thread = current[chatId] || [];
      return { ...current, [chatId]: thread.map((m) => (m.id === id ? patch(m) : m)) };
    });
  }, []);

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

  // Live voice is pinned to the project + chat it started in, so you can run a
  // voice conversation in one chat while typing in another. The context is
  // captured at start() time (see toggleVoice) and read back here.
  const voiceCtxRef = useRef<{ project: Project; chatId: string } | null>(null);
  const getWorkdir = useCallback(() => voiceCtxRef.current?.project.path ?? active?.path, [active]);
  const getProjectId = useCallback(() => voiceCtxRef.current?.project.id ?? active?.id, [active]);
  const getChatId = useCallback(() => voiceCtxRef.current?.chatId ?? activeChatId, [activeChatId]);

  const liveVoice = useLiveVoice({
    getWorkdir,
    getProjectId,
    getChatId,
    onTurn: (userText, assistantText, usedCodex) => {
      const ctx = voiceCtxRef.current;
      if (!ctx) return;
      appendMessage(ctx.chatId, { id: crypto.randomUUID(), role: "user", text: userText, workdir: ctx.project.path });
      appendMessage(ctx.chatId, { id: crypto.randomUUID(), role: "assistant", text: assistantText, usedCodex });
    },
    onAudio: playResponseAudio,
    onDebug: addDebug,
    onHandoff: (name, summary) => {
      addHandoff(name, summary);
      addAction({ title: "Voice handoff to Codex", status: "done", detail: summary, workdir: voiceCtxRef.current?.project.path });
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
      appendMessage(chatId, { id: assistantId, role: "assistant", text: "", usedCodex: true, streaming: true });

      const res = await fetch(`${API}/api/codex/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, workdir: project.path, project_id: project.id, chat_id: chatId }),
      });
      if (!res.ok || !res.body) {
        const payload = await res.json().catch(() => ({}));
        updateMessage(chatId, assistantId, (m) => ({ ...m, streaming: false, text: m.text || "Codex request failed." }));
        updateAction(actionId, { status: "failed", detail: (payload as any).detail || "Codex request failed" });
        throw new Error((payload as any).detail || "Codex request failed");
      }

      let finalText = "";

      const handle = (evt: any) => {
        if (evt.type === "delta" && evt.text) {
          finalText += evt.text;
          updateMessage(chatId, assistantId, (m) => ({ ...m, text: m.text + evt.text }));
          scrollToBottom();
        } else if (evt.type === "done") {
          finalText = String(evt.text ?? finalText);
          updateMessage(chatId, assistantId, (m) => ({ ...m, text: finalText || m.text, streaming: false, workdir: evt.workdir }));
          updateAction(actionId, {
            status: "done",
            detail: finalText ? `Completed. ${finalText.slice(0, 180)}` : "Completed.",
            workdir: evt.workdir || project.path,
          });
          addHandoff("run_codex_task", finalText.slice(0, 160));
        } else if (evt.type === "error") {
          updateMessage(chatId, assistantId, (m) => ({ ...m, streaming: false }));
          updateAction(actionId, { status: "failed", detail: String(evt.message || "Codex failed") });
          setError(String(evt.message || "Codex failed"));
        }
      };

      await readSseStream(res, handle);

      updateMessage(chatId, assistantId, (m) => (m.streaming ? { ...m, streaming: false } : m));
      // TTS only once, on the complete response.
      if (finalText) speak(finalText);
    },
    [addAction, addHandoff, appendMessage, scrollToBottom, speak, updateAction, updateMessage],
  );

  const streamAgent = useCallback(
    async (message: string, project: Project, chatId: string) => {
      const assistantId = crypto.randomUUID();
      appendMessage(chatId, { id: assistantId, role: "assistant", text: "", streaming: true });

      const res = await fetch(`${API}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, workdir: project.path, project_id: project.id, chat_id: chatId }),
      });
      if (!res.ok || !res.body) {
        const payload = await res.json().catch(() => ({}));
        updateMessage(chatId, assistantId, (m) => ({ ...m, streaming: false, text: m.text || "Agent request failed." }));
        throw new Error((payload as any).detail || "Agent request failed");
      }

      let finalText = "";
      let finalAudioUrl = "";
      let usedCodex = false;
      let activeActionId = "";

      await readSseStream(res, (evt) => {
        if (evt.type === "delta" && evt.text) {
          finalText += evt.text;
          updateMessage(chatId, assistantId, (m) => ({ ...m, text: m.text + evt.text }));
          scrollToBottom();
        } else if (evt.type === "tool_call") {
          usedCodex = true;
          activeActionId = addAction({
            title: "Agent handoff to Codex",
            status: "running",
            detail: String(evt.task || "Local task"),
            workdir: String(evt.workdir || project.path),
          });
          updateMessage(chatId, assistantId, (m) => ({ ...m, usedCodex: true }));
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
          updateMessage(chatId, assistantId, (m) => ({
            ...m,
            text: finalText || m.text || "Done.",
            streaming: false,
            usedCodex,
            workdir: evt.workdir || project.path,
          }));
        } else if (evt.type === "error") {
          updateMessage(chatId, assistantId, (m) => ({ ...m, streaming: false, text: m.text || "Agent failed." }));
          if (activeActionId) updateAction(activeActionId, { status: "failed", detail: String(evt.message || "Agent failed") });
          setError(String(evt.message || "Agent failed"));
        }
      });

      updateMessage(chatId, assistantId, (m) => (m.streaming ? { ...m, streaming: false } : m));
      if (finalAudioUrl) await playResponseAudio(finalAudioUrl);
      else if (finalText) speak(finalText);
    },
    [addAction, addHandoff, appendMessage, playResponseAudio, scrollToBottom, speak, updateAction, updateMessage],
  );

  const send = useCallback(
    async (raw?: string, skipPreview = false, projectOverride?: Project, chatOverride?: string) => {
      const text = (raw ?? input).trim();
      const project = projectOverride || active;
      if (!text || busy || !project) return;
      // Resolve the target chat: an explicit override, the project's active chat,
      // or a fresh one if the project somehow has none yet.
      let chatId = chatOverride || activeChatByProject[project.id] || "";
      if (!chatId) chatId = createChat(project.id).id;

      const risk = riskyActionReason(text);
      if (risk && !skipPreview) {
        setPendingAction({ text, project, chatId, mode, reason: risk });
        return;
      }
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      setError("");
      setBusy(true);
      // Name the chat from its first message.
      if ((messagesByChat[chatId] || []).length === 0) renameChat(project.id, chatId, chatTitleFrom(text));
      appendMessage(chatId, { id: crypto.randomUUID(), role: "user", text, workdir: project.path });

      try {
        if (mode === "codex") {
          // Stream Codex output token-by-token into the bubble; speak only at the end.
          await streamCodex(text, project, chatId);
        } else {
          await streamAgent(text, project, chatId);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setBusy(false);
      }
    },
    [active, activeChatByProject, appendMessage, busy, createChat, input, messagesByChat, mode, renameChat, streamAgent, streamCodex],
  );

  const toggleVoice = () => {
    primeAudioPlayback();
    if (voiceActive) {
      liveVoice.stop();
      voiceCtxRef.current = null;
    } else if (active && activeChatId) {
      // Pin this voice session to the chat it starts in.
      voiceCtxRef.current = { project: active, chatId: activeChatId };
      liveVoice.start();
    }
  };

  const createProject = (p: Omit<Project, "id" | "createdAt">) => {
    const project: Project = { ...p, id: crypto.randomUUID(), createdAt: Date.now() };
    setProjects((current) => [project, ...current]);
    setActiveId(project.id);
    setShowAdd(false);
    createChat(project.id);
    fetch(`${API}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(project),
    }).catch(() => undefined);
  };

  const removeProject = (id: string) => {
    const chatIds = new Set((chats[id] || []).map((c) => c.id));
    setProjects((current) => current.filter((p) => p.id !== id));
    setChats((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setActiveChatByProject((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setMessagesByChat((current) => {
      const next: Record<string, Message[]> = {};
      for (const [cid, msgs] of Object.entries(current)) if (!chatIds.has(cid)) next[cid] = msgs;
      return next;
    });
    setActiveId((current) => (current === id ? "" : current));
    fetch(`${API}/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
  };

  const clearThread = () => {
    if (!active || !activeChatId) return;
    window.speechSynthesis?.cancel();
    setMessagesByChat((current) => ({ ...current, [activeChatId]: [] }));
    setHandoffs([]);
    setActions([]);
    setError("");
    fetch(`${API}/api/history?chat_id=${encodeURIComponent(activeChatId)}`, { method: "DELETE" }).catch(() => undefined);
  };

  const onComposerInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 168)}px`;
  };

  const statusClass = status === "Ready" ? "ready" : status === "Backend offline" ? "offline" : "warn";

  const liveTitle =
    liveVoice.state === "connecting" ? "Connecting…" :
    liveVoice.state === "live" ? "Live conversation" :
    liveVoice.state === "thinking" ? "Gemini is responding" :
    liveVoice.state === "error" ? "Voice needs attention" : "Live voice";

  const suggestions =
    mode === "codex"
      ? ["List the files in this directory", "Show the git status", "Run the test suite", "Summarize this codebase"]
      : ["How many files are in this project?", "What changed in the last commit?", "Pull the latest from git", "Explain the project structure"];

  return (
    <div className="app" data-rail={railOpen ? "open" : "closed"} data-panel={panelOpen ? "open" : "closed"}>
      {/* ---------------- Projects rail ---------------- */}
      {railOpen && (
        <aside className="rail">
          <div className="railHead">
            <div className="brandMark"><TerminalWindow size={20} weight="fill" /></div>
            <div className="brandText">
              <p className="eyebrow">Local operator</p>
              <h1>Codex Voice</h1>
            </div>
          </div>

          <button className="newProject" type="button" onClick={() => setShowAdd(true)}>
            <FolderPlus size={17} weight="bold" /> New project
          </button>

          <div className="railLabel">
            <span>Projects</span>
            <em>{projects.length}</em>
          </div>

          {projects.length === 0 ? (
            <div className="railEmpty">
              <strong>No projects yet</strong>
              <span>Add a folder to start a workspace scoped to that directory.</span>
            </div>
          ) : (
            <div className="projectList">
              {projects.map((p) => {
                const isActiveProject = p.id === activeId;
                const pChats = chats[p.id] || [];
                const pActiveChat = activeChatByProject[p.id] || "";
                return (
                  <div className="projectGroup" key={p.id} style={{ ["--projColor" as string]: p.color }}>
                    <button
                      type="button"
                      className={`projectCard ${isActiveProject ? "active" : ""}`}
                      onClick={() => setActiveId(p.id)}
                    >
                      <span className="projectGlyph" style={{ background: p.color }}>{glyphFor(p.name)}</span>
                      <span className="projectMeta">
                        <span className="projectName">{p.name}</span>
                        <span className="projectPath">{p.path}</span>
                      </span>
                      <span
                        className="projectKebab"
                        role="button"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Remove project “${p.name}”? This clears its chats and local history.`)) removeProject(p.id);
                        }}
                        aria-label="Remove project"
                      >
                        <DotsThreeVertical size={16} weight="bold" />
                      </span>
                    </button>

                    {isActiveProject && (
                      <div className="chatList">
                        {pChats.map((c) => (
                          <div
                            key={c.id}
                            className={`chatRow ${c.id === pActiveChat ? "active" : ""}`}
                            onClick={() => selectChat(p.id, c.id)}
                            role="button"
                            tabIndex={0}
                          >
                            <ChatText size={14} weight={c.id === pActiveChat ? "fill" : "regular"} />
                            <span className="chatTitle">{c.title}</span>
                            <span className="chatActions">
                              <span
                                role="button"
                                tabIndex={-1}
                                aria-label="Rename chat"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const next = window.prompt("Rename chat", c.title);
                                  if (next != null) renameChat(p.id, c.id, next);
                                }}
                              >
                                <PencilSimple size={13} weight="bold" />
                              </span>
                              <span
                                role="button"
                                tabIndex={-1}
                                aria-label="Delete chat"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (window.confirm(`Delete chat “${c.title}”?`)) removeChat(p.id, c.id);
                                }}
                              >
                                <Trash size={13} weight="bold" />
                              </span>
                            </span>
                          </div>
                        ))}
                        <button className="newChat" type="button" onClick={() => createChat(p.id)}>
                          <Plus size={13} weight="bold" /> New chat
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="railFoot">
            <div className="railStatus">
              <span className={`statusDot ${statusClass}`} />
              <p>{status}</p>
            </div>
            <button
              className="ghostBtn"
              type="button"
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Sun size={16} weight="bold" /> : <Moon size={16} weight="bold" />}
            </button>
          </div>
        </aside>
      )}

      {!railOpen && (
        <button className="reopen left" type="button" onClick={() => setRailOpen(true)} aria-label="Show projects">
          <CaretRight size={15} weight="bold" />
        </button>
      )}

      {/* ---------------- Chat column ---------------- */}
      <section className="chat">
        <header className="topbar">
          <div className="topbarLeft">
            <button className="collapseBtn" type="button" onClick={() => setRailOpen((v) => !v)} aria-label="Toggle projects">
              <CaretLeft size={16} weight="bold" style={{ transform: railOpen ? "none" : "rotate(180deg)" }} />
            </button>
            <div className="projTitle">
              <h2>{active ? active.name : "Codex Voice Agent"}</h2>
              <div className="crumbs">
                {active ? (
                  <>
                    {activeChat && (
                      <span className="pill chat"><ChatText size={13} weight="bold" />{activeChat.title}</span>
                    )}
                    <span className="pill cwd"><Terminal size={13} weight="bold" />{active.path}</span>
                    {projectInfo?.branch && (
                      <span className="pill git"><GitBranch size={13} weight="bold" />{projectInfo.branch}</span>
                    )}
                    {projectInfo && !projectInfo.exists && (
                      <span className="pill danger"><Plugs size={13} weight="bold" />folder missing</span>
                    )}
                  </>
                ) : (
                  <span className="pill">Select or create a project to begin</span>
                )}
              </div>
            </div>
          </div>
          <div className="topbarRight">
            <div className="modeToggle" role="tablist" aria-label="Mode">
              <button className={mode === "agent" ? "active" : ""} onClick={() => setMode("agent")} type="button">
                <Lightning size={14} weight="fill" /> Agent
              </button>
              <button className={`codex ${mode === "codex" ? "active" : ""}`} onClick={() => setMode("codex")} type="button">
                <BracketsCurly size={14} weight="bold" /> Codex
              </button>
            </div>
            <div className={`runState ${busy || voiceActive ? "busy" : ""}`}>
              <span className="dot" />
              {voiceActive ? "Live" : busy ? "Working" : "Idle"}
            </div>
            <button className="collapseBtn" type="button" onClick={() => setPanelOpen((v) => !v)} aria-label="Toggle context panel">
              <TreeStructure size={17} weight="bold" />
            </button>
          </div>
        </header>

        <div className="stream" ref={streamRef}>
          {!active ? (
            <div className="empty">
              <div className="emptyMark"><FolderPlus size={26} weight="duotone" /></div>
              <h3>Create your first project</h3>
              <p>
                A project pins the agent to a folder on this machine. Ask it to read files, run git, or hand work to
                Codex — everything runs with that directory as the present working directory.
              </p>
              <div className="suggestRow">
                <button className="suggest" type="button" onClick={() => setShowAdd(true)}>
                  <FolderPlus size={15} weight="bold" /> Add a project
                </button>
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="empty">
              <div className="emptyMark"><Terminal size={24} weight="duotone" /></div>
              <h3>{active.name}</h3>
              <p>Working in <span style={{ fontFamily: "var(--font-mono)", color: "var(--lime)" }}>{active.path}</span>. Ask a question, run a task, or go live with voice.</p>
              <div className="suggestRow">
                {suggestions.map((s) => (
                  <button key={s} className="suggest" type="button" onClick={() => send(s)}>
                    <Lightning size={14} weight="fill" /> {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="streamInner">
              {messages.map((m, i) => (
                <article key={m.id} className={`msg ${m.role}`} style={{ ["--i" as string]: i % 12 }}>
                  <div className="msgHead">
                    <span className="who">{m.role === "user" ? "You" : "Agent"}</span>
                    {m.usedCodex && <span className="tag"><BracketsCurly size={10} weight="bold" /> Codex</span>}
                    {m.streaming && <span className="tag live"><span className="streamDot" /> streaming</span>}
                  </div>
                  <div className="bubble">
                    {m.text || (m.streaming ? "" : "")}
                    {m.streaming && !m.text && <span className="skeletonLine"><span /><span /><span /></span>}
                    {m.streaming && m.text && <span className="caret" />}
                  </div>
                </article>
              ))}
              {busy && mode === "agent" && !messages.some((m) => m.streaming) && (
                <article className="msg assistant">
                  <div className="msgHead"><span className="who">Agent</span></div>
                  <div className="bubble">
                    <span className="skeletonLine"><span /><span /><span /></span>
                  </div>
                </article>
              )}
            </div>
          )}
        </div>

        <div className="composerWrap">
          {voiceActive && (
            <div className="liveBanner">
              <div className={`liveCard ${liveVoice.state === "error" ? "error" : ""}`}>
                <div className="equalizer">
                  <span className="bars"><i /><i /><i /><i /></span>
                </div>
                <div className="liveBody">
                  <p className="liveTitle">{liveTitle}</p>
                  <p className="liveMsg">{liveVoice.message}</p>
                  {liveVoice.transcriptPreview && <p className="livePreview">{liveVoice.transcriptPreview}</p>}
                </div>
                <button className="endLive" type="button" onClick={toggleVoice}>
                  <MicrophoneSlash size={16} weight="bold" /> End
                </button>
              </div>
            </div>
          )}

          <div className="composer">
            {error && (
              <div className="errorStrip">
                <Plugs size={15} weight="bold" /> {error}
              </div>
            )}

            <div className="composerBox">
              <button
                className={`micBtn ${voiceActive ? "live" : ""}`}
                type="button"
                onClick={toggleVoice}
                disabled={!liveVoice.supported || busy || !active}
                aria-label={voiceActive ? "End live voice" : "Start live voice"}
                title={!liveVoice.supported ? "Live microphone audio is not available in this browser" : "Live voice"}
              >
                {voiceActive ? <MicrophoneSlash size={19} weight="bold" /> : <Microphone size={19} weight="bold" />}
              </button>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={onComposerInput}
                disabled={!active}
                placeholder={
                  !active
                    ? "Create a project to start chatting…"
                    : mode === "codex"
                      ? "Tell Codex exactly what to do in this directory…"
                      : "Ask the agent about this project…"
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    primeAudioPlayback();
                    send();
                  }
                }}
              />
              <button
                className="sendBtn"
                type="button"
                onClick={() => { primeAudioPlayback(); send(); }}
                disabled={busy || !input.trim() || !active}
                aria-label="Send"
              >
                <ArrowUp size={20} weight="bold" />
              </button>
            </div>

            <div className="composerFoot">
              <span className="composerHint">
                <kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> newline
              </span>
              {active && (
                <span className="composerCwd">
                  <Terminal size={12} weight="bold" /> {active.path}
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Context panel ---------------- */}
      {panelOpen && (
        <aside className="panel">
          <div className="panelHead">
            <h3>Context</h3>
            <button className="ghostBtn" type="button" onClick={clearThread} aria-label="Clear conversation" disabled={!active}>
              <Broom size={15} weight="bold" />
            </button>
          </div>
          <div className="panelScroll">
            <section className="card">
              <div className="cardHead">
                <FolderOpen size={15} weight="bold" />
                <span className="t">Workspace</span>
              </div>
              <div className="cardBody">
                <div className="kv">
                  <div className="row"><span className="k">Project</span><span className="v">{active?.name || "—"}</span></div>
                  <div className="row"><span className="k">Working dir</span><span className="v accent">{active?.path || "—"}</span></div>
                  <div className="row"><span className="k">Branch</span><span className="v amber">{active ? (projectInfo?.branch || (projectInfo?.is_git ? "detached" : "no git")) : "—"}</span></div>
                  <div className="row"><span className="k">Files</span><span className="v">{active ? (projectInfo?.file_count ?? "—") : "—"}</span></div>
                  <div className="row"><span className="k">Model</span><span className="v">{model}</span></div>
                  <div className="row"><span className="k">Messages</span><span className="v">{messages.length}</span></div>
                </div>
              </div>
            </section>

            <section className="card">
              <div className="cardHead">
                <Lightning size={15} weight="fill" />
                <span className="t">Quick actions</span>
              </div>
              <div className="cardBody">
                <div className="quickGrid">
                  <button className="quickAct" type="button" disabled={!active || busy} onClick={() => send("List the files in this directory")}>
                    <FileMagnifyingGlass size={15} weight="bold" /> List files
                  </button>
                  <button className="quickAct amber" type="button" disabled={!active || busy} onClick={() => send("Show the current git status")}>
                    <GitBranch size={15} weight="bold" /> Git status
                  </button>
                  <button className="quickAct amber" type="button" disabled={!active || busy} onClick={() => send("Pull the latest changes from git")}>
                    <GitBranch size={15} weight="bold" /> Git pull
                  </button>
                  <button className="quickAct" type="button" disabled={!active || busy} onClick={() => send("Summarize what this project does")}>
                    <Cpu size={15} weight="bold" /> Summarize
                  </button>
                </div>
              </div>
            </section>

            <section className="card">
              <div className="cardHead">
                <BracketsCurly size={15} weight="bold" />
                <span className="t">Codex handoffs</span>
                <span className="x">{handoffs.length}</span>
              </div>
              <div className="cardBody">
                {handoffs.length === 0 ? (
                  <p style={{ fontSize: 12, color: "var(--text-faint)" }}>No Codex handoffs yet. Tasks that touch files run here.</p>
                ) : (
                  handoffs.map((h) => (
                    <div className="handoff" key={h.id}>
                      <span className="ic"><Terminal size={14} weight="bold" /></span>
                      <span className="txt">
                        <b>{h.name}</b>
                        <p>{h.summary}</p>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="card">
              <div className="cardHead">
                <Terminal size={15} weight="bold" />
                <span className="t">Action log</span>
                <span className="x">{actions.length}</span>
              </div>
              <div className="cardBody">
                {actions.length === 0 ? (
                  <p style={{ fontSize: 12, color: "var(--text-faint)" }}>No local actions yet.</p>
                ) : (
                  <div className="actionList">
                    {actions.map((action) => (
                      <div className={`actionItem ${action.status}`} key={action.id}>
                        <span className="actionStatus">{action.status}</span>
                        <div className="actionText">
                          <b>{action.title}</b>
                          <p>{action.detail}</p>
                          {action.workdir && <code>{action.workdir}</code>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="card">
              <div className="cardHead">
                <Plugs size={15} weight="bold" />
                <span className="t">Live debug</span>
              </div>
              <div className="cardBody">
                <div className="debugLog">
                  {debugEntries.length === 0 ? (
                    <p className="empty2">No live voice events yet.</p>
                  ) : (
                    debugEntries.map((e) => (
                      <div className="line" key={e.id}>
                        <time>{e.time}</time>
                        <span>{e.message}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>

            <section className="card">
              <div className="cardHead">
                <SpeakerHigh size={15} weight="bold" />
                <span className="t">Voice output</span>
              </div>
              <div className="cardBody">
                <p className="fieldLabel"><SpeakerHigh size={13} weight="bold" /> Browser fallback voice</p>
                <select className="select" value={selectedVoiceURI} onChange={(e) => setSelectedVoiceURI(e.target.value)} disabled={voices.length === 0}>
                  {voices.length === 0 && <option value="">Browser default</option>}
                  {voices.map((v) => (
                    <option value={v.voiceURI} key={v.voiceURI}>{v.name} ({v.lang})</option>
                  ))}
                </select>
                {pendingAudioUrl && (
                  <button className="playResponse" type="button" onClick={() => playResponseAudio(pendingAudioUrl)}>
                    <SpeakerHigh size={16} weight="bold" /> Play response
                  </button>
                )}
              </div>
            </section>
          </div>
        </aside>
      )}

      {!panelOpen && (
        <button className="reopen right" type="button" onClick={() => setPanelOpen(true)} aria-label="Show context">
          <CaretLeft size={15} weight="bold" />
        </button>
      )}

      {showAdd && (
        <AddProjectModal
          onClose={() => setShowAdd(false)}
          onCreate={createProject}
          usedColors={projects.map((p) => p.color)}
          existingPaths={projects.map((p) => p.path)}
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

createRoot(document.getElementById("root")!).render(<App />);
