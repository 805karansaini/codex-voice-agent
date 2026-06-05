import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Mic, MicOff, Send, Terminal, Volume2 } from "lucide-react";
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

  const send = async (text = input) => {
    const clean = text.trim();
    if (!clean || busy) return;
    setInput("");
    setError("");
    setBusy(true);
    const userMsg: Message = { id: crypto.randomUUID(), role: "user", text: clean };
    setMessages((prev) => [...prev, userMsg]);
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
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(assistantMsg.text.slice(0, 500)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const speech = useSpeech((text) => send(text));

  useEffect(() => {
    fetch(`${API}/api/health`)
      .then((r) => r.json())
      .then((data) => setStatus(data.has_google_api_key ? "Ready" : "Missing Google API key"))
      .catch(() => setStatus("Backend offline"));
    fetch(`${API}/api/history`)
      .then((r) => r.json())
      .then((rows) => setMessages(rows))
      .catch(() => undefined);
  }, []);

  const lastTool = useMemo(() => {
    const last = [...messages].reverse().find((m) => Array.isArray((m.meta as any)?.tool_calls) && (m.meta as any).tool_calls.length);
    return last ? "Codex was used in the last agent task" : "Gemini will call Codex when local work is needed";
  }, [messages]);

  return (
    <main className="shell">
      <section className="left">
        <div className="brand">
          <div className="mark"><Terminal size={18} /></div>
          <div>
            <h1>Codex Voice Agent</h1>
            <p>{status}</p>
          </div>
        </div>

        <div className="callPanel">
          <div className={`orb ${speech.listening ? "live" : ""}`}>
            {speech.listening ? <Mic size={46} /> : <Volume2 size={46} />}
          </div>
          <h2>{speech.listening ? "Listening" : "Voice workspace"}</h2>
          <p>Speak a task, or type it below. Gemini handles the conversation and can hand real work to Codex on this computer.</p>
          <button
            className="primary"
            onClick={() => (speech.listening ? speech.stop() : speech.start())}
            disabled={!speech.supported || busy}
          >
            {speech.listening ? <MicOff size={18} /> : <Mic size={18} />}
            {speech.listening ? "Stop call" : "Start voice"}
          </button>
        </div>

        <div className="mode">
          <button className={mode === "agent" ? "selected" : ""} onClick={() => setMode("agent")}>Gemini agent</button>
          <button className={mode === "codex" ? "selected" : ""} onClick={() => setMode("codex")}>Direct Codex</button>
        </div>
        <p className="note">{lastTool}</p>
      </section>

      <section className="chat">
        <div className="history">
          {messages.length === 0 && <div className="empty">Ask for a code change, repo review, script, or local task.</div>}
          {messages.map((m) => (
            <article key={m.id} className={`bubble ${m.role}`}>
              <span>{m.role === "user" ? "You" : "Assistant"}</span>
              <p>{m.text}</p>
            </article>
          ))}
          {busy && <article className="bubble assistant loading"><span>Assistant</span><p>Working on it</p></article>}
        </div>

        {error && <div className="error">{error}</div>}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={mode === "codex" ? "Tell Codex exactly what to do" : "Ask naturally; Gemini can call Codex"}
          />
          <button disabled={busy || !input.trim()} aria-label="Send">
            <Send size={20} />
          </button>
        </form>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
