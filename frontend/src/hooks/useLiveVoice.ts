import { useCallback, useEffect, useRef, useState } from "react";
import type { GeminiLiveUsage, LiveVoiceState } from "../types";
import { getWebSocketUrl } from "../services/api";
import {
  AudioStreamPlayer,
  MAX_BUFFERED_AUDIO_CHUNKS,
  LIVE_AUDIO_RATE,
  base64ToFloat32Array,
  encodePcmChunk,
} from "./liveVoiceAudio";
import { liveVoiceDeliveryFailureMessage } from "../utils/liveVoice";
import { audioContainsSpeech, isClearToReadCompletedResult } from "../utils/liveVoiceSpeech";

const RECONNECT_DELAY_MS = 900;
// Backend Codex status events start after about 20s, then repeat every 60s.
// This waits slightly longer than the first status event before surfacing a
// completed Codex result when Gemini does not produce a final voice response.
const TOOL_RESULT_FALLBACK_MS = 25000;
const SPEAK_RESULT_RETRY_MS = 700;

interface UseLiveVoiceProps {
  getWorkdir: () => string | undefined;
  getProjectId: () => string | undefined;
  getChatId: () => string | undefined;
  onAudio: (audioUrl: string) => void;
  onDebug: (message: string) => void;
  onHandoff: (name: string, summary: string, workdir?: string, details?: any) => void;
  onHandoffStart?: (name: string, task: string, workdir: string) => void;
  onHandoffProgress?: (name: string, text: string) => void;
  onHandoffFailed?: (name: string, message: string) => void;
  onHandoffDeliveryFailed?: (message: string) => void;
  onHandoffTimeout?: () => void;
  onCodexEvent?: (event: any) => void;
  onUserTranscript?: (text: string) => void;
  onAssistantDelta?: (text: string) => void;
  onInterrupted?: () => void;
  onSessionRestarted?: () => void;
  onTurnComplete?: (
    userText: string,
    assistantText: string,
    usedCodex: boolean,
    workdir?: string,
    geminiLiveUsage?: GeminiLiveUsage,
  ) => void;
}

