import { useCallback, useEffect, useRef, useState } from "react";
import type { CodexTimelineEvent, CodingHarness, GeminiLiveUsage, LiveVoiceState } from "../types";
import type { ServerEvent } from "../types/protocol";
import { parseServerEventJson } from "../types/protocol.ts";
import { getWebSocketUrl } from "../services/api";
import {
  AudioStreamPlayer,
  MicrophoneCapture,
  MAX_BUFFERED_AUDIO_CHUNKS,
  LIVE_AUDIO_RATE,
  base64ToFloat32Array,
  encodePcmChunk,
} from "./liveVoiceAudio";
import { liveVoiceStartDeliveryFailureMessage } from "../utils/liveVoice";
import { audioContainsSpeech, isClearToReadCompletedResult } from "../utils/liveVoiceSpeech";
import { useLiveVoiceStatus } from "./useLiveVoiceStatus";

const RECONNECT_DELAY_MS = 900;
// Gemini Live currently starts retiring a connection at roughly ten minutes.
// Rotate before that warning, but only after the current turn has settled.
const PROACTIVE_SESSION_REFRESH_MS = 8 * 60 * 1000 + 30 * 1000;
// Backend Codex status events start after about 20s, then repeat every 60s.
// This waits slightly longer than the first status event before surfacing a
// completed Codex result when Gemini does not produce a final voice response.
const TOOL_RESULT_FALLBACK_MS = 25000;
const SPEAK_RESULT_RETRY_MS = 700;

