import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUp,
  Broom,
  BracketsCurly,
  Cpu,
  Gauge,
  Microphone,
  MicrophoneSlash,
  PlugsConnected,
  Pulse,
  SpeakerHigh,
  Sparkle,
  TerminalWindow,
  Waveform,
} from "@phosphor-icons/react";
import "./styles.css";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  meta?: Record<string, unknown>;
};

type AgentResponse = {
  reply?: string;
  tool_calls?: unknown[];
  workdir?: string;
  audio_data_url?: string | null;
};

type TranscribeResponse = {
  text?: string;
};

const API = import.meta.env.VITE_API_BASE_URL || "";
const LIVE_AUDIO_RATE = 16000;
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

type SpeechState = "idle" | "starting" | "listening" | "recording" | "processing" | "unsupported" | "error";
type LiveVoiceState = "idle" | "connecting" | "live" | "thinking" | "error";
type DebugEntry = {
  id: string;
  time: string;
  message: string;
};

function useSpeech(onText: (text: string) => void, onAudio: (audio: Blob) => void) {
  const [listening, setListening] = useState(false);
  const [state, setState] = useState<SpeechState>("idle");
  const [message, setMessage] = useState("Voice is ready.");
  const [transcriptPreview, setTranscriptPreview] = useState("");
  const recognitionRef = useRef<any>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const transcriptRef = useRef("");
  const sentRef = useRef(false);
  const errorRef = useRef(false);
  const onTextRef = useRef(onText);
  const onAudioRef = useRef(onAudio);

  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);

  useEffect(() => {
    onAudioRef.current = onAudio;
  }, [onAudio]);

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const stopRecorder = (sendAudio: boolean) => {
    const recorder = recorderRef.current;
    if (!recorder) {
      stopTracks();
      return;
    }
    (recorder as any).__sendAudio = sendAudio;
    if (recorder.state === "recording") {
      recorder.stop();
    } else {
      stopTracks();
    }
  };

  const startRecorder = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return false;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    audioChunksRef.current = [];

    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const shouldSend = Boolean((recorder as any).__sendAudio);
      const mimeType = recorder.mimeType || "audio/webm";
      recorderRef.current = null;
      stopTracks();
      if (!shouldSend || sentRef.current || audioChunksRef.current.length === 0) return;
      sentRef.current = true;
      setListening(false);
      setState("processing");
      setMessage("Transcribing recorded audio with Gemini.");
      onAudioRef.current(new Blob(audioChunksRef.current, { type: mimeType }));
    };
    recorderRef.current = recorder;
    recorder.start();
    return true;
  };

  const startFallbackRecorder = async (fallbackMessage: string) => {
    try {
      const recorderStarted = await startRecorder();
      if (!recorderStarted) {
        setListening(false);
        setState("unsupported");
        setMessage("Recorded voice input is not available in this browser.");
        return false;
      }
      setListening(true);
      setState("recording");
      setMessage(fallbackMessage);
      return true;
    } catch {
      setListening(false);
      setState("error");
      setMessage("Microphone permission was blocked. Allow microphone access and try again.");
      return false;
    }
  };

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        setState("unsupported");
        setMessage("Speech input is not available in this browser.");
      } else {
        setMessage("Browser speech is unavailable. Voice will use recorded audio.");
      }
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      transcriptRef.current = "";
      sentRef.current = false;
      errorRef.current = false;
      setTranscriptPreview("");
      setListening(true);
      setState("listening");
      setMessage("Listening. Speak now.");
    };

    recognition.onresult = (event: any) => {
      let fullTranscript = "";
      for (let index = 0; index < event.results.length; index += 1) {
        fullTranscript += event.results[index]?.[0]?.transcript || "";
      }

      const clean = fullTranscript.trim();
      if (!clean) return;

      transcriptRef.current = clean;
      setTranscriptPreview(transcriptRef.current);

      const finalResult = Array.from(event.results).some((result: any) => result.isFinal);
      if (finalResult && !sentRef.current) {
        sentRef.current = true;
        stopRecorder(false);
        setListening(false);
        setState("processing");
        setMessage("Got it. Preparing the message.");
        onTextRef.current(transcriptRef.current);
      } else {
        setState("listening");
        setMessage("Listening. Keep speaking.");
      }
    };

    recognition.onnomatch = () => {
      errorRef.current = true;
      setState("error");
      setMessage("I could not make out the speech. Try again closer to the microphone.");
    };

    recognition.onerror = (event: any) => {
      const error = event?.error || "unknown";
      const clean = transcriptRef.current.trim();
      if (clean && !sentRef.current) {
        sentRef.current = true;
        stopRecorder(false);
        setListening(false);
        setState("processing");
        setMessage("Got it. Sending the captured speech.");
        onTextRef.current(clean);
        return;
      }

      errorRef.current = true;
      if (error === "network" || error === "service-not-allowed") {
        void startFallbackRecorder(
          "Browser live speech failed. I am recording instead; press Stop voice when you finish speaking.",
        );
        return;
      }

      const messages: Record<string, string> = {
        "not-allowed": "Microphone permission was blocked. Allow microphone access and try again.",
        "service-not-allowed": "The browser blocked speech recognition for this page.",
        "no-speech": "I did not hear speech. Try again after the listening state appears.",
        "audio-capture": "No microphone was found. Check the selected input device.",
        network: "Speech recognition could not reach the browser speech service.",
        aborted: "Voice input was stopped.",
      };
      stopRecorder(false);
      setListening(false);
      setState(error === "aborted" ? "idle" : "error");
      setMessage(messages[error] || "Speech recognition stopped before producing text.");
    };

    recognition.onend = () => {
      const clean = transcriptRef.current.trim();
      if (clean && !sentRef.current) {
        sentRef.current = true;
        stopRecorder(false);
        setListening(false);
        setState("processing");
        setMessage("Got it. Sending the message.");
        onTextRef.current(clean);
        return;
      }
      if (recorderRef.current?.state === "recording" && errorRef.current) {
        setListening(true);
        setState("recording");
        return;
      }
      setListening(false);
      if (!clean && !errorRef.current) {
        setState("idle");
        setMessage("No speech was captured. Try again after the listening state appears.");
      }
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onnomatch = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.abort();
      } catch {
        undefined;
      }
      stopRecorder(false);
    };
  }, []);

  return {
    supported: Boolean(
        recognitionRef.current ||
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition ||
        (typeof navigator.mediaDevices?.getUserMedia === "function" && typeof MediaRecorder !== "undefined"),
    ),
    listening,
    state,
    message,
    transcriptPreview,
    start: async () => {
      transcriptRef.current = "";
      sentRef.current = false;
      errorRef.current = false;
      setTranscriptPreview("");
      setState("starting");
      setMessage("Opening microphone.");

      if (!recognitionRef.current) {
        await startFallbackRecorder("Browser live speech is unavailable. Recording audio instead; press Stop voice when finished.");
        return;
      }
      try {
        recognitionRef.current.start();
      } catch {
        await startFallbackRecorder("Browser live speech did not start. Recording audio instead; press Stop voice when finished.");
      }
    },
    stop: () => {
      const clean = transcriptRef.current.trim();
      if (clean && !sentRef.current) {
        sentRef.current = true;
        stopRecorder(false);
        recognitionRef.current?.stop();
        setListening(false);
        setState("processing");
        setMessage("Got it. Sending the captured speech.");
        onTextRef.current(clean);
        return;
      }
      recognitionRef.current?.stop();
      if (recorderRef.current?.state === "recording") {
        setState("processing");
        setMessage("Transcribing recorded audio with Gemini.");
        stopRecorder(true);
        return;
      }
      setListening(false);
      setState("idle");
      setMessage("Voice input stopped.");
    },
  };
}

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