export function useLiveVoice({
  getWorkdir,
  getProjectId,
  getChatId,
  onAudio,
  onDebug,
  onHandoff,
  onHandoffStart,
  onHandoffProgress,
  onHandoffFailed,
  onHandoffDeliveryFailed,
  onHandoffTimeout,
  onCodexEvent,
  onUserTranscript,
  onAssistantDelta,
  onInterrupted,
  onSessionRestarted,
  onTurnComplete,
}: UseLiveVoiceProps) {
  const [state, setState] = useState<LiveVoiceState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState("Gemini Live voice is ready.");
  const [userPreview, setUserPreview] = useState("");
  const [assistantPreview, setAssistantPreview] = useState("");
  const [muted, setMuted] = useState(false);
  const stateRef = useRef<LiveVoiceState>("idle");

  useEffect(() => {
    stateRef.current = state;
    if (state === "working") {
      setElapsed(0);
      const interval = setInterval(() => {
        setElapsed((e) => e + 1);
      }, 1000);
      return () => clearInterval(interval);
    } else {
      setElapsed(0);
    }
  }, [state]);

  const mutedRef = useRef(false);
  const websocketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const bufferedAudioRef = useRef<string[]>([]);
  const reconnectTimerRef = useRef<number | null>(null);
  const toolResultFallbackTimerRef = useRef<number | null>(null);
  const manuallyStoppedRef = useRef(false);
  const usedCodexRef = useRef(false);
  const audioPlayerRef = useRef<AudioStreamPlayer | null>(null);
  const hasStreamedAudioRef = useRef(false);
  const reconnectNoticeSentRef = useRef(false);
  const connectSocketRef = useRef<(() => WebSocket | undefined) | null>(null);
  const stopRef = useRef<(() => Promise<void>) | null>(null);
  const audioSentSinceTurnEndRef = useRef(false);
  const voiceTurnActiveRef = useRef(false);
  const lastSpeechActivityAtRef = useRef(0);
  const pendingSpeechRef = useRef<string | null>(null);
  const pendingSpeechTimerRef = useRef<number | null>(null);

  const clearToolResultFallback = useCallback(() => {
    if (toolResultFallbackTimerRef.current) {
      window.clearTimeout(toolResultFallbackTimerRef.current);
      toolResultFallbackTimerRef.current = null;
    }
  }, []);

  const clearPendingSpeechTimer = useCallback(() => {
    if (pendingSpeechTimerRef.current) {
      window.clearTimeout(pendingSpeechTimerRef.current);
      pendingSpeechTimerRef.current = null;
    }
  }, []);

  const getAudioPlayer = () => {
    if (!audioPlayerRef.current) {
      audioPlayerRef.current = new AudioStreamPlayer();
    }
    audioPlayerRef.current.init();
    return audioPlayerRef.current;
  };
  const cbRef = useRef({
    onAudio,
    onDebug,
    onHandoff,
    onHandoffStart,
    onHandoffProgress,
    onHandoffFailed,
    onHandoffDeliveryFailed,
    onHandoffTimeout,
    onCodexEvent,
    onUserTranscript,
    onAssistantDelta,
    onInterrupted,
    onSessionRestarted,
    onTurnComplete,
    getWorkdir,
    getProjectId,
    getChatId,
  });

  useEffect(() => {
    cbRef.current = {
      onAudio,
      onDebug,
      onHandoff,
      onHandoffStart,
      onHandoffProgress,
      onHandoffFailed,
      onHandoffDeliveryFailed,
      onHandoffTimeout,
      onCodexEvent,
      onUserTranscript,
      onAssistantDelta,
      onInterrupted,
      onSessionRestarted,
      onTurnComplete,
      getWorkdir,
      getProjectId,
      getChatId,
    };
  }, [
    onAudio,
    onDebug,
    onHandoff,
    onHandoffStart,
    onHandoffProgress,
    onHandoffFailed,
    onHandoffDeliveryFailed,
    onHandoffTimeout,
    onCodexEvent,
    onUserTranscript,
    onAssistantDelta,
    onInterrupted,
    onSessionRestarted,
    onTurnComplete,
    getWorkdir,
    getProjectId,
    getChatId,
  ]);

  const log = useCallback((text: string) => cbRef.current.onDebug(text), []);

  const endCurrentAudioTurn = useCallback(() => {
    if (!audioSentSinceTurnEndRef.current) return;
    const websocket = websocketRef.current;
    if (websocket?.readyState !== WebSocket.OPEN) return;
    websocket.send(JSON.stringify({ type: "stop" }));
    audioSentSinceTurnEndRef.current = false;
    log("[Audio] Finalized current voice turn.");
  }, [log]);

  const setInputMuted = useCallback(
    (next: boolean) => {
      const wasMuted = mutedRef.current;
      mutedRef.current = next;
      setMuted(next);
      if (next && !wasMuted) {
        endCurrentAudioTurn();
      }
      log(
        next
          ? "Microphone muted. Gemini is finalizing the current voice turn."
          : "Microphone unmuted.",
      );
    },
    [endCurrentAudioTurn, log],
  );

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      mutedRef.current = next;
      if (next && !m) {
        endCurrentAudioTurn();
      }
      log(
        next
          ? "Microphone muted. Gemini is finalizing the current voice turn."
          : "Microphone unmuted.",
      );
      return next;
    });
  }, [endCurrentAudioTurn, log]);

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

  const sendAudioInput = useCallback((input: Float32Array, sampleRate: number) => {
    if (mutedRef.current) return;
    if (audioContainsSpeech(input)) {
      lastSpeechActivityAtRef.current = Date.now();
    }
    const payload = JSON.stringify({
      type: "audio",
      mime_type: `audio/pcm;rate=${LIVE_AUDIO_RATE}`,
      data: encodePcmChunk(input, sampleRate),
    });
    const websocket = websocketRef.current;
    if (websocket?.readyState === WebSocket.OPEN) {
      websocket.send(payload);
      audioSentSinceTurnEndRef.current = true;
      return;
    }
    bufferedAudioRef.current.push(payload);
    if (bufferedAudioRef.current.length > MAX_BUFFERED_AUDIO_CHUNKS) {
      bufferedAudioRef.current.splice(
        0,
        bufferedAudioRef.current.length - MAX_BUFFERED_AUDIO_CHUNKS,
      );
    }
  }, []);

  const sendSessionConfig = useCallback(
    (websocket: WebSocket) => {
      const workdir = cbRef.current.getWorkdir();
      const projectId = cbRef.current.getProjectId();
      const chatId = cbRef.current.getChatId();
      if (!workdir || websocket.readyState !== WebSocket.OPEN) return;
      log(`[Config] Sending session config: chatId=${chatId}, workdir=${workdir}`);
      websocket.send(
        JSON.stringify({
          type: "config",
          workdir,
          project_id: projectId,
          chat_id: chatId,
        }),
      );
    },
    [log],
  );

  const flushPendingSpeech = useCallback(() => {
    clearPendingSpeechTimer();
    const text = pendingSpeechRef.current;
    if (!text) return;
    const websocket = websocketRef.current;
    const canSpeakNow =
      websocket?.readyState === WebSocket.OPEN &&
      !["idle", "connecting", "error"].includes(stateRef.current) &&
      isClearToReadCompletedResult({
        voiceTurnActive: voiceTurnActiveRef.current,
        lastSpeechAt: lastSpeechActivityAtRef.current,
        now: Date.now(),
      });
    if (!canSpeakNow) {
      pendingSpeechTimerRef.current = window.setTimeout(flushPendingSpeech, SPEAK_RESULT_RETRY_MS);
      return;
    }
    pendingSpeechRef.current = null;
    websocket.send(JSON.stringify({ type: "speak_text", text }));
    setState("thinking");
    setMessage("Reading the completed Codex result.");
    log("[Voice] Queued completed Codex result for speech.");
  }, [clearPendingSpeechTimer, log]);

  const requestSpeech = useCallback(
    (text: string) => {
      const spokenText = text.trim();
      if (!spokenText) return;
      pendingSpeechRef.current = spokenText;
      flushPendingSpeech();
    },
    [flushPendingSpeech],
  );

  const stop = useCallback(async () => {
    log("[Stop] Stopping session and microphone...");
    manuallyStoppedRef.current = true;
    setMuted(false);
    mutedRef.current = false;
    audioSentSinceTurnEndRef.current = false;
    voiceTurnActiveRef.current = false;
    lastSpeechActivityAtRef.current = 0;
    clearPendingSpeechTimer();
    pendingSpeechRef.current = null;
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    clearToolResultFallback();
    bufferedAudioRef.current = [];
    audioPlayerRef.current?.stop();
    await stopMicrophone();
    if (websocketRef.current?.readyState === WebSocket.OPEN) {
      websocketRef.current.send(JSON.stringify({ type: "close" }));
    }
    websocketRef.current?.close();
    websocketRef.current = null;
    setState("idle");
    setMessage("Gemini Live voice is ready.");
    log("[Stop] Session stopped successfully.");
  }, [clearPendingSpeechTimer, clearToolResultFallback, stopMicrophone, log]);

  const connectSocket = useCallback(() => {
    const websocket = new WebSocket(getWebSocketUrl("/api/live"));
    websocketRef.current = websocket;

    websocket.onopen = () => {
      reconnectNoticeSentRef.current = false;
      log("Live channel connected.");
      sendSessionConfig(websocket);
      flushBufferedAudio(websocket);
      setState("live");
      setMessage("Live with Gemini — speak naturally, pause to let the agent answer.");
      websocket.onmessage = (event) => {
        const payload = JSON.parse(event.data);
        if (payload.type === "ready" || payload.type === "debug") {
          log(payload.message || payload.type);
        } else if (payload.type === "user_transcript") {
          clearToolResultFallback();
          voiceTurnActiveRef.current = true;
          log(`[User Transcript] ${payload.text || ""}`);
          setUserPreview((current) => `${current}${payload.text || ""}`);
          setState("thinking");
          setMessage("Heard you — composing a reply.");
          cbRef.current.onUserTranscript?.(payload.text || "");
        } else if (payload.type === "assistant_delta") {
          clearToolResultFallback();
          voiceTurnActiveRef.current = true;
          log(`[Assistant Delta] ${payload.text || ""}`);
          setAssistantPreview((current) => `${current}${payload.text || ""}`);
          setState("thinking");
          setMessage("Gemini is replying.");
          cbRef.current.onAssistantDelta?.(payload.text || "");
        } else if (payload.type === "turn_complete") {
          clearToolResultFallback();
          const userText = String(payload.user_text || "").trim();
          const assistantText = String(payload.assistant_text || "").trim();
          log(
            `[Turn Complete] user_chars=${userText.length}, assistant_chars=${assistantText.length}, session_ended=${payload.session_ended}`,
          );
          cbRef.current.onTurnComplete?.(
            userText,
            assistantText,
            usedCodexRef.current,
            payload.workdir,
            payload.gemini_live_usage,
          );
          usedCodexRef.current = false;
          if (payload.audio_data_url && !hasStreamedAudioRef.current) {
            cbRef.current.onAudio(payload.audio_data_url);
          }
          hasStreamedAudioRef.current = false;
          audioSentSinceTurnEndRef.current = false;
          voiceTurnActiveRef.current = false;
          flushPendingSpeech();
          setUserPreview("");
          setAssistantPreview("");
          if (payload.session_ended) {
            log("Conversation completed. Initiating graceful disconnect...");
            const checkAndStop = () => {
              const player = audioPlayerRef.current;
              if (player && player.isPlaying()) {
                setTimeout(checkAndStop, 200);
              } else {
                setTimeout(() => {
                  void stopRef.current?.();
                }, 300);
              }
            };
            setTimeout(checkAndStop, 500);
          } else {
            setState("live");
            setMessage("Live with Gemini — speak again when ready.");
          }
        } else if (payload.type === "interrupted") {
          setAssistantPreview("");
          voiceTurnActiveRef.current = false;
          audioPlayerRef.current?.stop();
          cbRef.current.onInterrupted?.();
          log("Response interrupted by new speech.");
        } else if (payload.type === "assistant_audio_delta") {
          voiceTurnActiveRef.current = true;
          const audioB64 = payload.data;
          if (audioB64) {
            try {
              const float32 = base64ToFloat32Array(audioB64);
              getAudioPlayer().playChunk(float32);
              if (!hasStreamedAudioRef.current) {
                log("[Assistant Audio] Started receiving audio stream.");
              }
              hasStreamedAudioRef.current = true;
            } catch (err) {
              log(`Error playing audio chunk: ${String(err)}`);
            }
          }
        } else if (payload.type === "tool_call_started") {
          clearToolResultFallback();
          usedCodexRef.current = true;
          setState("working");
          setMessage(`Codex is running: ${payload.task || ""}`);
          cbRef.current.onHandoffStart?.(
            payload.name || "run_codex_task",
            payload.task || "",
            payload.workdir || "",
          );
          log(`[Tool Call Started] ${payload.name || "tool"}. Task: "${payload.task || ""}"`);
        } else if (payload.type === "tool_progress") {
          setUserPreview("");
          setAssistantPreview((current) => `${current}${payload.text || ""}`);
          cbRef.current.onHandoffProgress?.(payload.name || "run_codex_task", payload.text || "");
        } else if (payload.type === "codex_event") {
          cbRef.current.onCodexEvent?.(payload.event);
          if (payload.event?.summary) {
            setMessage(payload.event.summary);
            log(`[Codex Event] ${payload.event.summary}`);
          }
        } else if (payload.type === "status") {
          setMessage(payload.message || "Codex is working...");
          log(`[Status] ${payload.message}`);
        } else if (payload.type === "tool_call_failed") {
          clearToolResultFallback();
          setState("thinking");
          setMessage("Codex task failed.");
          setAssistantPreview("");
          cbRef.current.onHandoffFailed?.(
            payload.name || "run_codex_task",
            payload.message || "Codex task failed.",
          );
          log(`[Tool Call Failed] ${payload.name || "tool"}: ${payload.message}`);
        } else if (payload.type === "tool_result") {
          usedCodexRef.current = true;
          if (payload.background_job_id) {
            setState("working");
            setMessage("Codex is running in the background.");
          } else {
            setState("thinking");
            setMessage("Codex task completed. Gemini is formulating a response.");
          }
          setAssistantPreview("");
          cbRef.current.onHandoff(
            payload.name || "run_codex_task",
            String(payload.result || "").trim() || "Codex task completed.",
            payload.workdir || "",
            payload,
          );
          clearToolResultFallback();
          if (!payload.background_job_id) {
            toolResultFallbackTimerRef.current = window.setTimeout(() => {
              setState("live");
              setMessage(
                "Codex result is available in chat. Gemini did not finish a final response.",
              );
              cbRef.current.onHandoffTimeout?.();
              log(
                "Gemini did not finish after Codex completed; surfaced the Codex result in chat.",
              );
              toolResultFallbackTimerRef.current = null;
            }, TOOL_RESULT_FALLBACK_MS);
          }
          log(
            `[Tool Call Completed] ${payload.name || "tool"}. Result length: ${payload.result?.length || 0} chars.`,
          );
        } else if (payload.type === "tool_result_gemini_delivery_failed") {
          clearToolResultFallback();
          const deliveryFailureMessage = liveVoiceDeliveryFailureMessage(payload.message);
          setState("connecting");
          setMessage("Codex result is available in chat. Gemini is reconnecting with the result.");
          cbRef.current.onHandoffDeliveryFailed?.(deliveryFailureMessage);
          log(`[Tool Result Delivery Failed] ${deliveryFailureMessage}`);
        } else if (payload.type === "background_job_completed") {
          const result = String(payload.result || "Codex background task completed.").trim();
          const handoffId = String(payload.handoff?.id || "");
          setAssistantPreview("");
          cbRef.current.onHandoff("run_codex_task", result, payload.handoff?.workdir || "", {
            ...payload,
            codex_status: payload.handoff?.codex_status || "completed",
          });
          if (handoffId && websocket.readyState === WebSocket.OPEN) {
            websocket.send(
              JSON.stringify({ type: "background_completion_received", handoff_id: handoffId }),
            );
          }
          requestSpeech(result);
          log("[Codex] Received server-delivered background completion.");
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
        setMessage(
          "Gemini Live is reconnecting. Context is preserved up to your last completed turn.",
        );
        if (!reconnectNoticeSentRef.current) {
          reconnectNoticeSentRef.current = true;
          cbRef.current.onSessionRestarted?.();
          log("Gemini Live session restarted; context is preserved up to the last completed turn.");
        }
        if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null;
          connectSocketRef.current?.();
        }, RECONNECT_DELAY_MS);
        return;
      }
      setState("idle");
      setMessage("Gemini Live voice is ready.");
    };

    return websocket;
  }, [
    clearToolResultFallback,
    flushBufferedAudio,
    flushPendingSpeech,
    log,
    requestSpeech,
    sendSessionConfig,
    stopMicrophone,
  ]);

  useEffect(() => {
    connectSocketRef.current = connectSocket;
  }, [connectSocket]);

  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const start = useCallback(async () => {
    if (state === "connecting" || state === "live" || state === "thinking" || state === "working")
      return;
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
    audioSentSinceTurnEndRef.current = false;
    voiceTurnActiveRef.current = false;
    lastSpeechActivityAtRef.current = 0;
    bufferedAudioRef.current = [];
    clearPendingSpeechTimer();
    pendingSpeechRef.current = null;
    clearToolResultFallback();
    hasStreamedAudioRef.current = false;
    try {
      getAudioPlayer();
    } catch {
      // Audio context creation can be blocked until the user interacts again.
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);

      streamRef.current = stream;
      contextRef.current = audioContext;
      sourceRef.current = source;

      let micWorkletNode: AudioWorkletNode | null = null;
      const hasWorklet = typeof audioContext.audioWorklet !== "undefined";

      if (hasWorklet) {
        const micCode = `
          class MicProcessor extends AudioWorkletProcessor {
            process(inputs, outputs, parameters) {
              const input = inputs[0];
              if (input && input.length > 0) {
                const channelData = input[0];
                this.port.postMessage(new Float32Array(channelData));
              }
              return true;
            }
          }
          registerProcessor('mic-processor', MicProcessor);
        `;
        const blob = new Blob([micCode], { type: "application/javascript" });
        const url = URL.createObjectURL(blob);
        try {
          await audioContext.audioWorklet.addModule(url);
          URL.revokeObjectURL(url);
          micWorkletNode = new AudioWorkletNode(audioContext, "mic-processor");
          processorRef.current = micWorkletNode;

          micWorkletNode.port.onmessage = (event) => {
            sendAudioInput(event.data, audioContext.sampleRate);
          };

          source.connect(micWorkletNode);
          micWorkletNode.connect(audioContext.destination);
        } catch (workletErr) {
          console.warn(
            "Failed to load mic audio worklet, falling back to script processor",
            workletErr,
          );
          micWorkletNode = null;
        }
      }

      if (!micWorkletNode) {
        log("Microphone AudioWorklet unavailable; using ScriptProcessor fallback.");
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (event) => {
          sendAudioInput(event.inputBuffer.getChannelData(0), audioContext.sampleRate);
        };

        source.connect(processor);
        processor.connect(audioContext.destination);
      }

      connectSocket();
    } catch (err) {
      await stopMicrophone();
      websocketRef.current?.close();
      websocketRef.current = null;
      setState("error");
      setMessage(err instanceof Error ? err.message : "Could not start live voice.");
    }
  }, [
    clearPendingSpeechTimer,
    clearToolResultFallback,
    connectSocket,
    log,
    sendAudioInput,
    state,
    stopMicrophone,
  ]);

  const cancelTask = useCallback(() => {
    if (websocketRef.current?.readyState === WebSocket.OPEN) {
      websocketRef.current.send(JSON.stringify({ type: "cancel_task" }));
    }
  }, []);

  const completeBackgroundCodexJob = useCallback(() => {
    if (stateRef.current !== "working") return;
    setState("live");
    setMessage("Live with Gemini — speak again when ready.");
    log("[Codex] Background task settled; cleared working status.");
  }, [log]);

  useEffect(
    () => () => {
      clearToolResultFallback();
      void stop();
    },
    [clearToolResultFallback, stop],
  );

  return {
    active:
      state === "connecting" || state === "live" || state === "thinking" || state === "working",
    supported: Boolean(
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
      typeof window.AudioContext !== "undefined" &&
      typeof window.WebSocket !== "undefined",
    ),
    state,
    elapsed,
    message,
    transcriptPreview: userPreview || assistantPreview,
    muted,
    setMuted: setInputMuted,
    toggleMute,
    start,
    stop,
    cancelTask,
    completeBackgroundCodexJob,
    requestSpeech,
  };
}
