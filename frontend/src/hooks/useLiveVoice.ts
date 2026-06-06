import { useCallback, useEffect, useRef, useState } from "react";
import { LiveVoiceState } from "../types";
import { getWebSocketUrl } from "../services/api";

const LIVE_AUDIO_RATE = 16000;
const MAX_BUFFERED_AUDIO_CHUNKS = 360;
const RECONNECT_DELAY_MS = 900;

function encodePcmChunk(input: Float32Array, sourceRate: number): string {
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

function base64ToFloat32Array(base64: string): Float32Array {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const int16Array = new Int16Array(bytes.buffer);
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768;
  }
  return float32Array;
}

class AudioStreamPlayer {
  private ctx: AudioContext | null = null;
  private nextPlayTime: number = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private sampleRate: number = 24000;

  constructor() {}

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.nextPlayTime = 0;
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  playChunk(float32Data: Float32Array) {
    this.init();
    if (!this.ctx) return;

    const audioBuffer = this.ctx.createBuffer(1, float32Data.length, this.sampleRate);
    audioBuffer.getChannelData(0).set(float32Data);

    const source = this.ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.ctx.destination);

    const currentTime = this.ctx.currentTime;
    if (this.nextPlayTime < currentTime) {
      this.nextPlayTime = currentTime + 0.03; // 30ms latency buffer to prevent gaps
    }

    source.start(this.nextPlayTime);
    this.activeSources.push(source);

    const duration = audioBuffer.duration;
    source.onended = () => {
      this.activeSources = this.activeSources.filter((s) => s !== source);
    };

    this.nextPlayTime += duration;
  }

  stop() {
    this.activeSources.forEach((source) => {
      try {
        source.stop();
      } catch {}
    });
    this.activeSources = [];
    this.nextPlayTime = 0;
  }
}

interface UseLiveVoiceProps {
  getWorkdir: () => string | undefined;
  getProjectId: () => string | undefined;
  getChatId: () => string | undefined;
  onTurn: (userText: string, assistantText: string, usedCodex: boolean) => void;
  onAudio: (audioUrl: string) => void;
  onDebug: (message: string) => void;
  onHandoff: (name: string, summary: string, workdir?: string) => void;
  onHandoffStart?: (name: string, task: string, workdir: string) => void;
  onHandoffProgress?: (name: string, text: string) => void;
  onHandoffFailed?: (name: string, message: string) => void;
}

