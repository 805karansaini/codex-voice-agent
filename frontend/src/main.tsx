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

const API = `${window.location.protocol}//${window.location.hostname}:8765`;

function useSpeech(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      if (transcript) onText(transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
  }, [onText]);

  return {
    supported: Boolean(recognitionRef.current || (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition),
    listening,
    start: () => {
      recognitionRef.current?.start();
      setListening(true);
    },
    stop: () => {
      recognitionRef.current?.stop();
      setListening(false);
    },
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
  const historyRef = useRef<HTMLDivElement | null>(null);
  const hasMessages = messages.length > 0;

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight, behavior: "smooth" });
    });
  };

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
        const data = await res.json();
        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          text: data.reply || "Done.",
          meta: { tool_calls: data.tool_calls || [], workdir: data.workdir },
        };
        setMessages((prev) => [...prev, assistantMsg]);
        scrollToBottom();
        if ("speechSynthesis" in window) {
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(new SpeechSynthesisUtterance(assistantMsg.text.slice(0, 500)));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setBusy(false);
      }
    },
    [busy, input, mode],
  );

  const speech = useSpeech((text) => send(text));

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
            <div className={`voiceDisc ${speech.listening ? "isListening" : ""}`}>
              <Waveform size={68} weight="duotone" />
              <span />
            </div>
            <div className="startCopy">
              <p className="panelLabel">Start</p>
              <h3>{speech.listening ? "Listening" : busy ? "Agent running" : "Ready for the next task"}</h3>
              <p>
                {speech.listening
                  ? "Speak naturally. The transcript is sent as soon as the browser finishes recognition."
                  : "Use voice for quick tasks, or type in the side chat when precision matters."}
              </p>
            </div>
            <button
              className="voiceButton"
              onClick={() => (speech.listening ? speech.stop() : speech.start())}
              disabled={!speech.supported || busy}
              type="button"
            >
              {speech.listening ? <MicrophoneSlash size={18} weight="bold" /> : <Microphone size={18} weight="bold" />}
              {speech.listening ? "Stop voice" : "Start voice"}
            </button>
            {!speech.supported && <p className="inlineHint">This browser does not expose speech input here.</p>}
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

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
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