function useLiveVoice({
  onTurn,
  onAudio,
  onDebug,
}: {
  onTurn: (userText: string, assistantText: string) => void;
  onAudio: (audioUrl: string) => void;
  onDebug: (message: string) => void;
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
  const onTurnRef = useRef(onTurn);
  const onAudioRef = useRef(onAudio);
  const onDebugRef = useRef(onDebug);

  useEffect(() => {
    onTurnRef.current = onTurn;
    onAudioRef.current = onAudio;
    onDebugRef.current = onDebug;
  }, [onTurn, onAudio, onDebug]);

  const log = useCallback((text: string) => {
    onDebugRef.current(text);
  }, []);

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

  const stop = useCallback(async () => {
    log("Stopping live voice session.");
    await stopMicrophone();
    websocketRef.current?.send(JSON.stringify({ type: "close" }));
    websocketRef.current?.close();
    websocketRef.current = null;
    setState("idle");
    setMessage("Gemini Live voice is ready.");
  }, [log, stopMicrophone]);

  const start = useCallback(async () => {
    if (state === "connecting" || state === "live" || state === "thinking") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof window.AudioContext === "undefined") {
      setState("error");
      setMessage("This browser cannot open live microphone audio.");
      log("Live voice blocked: browser does not expose microphone audio APIs.");
      return;
    }

    setState("connecting");
    setMessage("Connecting live microphone to Gemini.");
    setUserPreview("");
    setAssistantPreview("");
    log("Opening microphone for Gemini Live.");

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
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const websocket = new WebSocket(websocketUrl("/api/live"));

      streamRef.current = stream;
      contextRef.current = audioContext;
      sourceRef.current = source;
      processorRef.current = processor;
      websocketRef.current = websocket;

      websocket.onopen = () => {
        log("WebSocket connected to backend live endpoint.");
        setState("live");
        setMessage("Live with Gemini. Speak naturally; pause when you want the agent to answer.");
      };

      websocket.onmessage = (event) => {
        const payload = JSON.parse(event.data);
        if (payload.type === "ready" || payload.type === "debug") {
          log(payload.message || payload.type);
        } else if (payload.type === "user_transcript") {
          setUserPreview((current) => `${current}${payload.text || ""}`);
          setState("thinking");
          setMessage("Gemini heard you. Waiting for the reply.");
        } else if (payload.type === "assistant_delta") {
          setAssistantPreview((current) => `${current}${payload.text || ""}`);
          setState("thinking");
          setMessage("Gemini is replying.");
        } else if (payload.type === "turn_complete") {
          const userText = String(payload.user_text || "").trim();
          const assistantText = String(payload.assistant_text || "").trim();
          if (userText || assistantText) onTurnRef.current(userText || "Voice message", assistantText || "Done.");
          if (payload.audio_data_url) onAudioRef.current(payload.audio_data_url);
          setUserPreview("");
          setAssistantPreview("");
          setState("live");
          setMessage("Live with Gemini. Speak again when ready.");
          log("Gemini Live turn complete.");
        } else if (payload.type === "interrupted") {
          setAssistantPreview("");
          log("Gemini response interrupted by new speech.");
        } else if (payload.type === "tool_call") {
          log(`Codex handoff finished: ${payload.name || "tool"}.`);
        } else if (payload.type === "error") {
          setState("error");
          setMessage(payload.message || "Live voice failed.");
          log(`Live voice error: ${payload.message || "unknown error"}`);
        }
      };

      websocket.onerror = () => {
        setState("error");
        setMessage("Live voice connection failed.");
        log("WebSocket error from live voice connection.");
      };

      websocket.onclose = () => {
        void stopMicrophone();
        websocketRef.current = null;
        setState((current) => (current === "error" ? current : "idle"));
        setMessage((current) => (current === "Live voice connection failed." ? current : "Gemini Live voice is ready."));
        log("Live voice socket closed.");
      };

      processor.onaudioprocess = (event) => {
        if (websocket.readyState !== WebSocket.OPEN) return;
        const input = event.inputBuffer.getChannelData(0);
        websocket.send(
          JSON.stringify({
            type: "audio",
            mime_type: `audio/pcm;rate=${LIVE_AUDIO_RATE}`,
            data: encodePcmChunk(input, audioContext.sampleRate),
          }),
        );
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
      log(`Streaming microphone PCM at ${LIVE_AUDIO_RATE} Hz from ${Math.round(audioContext.sampleRate)} Hz input.`);
    } catch (err) {
      await stopMicrophone();
      websocketRef.current?.close();
      websocketRef.current = null;
      setState("error");
      setMessage(err instanceof Error ? err.message : "Could not start live voice.");
      log(`Could not start live voice: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }, [log, state, stopMicrophone]);

  useEffect(() => {
    return () => {
      void stop();
    };
  }, [stop]);

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

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"agent" | "codex">("agent");
  const [status, setStatus] = useState("Checking backend");
  const [model, setModel] = useState("Gemini Live");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState("");
  const [pendingAudioUrl, setPendingAudioUrl] = useState("");
  const [debugOpen, setDebugOpen] = useState(true);
  const [debugEntries, setDebugEntries] = useState<DebugEntry[]>([]);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const responseAudioRef = useRef<HTMLAudioElement | null>(null);
  const hasMessages = messages.length > 0;

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;

    const loadVoices = () => {
      const browserVoices = window.speechSynthesis.getVoices();
      setVoices(browserVoices);
      setSelectedVoiceURI((current) => {
        if (current || browserVoices.length === 0) return current;
        const preferredVoice =
          PREFERRED_VOICE_NAMES.map((name) =>
            browserVoices.find((voice) => voice.name.toLowerCase().includes(name.toLowerCase())),
          ).find(Boolean) ||
          browserVoices.find((voice) => voice.lang.toLowerCase().startsWith("en") && voice.name.toLowerCase().includes("female")) ||
          browserVoices.find((voice) => voice.lang.toLowerCase().startsWith("en")) ||
          browserVoices[0];
        return preferredVoice?.voiceURI || "";
      });
    };

    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, []);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight, behavior: "smooth" });
    });
  };

  const blobToBase64 = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = () => reject(new Error("Could not read recorded audio"));
      reader.readAsDataURL(blob);
    });

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
      setError("Audio is ready, but this browser blocked automatic playback. Tap Play response.");
    }
  }, []);

  const send = useCallback(
    async (text = input) => {
      const clean = text.trim();
      if (!clean || busy) return;
      setInput("");
      setError("");
      setBusy(true);
      const userMsg: Message = { id: crypto.randomUUID(), role: "user", text: clean };
      setMessages((prev) => [...prev, userMsg]);
      scrollToBottom();
      try {
        const res = await fetch(`${API}/api/${mode === "codex" ? "codex" : "chat"}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mode === "codex" ? { task: clean } : { message: clean }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.detail || "Request failed");
        }
        const data = (await res.json()) as AgentResponse;
        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          text: data.reply || "Done.",
          meta: { tool_calls: data.tool_calls || [], workdir: data.workdir },
        };
        setMessages((prev) => [...prev, assistantMsg]);
        scrollToBottom();
        if (data.audio_data_url) {
          await playResponseAudio(data.audio_data_url);
        } else if ("speechSynthesis" in window) {
          const utterance = new SpeechSynthesisUtterance(assistantMsg.text.slice(0, 500));
          const selectedVoice = voices.find((voice) => voice.voiceURI === selectedVoiceURI);
          if (selectedVoice) utterance.voice = selectedVoice;
          utterance.rate = 0.94;
          utterance.pitch = 1.08;
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utterance);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setBusy(false);
      }
    },
    [busy, input, mode, playResponseAudio, selectedVoiceURI, voices],
  );

  const transcribeAndSend = useCallback(
    async (audio: Blob) => {
      setError("");
      try {
        const audioBase64 = await blobToBase64(audio);
        const res = await fetch(`${API}/api/transcribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audio_base64: audioBase64, mime_type: audio.type || "audio/webm" }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.detail || "Could not transcribe recorded audio");
        }
        const data = (await res.json()) as TranscribeResponse;
        const text = data.text?.trim();
        if (!text) throw new Error("No speech was found in the recording");
        send(text);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not transcribe recorded audio");
      }
    },
    [send],
  );

  const addDebug = useCallback((message: string) => {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setDebugEntries((current) => [{ id: crypto.randomUUID(), time, message }, ...current].slice(0, 18));
  }, []);

  const liveVoice = useLiveVoice({
    onTurn: (userText, assistantText) => {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user", text: userText },
        { id: crypto.randomUUID(), role: "assistant", text: assistantText },
      ]);
      scrollToBottom();
    },
    onAudio: playResponseAudio,
    onDebug: addDebug,
  });
  const voiceActive = liveVoice.active;

  const toggleVoice = () => {
    primeAudioPlayback();
    if (voiceActive) {
      liveVoice.stop();
    } else {
      liveVoice.start();
    }
  };

  const refreshHistory = useCallback(() => {
    fetch(`${API}/api/health`)
      .then((r) => r.json())
      .then((data) => {
        setStatus(data.has_google_api_key ? "Ready" : "Missing Google API key");
        setModel(data.gemini_model || "Gemini Live");
      })
      .catch(() => setStatus("Backend offline"));
    fetch(`${API}/api/history`)
      .then((r) => r.json())
      .then((rows) => {
        setMessages(rows);
        scrollToBottom();
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  const startNewChat = async () => {
    setError("");
    window.speechSynthesis?.cancel();
    setMessages([]);
    setInput("");
    try {
      await fetch(`${API}/api/history`, { method: "DELETE" });
    } catch {
      setError("Could not clear saved history. The current screen was reset.");
    }
  };

  const toolSummary = useMemo(() => {
    const toolRuns = messages.filter((m) => Array.isArray((m.meta as any)?.tool_calls) && (m.meta as any).tool_calls.length);
    if (toolRuns.length) return `${toolRuns.length} Codex handoff${toolRuns.length === 1 ? "" : "s"}`;
    return "Codex ready";
  }, [messages]);

  const statusClass = status === "Ready" ? "ready" : status === "Backend offline" ? "offline" : "warn";
  const voiceHeading =
    liveVoice.state === "connecting"
      ? "Connecting live voice"
      : liveVoice.state === "live"
        ? "Live conversation"
        : liveVoice.state === "thinking"
          ? "Gemini is responding"
          : liveVoice.state === "error"
            ? "Voice needs attention"
            : busy
              ? "Agent running"
              : "Ready for the next task";

  return (
    <main className="appShell">
      <aside className="rail">
        <div className="brandLockup">
          <div className="brandMark"><TerminalWindow size={22} weight="duotone" /></div>
          <div>
            <p className="eyebrow">Local operator</p>
            <h1>Codex Voice Agent</h1>
          </div>
        </div>

        <div className="modeSwitch" aria-label="Mode">
          <button className={mode === "agent" ? "active" : ""} onClick={() => setMode("agent")} type="button">
            <Sparkle size={16} weight="bold" />
            Agent
          </button>
          <button className={mode === "codex" ? "active" : ""} onClick={() => setMode("codex")} type="button">
            <BracketsCurly size={16} weight="bold" />
            Codex
          </button>
        </div>

        <div className="railStats">
          <div>
            <span className={`statusDot ${statusClass}`} />
            <p>{status}</p>
          </div>
          <div>
            <Cpu size={16} weight="duotone" />
            <p>{model}</p>
          </div>
          <div>
            <PlugsConnected size={16} weight="duotone" />
            <p>{toolSummary}</p>
          </div>
        </div>
      </aside>

      <section className="workspace" aria-label="Voice workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Agent canvas</p>
            <h2>{mode === "agent" ? "Ask once, then let the agent work." : "Send a direct Codex task."}</h2>
          </div>
          <div className="runState">
            <Pulse size={17} weight="fill" />
            {busy ? "Working" : "Idle"}
          </div>
        </header>

        <div className="operatorBoard">
          <div className="startPanel">
            <div className={`voiceDisc ${voiceActive ? "isListening" : ""}`}>
              <Waveform size={68} weight="duotone" />
              <span />
            </div>
            <div className="startCopy">
              <p className="panelLabel">Start</p>
              <h3>{voiceHeading}</h3>
              <p>{liveVoice.message}</p>
              {liveVoice.transcriptPreview && <p className="voiceFeedback">{liveVoice.transcriptPreview}</p>}
            </div>
            <button
              className="voiceButton"
              onClick={toggleVoice}
              disabled={!liveVoice.supported || busy}
              type="button"
            >
              {voiceActive ? <MicrophoneSlash size={18} weight="bold" /> : <Microphone size={18} weight="bold" />}
              {voiceActive ? "End live" : "Start live"}
            </button>
            {!liveVoice.supported && <p className="inlineHint">This browser does not expose live microphone audio here.</p>}
          </div>

          <div className="systemGrid">
            <div className="systemMetric">
              <Gauge size={20} weight="duotone" />
              <span>State</span>
              <strong>{busy ? "Working" : status}</strong>
            </div>
            <div className="systemMetric">
              <Cpu size={20} weight="duotone" />
              <span>Model</span>
              <strong>{model}</strong>
            </div>
            <div className="systemMetric wide">
              <PlugsConnected size={20} weight="duotone" />
              <span>Handoffs</span>
              <strong>{toolSummary}</strong>
            </div>
          </div>

          <div className="voiceSelect">
            <label htmlFor="responseVoice">
              <SpeakerHigh size={17} weight="duotone" />
              Browser fallback voice
            </label>
            <select
              id="responseVoice"
              value={selectedVoiceURI}
              onChange={(event) => setSelectedVoiceURI(event.target.value)}
              disabled={voices.length === 0}
            >
              {voices.length === 0 && <option value="">Browser default</option>}
              {voices.map((voice) => (
                <option value={voice.voiceURI} key={voice.voiceURI}>
                  {voice.name} ({voice.lang})
                </option>
              ))}
            </select>
          </div>

          <div className="debugPanel">
            <button className="debugToggle" type="button" onClick={() => setDebugOpen((current) => !current)}>
              Live debug
              <span>{debugOpen ? "Hide" : "Show"}</span>
            </button>
            {debugOpen && (
              <div className="debugLog" aria-live="polite">
                {debugEntries.length === 0 ? (
                  <p>No live voice events yet.</p>
                ) : (
                  debugEntries.map((entry) => (
                    <p key={entry.id}>
                      <span>{entry.time}</span>
                      {entry.message}
                    </p>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="activityPanel">
            <div>
              <p className="panelLabel">Current session</p>
              <h3>{hasMessages ? `${messages.length} message${messages.length === 1 ? "" : "s"}` : "No active conversation"}</h3>
            </div>
            <p>
              {hasMessages
                ? "Conversation stays in the side panel so the main surface remains focused."
                : "Start from chat or voice. The layout is ready before the backend answers."}
            </p>
          </div>
        </div>
      </section>

      <aside className="chatPanel" aria-label="Chat">
        <div className="chatHeader">
          <div>
            <p className="eyebrow">Chat</p>
            <h2>{mode === "codex" ? "Codex" : "Agent"}</h2>
          </div>
          <button className="iconButton" onClick={startNewChat} aria-label="New chat" type="button">
            <Broom size={18} weight="bold" />
          </button>
        </div>

        <div className="transcript" ref={historyRef}>
          {messages.length === 0 && (
            <div className="emptyState compact">
              <div className="emptyIcon"><TerminalWindow size={24} weight="duotone" /></div>
              <h3>Start with a task</h3>
              <p>Ask for a repo change, review, script, or local fix.</p>
            </div>
          )}

          {messages.map((message, index) => (
            <article className={`message ${message.role}`} key={message.id} style={{ "--i": index } as React.CSSProperties}>
              <div className="messageMeta">
                <span>{message.role === "user" ? "You" : "Agent"}</span>
                {Array.isArray((message.meta as any)?.tool_calls) && (message.meta as any).tool_calls.length > 0 && <em>Codex used</em>}
              </div>
              <p>{message.text}</p>
            </article>
          ))}

          {busy && (
            <article className="message assistant skeleton">
              <div className="messageMeta"><span>Agent</span></div>
              <p>Working on the task</p>
            </article>
          )}
        </div>

        {error && <div className="errorStrip">{error}</div>}
        {pendingAudioUrl && (
          <button className="playResponse" onClick={() => playResponseAudio(pendingAudioUrl)} type="button">
            <SpeakerHigh size={18} weight="bold" />
            Play response
          </button>
        )}

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            primeAudioPlayback();
            send();
          }}
        >
          <label htmlFor="prompt">Command</label>
          <div className="composerBox">
            <textarea
              id="prompt"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  primeAudioPlayback();
                  send();
                }
              }}
              placeholder={mode === "codex" ? "Tell Codex exactly what to do" : "Ask the agent what to do next"}
            />
            <button disabled={busy || !input.trim()} aria-label="Send message" type="submit">
              <ArrowUp size={21} weight="bold" />
            </button>
          </div>
          <p className="composerHint">Enter sends. Shift Enter adds a new line.</p>
        </form>
      </aside>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