interface UseLiveVoiceProps {
  getWorkdir: () => string | undefined;
  getProjectId: () => string | undefined;
  getChatId: () => string | undefined;
  getCodingHarness: () => CodingHarness;
  getCodingModel: () => string | undefined;
  getCodingEffort: () => string | undefined;
  onAudio: (audioUrl: string) => void;
  onDebug: (message: string) => void;
  onHandoff: (name: string, summary: string, workdir?: string, details?: ServerEvent) => void;
  onHandoffStart?: (name: string, task: string, workdir: string, harness: CodingHarness) => void;
  onHandoffProgress?: (name: string, text: string) => void;
  onHandoffFailed?: (name: string, message: string) => void;
  onHandoffStartDeliveryFailed?: (message: string) => void;
  onHandoffTimeout?: () => void;
  onCodexEvent?: (event: CodexTimelineEvent) => void;
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
  getCodingHarness,
  getCodingModel,
  getCodingEffort,
  onAudio,
  onDebug,
  onHandoff,
  onHandoffStart,
  onHandoffProgress,
  onHandoffFailed,
  onHandoffStartDeliveryFailed,
  onHandoffTimeout,
  onCodexEvent,
  onUserTranscript,
  onAssistantDelta,
  onInterrupted,
  onSessionRestarted,
  onTurnComplete,
}: UseLiveVoiceProps) {
  const { state, message, elapsed, transition, describe } = useLiveVoiceStatus();
  const [userPreview, setUserPreview] = useState("");
  const [assistantPreview, setAssistantPreview] = useState("");
  const [muted, setMuted] = useState(false);
  const stateRef = useRef<LiveVoiceState>("idle");

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const mutedRef = useRef(false);
  const websocketRef = useRef<WebSocket | null>(null);
  const microphoneRef = useRef(new MicrophoneCapture());
  const bufferedAudioRef = useRef<string[]>([]);
  const reconnectTimerRef = useRef<number | null>(null);
  const sessionRefreshTimerRef = useRef<number | null>(null);
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
  const gracefulStopTimerRef = useRef<number | null>(null);
  const sessionRefreshRequestedRef = useRef(false);
  const playbackIdleCallbackRef = useRef<() => void>(() => undefined);

  const clearToolResultFallback = useCallback(() => {
    if (toolResultFallbackTimerRef.current !== null) {
      window.clearTimeout(toolResultFallbackTimerRef.current);
      toolResultFallbackTimerRef.current = null;
    }
  }, []);

  const clearPendingSpeechTimer = useCallback(() => {
    if (pendingSpeechTimerRef.current !== null) {
      window.clearTimeout(pendingSpeechTimerRef.current);
      pendingSpeechTimerRef.current = null;
    }
  }, []);

  const clearSessionRefreshTimer = useCallback(() => {
    if (sessionRefreshTimerRef.current !== null) {
      window.clearTimeout(sessionRefreshTimerRef.current);
      sessionRefreshTimerRef.current = null;
    }
  }, []);

  const clearGracefulStopTimer = useCallback(() => {
    if (gracefulStopTimerRef.current !== null) {
      window.clearTimeout(gracefulStopTimerRef.current);
      gracefulStopTimerRef.current = null;
    }
  }, []);

  const getAudioPlayer = () => {
    if (!audioPlayerRef.current) {
      audioPlayerRef.current = new AudioStreamPlayer(() => playbackIdleCallbackRef.current());
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
    onHandoffStartDeliveryFailed,
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
    getCodingHarness,
    getCodingModel,
    getCodingEffort,
  });

  useEffect(() => {
    cbRef.current = {
      onAudio,
      onDebug,
      onHandoff,
      onHandoffStart,
      onHandoffProgress,
      onHandoffFailed,
      onHandoffStartDeliveryFailed,
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
      getCodingHarness,
      getCodingModel,
      getCodingEffort,
    };
  }, [
    onAudio,
    onDebug,
    onHandoff,
    onHandoffStart,
    onHandoffProgress,
    onHandoffFailed,
    onHandoffStartDeliveryFailed,
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
    getCodingHarness,
    getCodingModel,
    getCodingEffort,
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
    setInputMuted(!mutedRef.current);
  }, [setInputMuted]);

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
      const harness = cbRef.current.getCodingHarness();
      if (!workdir || websocket.readyState !== WebSocket.OPEN) return;
      log(`[Config] Sending session config: chatId=${chatId}, workdir=${workdir}`);
      websocket.send(
        JSON.stringify({
          type: "config",
          workdir,
          project_id: projectId,
          chat_id: chatId,
          harness,
          model: cbRef.current.getCodingModel(),
          reasoning_effort: cbRef.current.getCodingEffort(),
        }),
      );
    },
    [log],
  );

  const flushPendingSpeech = useCallback(
    function flushPendingSpeechCallback() {
      clearPendingSpeechTimer();
      const text = pendingSpeechRef.current;
      if (!text) return;
      const websocket = websocketRef.current;
      const canSpeakNow =
        websocket?.readyState === WebSocket.OPEN &&
        !["idle", "connecting", "reconnecting", "error"].includes(stateRef.current) &&
        isClearToReadCompletedResult({
          voiceTurnActive: voiceTurnActiveRef.current,
          lastSpeechAt: lastSpeechActivityAtRef.current,
          now: Date.now(),
        });
      if (!canSpeakNow) {
        pendingSpeechTimerRef.current = window.setTimeout(
          flushPendingSpeechCallback,
          SPEAK_RESULT_RETRY_MS,
        );
        return;
      }
      pendingSpeechRef.current = null;
      websocket.send(JSON.stringify({ type: "speak_text", text }));
      transition("thinking", "Reading the completed coding agent result.");
      log("[Voice] Queued completed coding agent result for speech.");
    },
    [clearPendingSpeechTimer, log, transition],
  );

  const requestSpeech = useCallback(
    (text: string) => {
      const spokenText = text.trim();
      if (!spokenText) return;
      pendingSpeechRef.current = spokenText;
      flushPendingSpeech();
    },
    [flushPendingSpeech],
  );

  const refreshGeminiSession = useCallback(() => {
    if (manuallyStoppedRef.current) return;
    const websocket = websocketRef.current;
    if (!websocket || websocket.readyState === WebSocket.CLOSED) return;

    // A connection rotation must never cut off either side of a voice turn, or
    // a sentence that has started reaching the microphone but is not transcribed
    // yet. Keep the request pending; turn_complete retries it at a safe pause.
    // If Gemini reaches its hard limit first, normal reconnect remains the fallback.
    const safePause = isClearToReadCompletedResult({
      voiceTurnActive: voiceTurnActiveRef.current || Boolean(audioPlayerRef.current?.isPlaying()),
      lastSpeechAt: lastSpeechActivityAtRef.current,
      now: Date.now(),
    });
    if (!safePause) {
      sessionRefreshRequestedRef.current = true;
      return;
    }

    sessionRefreshRequestedRef.current = false;
    clearSessionRefreshTimer();
    transition("reconnecting", "Reconnecting Gemini — your conversation is being preserved.");
    log("[Session] Refreshing Gemini connection before it expires.");
    if (websocket.readyState === WebSocket.OPEN) {
      websocket.send(JSON.stringify({ type: "close" }));
    }
    websocket.close();
  }, [clearSessionRefreshTimer, log, transition]);

  const onPlaybackIdle = useCallback(() => {
    if (sessionRefreshRequestedRef.current) {
      refreshGeminiSession();
    }
  }, [refreshGeminiSession]);

  useEffect(() => {
    playbackIdleCallbackRef.current = onPlaybackIdle;
  }, [onPlaybackIdle]);

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
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    clearSessionRefreshTimer();
    clearToolResultFallback();
    clearGracefulStopTimer();
    bufferedAudioRef.current = [];
    audioPlayerRef.current?.stop();
    await microphoneRef.current.stop();
    if (websocketRef.current?.readyState === WebSocket.OPEN) {
      websocketRef.current.send(JSON.stringify({ type: "close" }));
    }
    websocketRef.current?.close();
    websocketRef.current = null;
    transition("idle", "Gemini Live voice is ready.");
    log("[Stop] Session stopped successfully.");
  }, [
    clearGracefulStopTimer,
    clearPendingSpeechTimer,
    clearSessionRefreshTimer,
    clearToolResultFallback,
    log,
    transition,
  ]);

  const connectSocket = useCallback(() => {
    const websocket = new WebSocket(getWebSocketUrl("/api/live"));
    websocketRef.current = websocket;

    websocket.onopen = () => {
      reconnectNoticeSentRef.current = false;
      sessionRefreshRequestedRef.current = false;
      log("Live channel connected.");
      sendSessionConfig(websocket);
      flushBufferedAudio(websocket);
      transition("live", "Live with Gemini — speak naturally, pause to let the agent answer.");
      clearSessionRefreshTimer();
      sessionRefreshTimerRef.current = window.setTimeout(() => {
        sessionRefreshTimerRef.current = null;
        sessionRefreshRequestedRef.current = true;
        refreshGeminiSession();
      }, PROACTIVE_SESSION_REFRESH_MS);
      websocket.onmessage = (event) => {
        const payload = parseServerEventJson(String(event.data));
        if (!payload) {
          log("Ignored an invalid live server event.");
          return;
        }
        if (payload.type === "ready" || payload.type === "debug") {
          log(payload.message || payload.type);
        } else if (payload.type === "user_transcript") {
          clearToolResultFallback();
          voiceTurnActiveRef.current = true;
          log(`[User Transcript] ${payload.text || ""}`);
          setUserPreview((current) => `${current}${payload.text || ""}`);
          transition("thinking", "Heard you — composing a reply.");
          cbRef.current.onUserTranscript?.(payload.text || "");
        } else if (payload.type === "assistant_delta") {
          clearToolResultFallback();
          voiceTurnActiveRef.current = true;
          // log(`[Assistant Delta] ${payload.text || ""}`);
          setAssistantPreview((current) => `${current}${payload.text || ""}`);
          transition("thinking", "Gemini is replying.");
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
          if (sessionRefreshRequestedRef.current) {
            refreshGeminiSession();
          }
          setUserPreview("");
          setAssistantPreview("");
          if (payload.session_ended) {
            log("Conversation completed. Initiating graceful disconnect...");
            clearGracefulStopTimer();
            const scheduleStopCheck = (callback: () => void, delay: number) => {
              gracefulStopTimerRef.current = window.setTimeout(() => {
                gracefulStopTimerRef.current = null;
                callback();
              }, delay);
            };
            const checkAndStop = () => {
              const player = audioPlayerRef.current;
              if (player && player.isPlaying()) {
                scheduleStopCheck(checkAndStop, 200);
              } else {
                scheduleStopCheck(() => void stopRef.current?.(), 300);
              }
            };
            scheduleStopCheck(checkAndStop, 500);
          } else {
            transition("live", "Live with Gemini — speak again when ready.");
          }
        } else if (payload.type === "interrupted") {
          setAssistantPreview("");
          voiceTurnActiveRef.current = false;
          audioPlayerRef.current?.stop();
          cbRef.current.onInterrupted?.();
          log("Response interrupted by new speech.");
        } else if (payload.type === "session_refresh_requested") {
          sessionRefreshRequestedRef.current = true;
          log(
            `[Session] Gemini requested a refresh with ${payload.time_left || "limited"} remaining.`,
          );
          refreshGeminiSession();
        } else if (payload.type === "session_resume_failed") {
          transition("reconnecting", "Reconnecting Gemini from your saved chat.");
          log(payload.message || "Saved Gemini session could not resume; using chat context.");
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
          const provider = payload.harness === "claude" ? "Claude" : "Codex";
          transition("working", `${provider} is running: ${payload.task || ""}`);
          cbRef.current.onHandoffStart?.(
            payload.name || "run_codex_task",
            payload.task || "",
            payload.workdir || "",
            payload.harness === "claude" ? "claude" : "codex",
          );
          log(`[Tool Call Started] ${payload.name || "tool"}. Task: "${payload.task || ""}"`);
        } else if (payload.type === "tool_progress") {
          setUserPreview("");
          setAssistantPreview((current) => `${current}${payload.text || ""}`);
          cbRef.current.onHandoffProgress?.(payload.name || "run_codex_task", payload.text || "");
        } else if (payload.type === "codex_event") {
          if (payload.event) cbRef.current.onCodexEvent?.(payload.event);
          if (payload.event?.summary) {
            describe(payload.event.summary);
            log(`[Coding Agent Event] ${payload.event.summary}`);
          }
        } else if (payload.type === "status") {
          describe(payload.message || "The coding agent is working...");
          log(`[Status] ${payload.message}`);
        } else if (payload.type === "tool_call_failed") {
          clearToolResultFallback();
          const provider = payload.harness === "claude" ? "Claude" : "Codex";
          transition("thinking", `${provider} task failed.`);
          setAssistantPreview("");
          cbRef.current.onHandoffFailed?.(
            payload.name || "run_codex_task",
            payload.message || `${provider} task failed.`,
          );
          log(`[Tool Call Failed] ${payload.name || "tool"}: ${payload.message}`);
        } else if (payload.type === "tool_result") {
          usedCodexRef.current = true;
          const provider = payload.harness === "claude" ? "Claude" : "Codex";
          if (payload.background_job_id) {
            transition("working", `${provider} is running in the background.`);
          } else {
            transition("thinking", `${provider} task completed. Vodex is formulating a response.`);
          }
          setAssistantPreview("");
          cbRef.current.onHandoff(
            payload.name || "run_codex_task",
            String(payload.result || "").trim() || `${provider} task completed.`,
            payload.workdir || "",
            payload,
          );
          clearToolResultFallback();
          if (!payload.background_job_id) {
            toolResultFallbackTimerRef.current = window.setTimeout(() => {
              transition(
                "live",
                `${provider} result is available in chat. Vodex did not finish a final response.`,
              );
              cbRef.current.onHandoffTimeout?.();
              log(
                `Gemini did not finish after ${provider} completed; surfaced the ${provider} result in chat.`,
              );
              toolResultFallbackTimerRef.current = null;
            }, TOOL_RESULT_FALLBACK_MS);
          }
          log(
            `[Tool Call Completed] ${payload.name || "tool"}. Result length: ${String(payload.result || "").length} chars.`,
          );
        } else if (payload.type === "tool_start_gemini_delivery_failed") {
          clearToolResultFallback();
          const deliveryFailureMessage = liveVoiceStartDeliveryFailureMessage(payload.message);
          const provider = payload.harness === "claude" ? "Claude" : "Codex";
          transition(
            "working",
            `${provider} is still running. Vodex is reconnecting to follow its progress.`,
          );
          cbRef.current.onHandoffStartDeliveryFailed?.(deliveryFailureMessage);
          log(`[Tool Start Delivery Failed] ${deliveryFailureMessage}`);
        } else if (payload.type === "gemini_tool_response_delivery_failed") {
          transition("reconnecting", "Gemini is reconnecting after missing a tool response.");
          log(`[Tool Response Delivery Failed] ${payload.message}`);
        } else if (payload.type === "background_job_completed") {
          const provider = payload.harness === "claude" ? "Claude" : "Codex";
          const result = String(payload.result || `${provider} background task completed.`).trim();
          const handoffId = String(payload.handoff?.id || "");
          setAssistantPreview("");
          cbRef.current.onHandoff("run_codex_task", result, payload.handoff?.workdir || "", {
            ...payload,
            background_job_id: payload.background_job_id || "",
            workdir: payload.handoff?.workdir || "",
            codex_status: payload.handoff?.codex_status || "completed",
          });
          if (handoffId && websocket.readyState === WebSocket.OPEN) {
            websocket.send(
              JSON.stringify({ type: "background_completion_received", handoff_id: handoffId }),
            );
          }
          requestSpeech(result);
          log(`[${provider}] Received server-delivered background completion.`);
        } else if (payload.type === "error") {
          transition("error", payload.message || "Live voice failed.");
          log(`Live voice error: ${payload.message || "unknown error"}`);
        }
      };
    };

    websocket.onerror = () => log("Live channel error.");

    websocket.onclose = () => {
      websocketRef.current = null;
      clearSessionRefreshTimer();
      if (manuallyStoppedRef.current) {
        void microphoneRef.current.stop();
        transition("idle", "Gemini Live voice is ready.");
        return;
      }
      if (microphoneRef.current.isActive()) {
        transition("reconnecting", "Reconnecting Gemini — your conversation is being preserved.");
        if (!reconnectNoticeSentRef.current) {
          reconnectNoticeSentRef.current = true;
          cbRef.current.onSessionRestarted?.();
          log("Gemini Live session restarted; context is preserved up to the last completed turn.");
        }
        if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null;
          connectSocketRef.current?.();
        }, RECONNECT_DELAY_MS);
        return;
      }
      transition("idle", "Gemini Live voice is ready.");
    };

    return websocket;
  }, [
    clearToolResultFallback,
    clearGracefulStopTimer,
    clearSessionRefreshTimer,
    flushBufferedAudio,
    flushPendingSpeech,
    log,
    refreshGeminiSession,
    requestSpeech,
    sendSessionConfig,
    describe,
    transition,
  ]);

  useEffect(() => {
    connectSocketRef.current = connectSocket;
  }, [connectSocket]);

  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const start = useCallback(async () => {
    if (
      state === "connecting" ||
      state === "reconnecting" ||
      state === "live" ||
      state === "thinking" ||
      state === "working"
    )
      return;
    if (!navigator.mediaDevices?.getUserMedia || typeof window.AudioContext === "undefined") {
      transition("error", "This browser cannot open live microphone audio.");
      return;
    }
    transition("connecting", "Connecting live microphone to Gemini.");
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
    clearGracefulStopTimer();
    clearPendingSpeechTimer();
    pendingSpeechRef.current = null;
    sessionRefreshRequestedRef.current = false;
    clearSessionRefreshTimer();
    clearToolResultFallback();
    hasStreamedAudioRef.current = false;
    try {
      getAudioPlayer();
    } catch {
      // Audio context creation can be blocked until the user interacts again.
    }

    try {
      await microphoneRef.current.start(sendAudioInput, () => {
        log("Microphone AudioWorklet unavailable; using ScriptProcessor fallback.");
      });
      connectSocket();
    } catch (err) {
      await microphoneRef.current.stop();
      websocketRef.current?.close();
      websocketRef.current = null;
      transition("error", err instanceof Error ? err.message : "Could not start live voice.");
    }
  }, [
    clearPendingSpeechTimer,
    clearGracefulStopTimer,
    clearSessionRefreshTimer,
    clearToolResultFallback,
    connectSocket,
    log,
    sendAudioInput,
    state,
    transition,
  ]);

  const completeBackgroundCodexJob = useCallback(() => {
    if (stateRef.current !== "working") return;
    transition("live", "Live with Gemini — speak again when ready.");
    log("[Coding agent] Background task settled; cleared working status.");
  }, [log, transition]);

  useEffect(
    () => () => {
      clearToolResultFallback();
      void stop();
    },
    [clearToolResultFallback, stop],
  );

  return {
    active:
      state === "connecting" ||
      state === "reconnecting" ||
      state === "live" ||
      state === "thinking" ||
      state === "working",
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
    completeBackgroundCodexJob,
    requestSpeech,
  };
}