export function useLiveVoice({
  getWorkdir,
  getProjectId,
  getChatId,
  onTurn,
  onAudio,
  onDebug,
  onHandoff,
  onHandoffStart,
  onHandoffProgress,
  onHandoffFailed,
}: UseLiveVoiceProps) {
  const [state, setState] = useState<LiveVoiceState>("idle");
  const [message, setMessage] = useState("Gemini Live voice is ready.");
  const [userPreview, setUserPreview] = useState("");
  const [assistantPreview, setAssistantPreview] = useState("");
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const websocketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const bufferedAudioRef = useRef<string[]>([]);
  const reconnectTimerRef = useRef<number | null>(null);
  const manuallyStoppedRef = useRef(false);
  const usedCodexRef = useRef(false);
  const audioPlayerRef = useRef<AudioStreamPlayer | null>(null);
  const hasStreamedAudioRef = useRef(false);

  const getAudioPlayer = () => {
    if (!audioPlayerRef.current) {
      audioPlayerRef.current = new AudioStreamPlayer();
    }
    audioPlayerRef.current.init();
    return audioPlayerRef.current;
  };
  const cbRef = useRef({
    onTurn,
    onAudio,
    onDebug,
    onHandoff,
    onHandoffStart,
    onHandoffProgress,
    onHandoffFailed,
    getWorkdir,
    getProjectId,
    getChatId,
  });

  useEffect(() => {
    cbRef.current = {
      onTurn,
      onAudio,
      onDebug,
      onHandoff,
      onHandoffStart,
      onHandoffProgress,
      onHandoffFailed,
      getWorkdir,
      getProjectId,
      getChatId,
    };
  }, [
    onTurn,
    onAudio,
    onDebug,
    onHandoff,
    onHandoffStart,
    onHandoffProgress,
    onHandoffFailed,
    getWorkdir,
    getProjectId,
    getChatId,
  ]);

  const log = useCallback((text: string) => cbRef.current.onDebug(text), []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      mutedRef.current = next;
      log(next ? "Microphone muted — Gemini will not be interrupted by background audio." : "Microphone unmuted.");
      return next;
    });
  }, [log]);

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
    const websocket = new WebSocket(getWebSocketUrl("/api/live"));
    websocketRef.current = websocket;

    websocket.onopen = () => {
      log("Live channel connected.");
      const workdir = cbRef.current.getWorkdir();
      const projectId = cbRef.current.getProjectId();
      const chatId = cbRef.current.getChatId();
      if (workdir) {
        websocket.send(
          JSON.stringify({
            type: "config",
            workdir,
            project_id: projectId,
            chat_id: chatId,
          })
        );
      }
      flushBufferedAudio(websocket);
      setState("live");
      setMessage("Live with Gemini — speak naturally, pause to let the agent answer.");
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
          if (payload.audio_data_url && !hasStreamedAudioRef.current) {
            cbRef.current.onAudio(payload.audio_data_url);
          }
          hasStreamedAudioRef.current = false;
          setUserPreview("");
          setAssistantPreview("");
          setState("live");
          setMessage("Live with Gemini — speak again when ready.");
        } else if (payload.type === "interrupted") {
          setAssistantPreview("");
          audioPlayerRef.current?.stop();
          log("Response interrupted by new speech.");
        } else if (payload.type === "assistant_audio_delta") {
          const audioB64 = payload.data;
          if (audioB64) {
            try {
              const float32 = base64ToFloat32Array(audioB64);
              getAudioPlayer().playChunk(float32);
              hasStreamedAudioRef.current = true;
            } catch (err) {
              log(`Error playing audio chunk: ${err}`);
            }
          }
        } else if (payload.type === "tool_call_started") {
          usedCodexRef.current = true;
          setState("working");
          setMessage(`Codex is running: ${payload.task || ""}`);
          cbRef.current.onHandoffStart?.(
            payload.name || "run_codex_task",
            payload.task || "",
            payload.workdir || ""
          );
          log(`Codex handoff started: ${payload.name || "tool"}.`);
        } else if (payload.type === "tool_progress") {
          setUserPreview("");
          setAssistantPreview((current) => `${current}${payload.text || ""}`);
          cbRef.current.onHandoffProgress?.(
            payload.name || "run_codex_task",
            payload.text || ""
          );
        } else if (payload.type === "status") {
          setMessage(payload.message || "Codex is working...");
        } else if (payload.type === "tool_call_failed") {
          setState("thinking");
          setMessage("Codex task failed.");
          setAssistantPreview("");
          cbRef.current.onHandoffFailed?.(
            payload.name || "run_codex_task",
            payload.message || "Codex task failed."
          );
        } else if (payload.type === "tool_call") {
          usedCodexRef.current = true;
          setState("thinking");
          setMessage("Codex task completed. Gemini is formulating a response.");
          setAssistantPreview("");
          cbRef.current.onHandoff(
            payload.name || "run_codex_task",
            String(payload.result || "").trim() || "Codex task completed.",
            payload.workdir || ""
          );
          log(`Codex handoff completed: ${payload.name || "tool"}.`);
        } else if (payload.type === "error") {
          setState("error");
          setMessage(payload.message || "Live voice failed.");
          log(`Live voice error: ${payload.message || "unknown error"}`);
        }
      };
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
    setMuted(false);
    mutedRef.current = false;
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    bufferedAudioRef.current = [];
    audioPlayerRef.current?.stop();
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
    setMuted(false);
    mutedRef.current = false;
    bufferedAudioRef.current = [];
    hasStreamedAudioRef.current = false;
    try {
      getAudioPlayer();
    } catch {}

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
        if (mutedRef.current) return;
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
        typeof window.WebSocket !== "undefined"
    ),
    state,
    message,
    transcriptPreview: userPreview || assistantPreview,
    muted,
    toggleMute,
    start,
    stop,
  };
}
