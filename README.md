# Codex Voice Agent

Local web app for talking to Gemini and letting it run Codex tasks on this machine.

## What it does

- Starts a browser voice session using your microphone.
- Sends the spoken task to a FastAPI backend.
- Lets Gemini decide whether Codex should be called.
- Runs Codex through the Python SDK, reusing the existing local Codex login.
- Saves local conversation history in `backend/data/history.sqlite3`.

## Setup

```bash
cd /Users/karansaini/Projects/codex-voice-agent
uv sync
cd frontend
npm install
```

Create `.env` from the example:

```bash
cp .env.example .env
```

Set `GOOGLE_API_KEY` to your Google AI Studio key. Live voice uses `GEMINI_MODEL`
and defaults to `gemini-3.1-flash-live-preview`. Typed chat uses
`GEMINI_TEXT_MODEL` and defaults to `gemini-2.5-flash`.
The Google GenAI SDK is pinned in `pyproject.toml` because the Live API surface
changes quickly; update it intentionally and run the backend and frontend checks
before relying on a newer client.

For access from another device, also set a private `CODEX_API_TOKEN` in the backend
`.env`, then set the same value as `VITE_API_TOKEN` in the frontend environment.
Without a token, the backend accepts same-machine requests only.

By default, local app data is written under `backend/data`. Set `DATA_DIR` if you
want history, artifacts, chats, console state, and logs somewhere else.

### Tracing (optional)

The backend is instrumented with [Langfuse](https://langfuse.com) for LLM observability.
Tracing is **off by default** and turns on only when credentials are present, so the
app runs unchanged without them. To enable it, set in `.env`:

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com   # or https://us.cloud.langfuse.com / self-hosted
LANGFUSE_TRACING_ENABLED=                       # on/off switch (see below)
```

Keys come from the Langfuse UI → Settings → API Keys. `LANGFUSE_TRACING_ENABLED` is an
explicit on/off flag: leave it unset for auto (on when keys are present), `false` to
force off even with keys, or `true` to require keys.

Each turn is one trace, and the tool call the model makes is captured as a child, so
the Codex run nests under it:

```
gemini-voice-turn   (generation)   input = user message + conversation so far
  └─ run_codex_task (tool)         the model's tool call (args)
      └─ codex-turn (generation)   the Codex agent's own run
```

Traces are grouped by chat as **sessions** (`session_id = chat_id`) — open the
**Sessions** tab to see a whole conversation across turns. Only transcribed text is
recorded — never raw audio or API keys. All Langfuse logic lives in
`backend/app/tracing.py`.

## Run

Backend:

```bash
cd /Users/karansaini/Projects/codex-voice-agent
uv run run.py
```

If your shell does not resolve the script name directly, use:

```bash
uv run ./run.py
```

Frontend:

```bash
cd /Users/karansaini/Projects/codex-voice-agent/frontend
npm run dev
```

Open the Vite URL shown in the terminal, usually `http://localhost:5173`.

Codex SDK:

https://developers.openai.com/codex/sdk

## iPhone wrapper

The frontend now includes a lightweight Capacitor iOS wrapper in `frontend/ios`.
It packages the Vite build into an Xcode app and enables iOS background audio so
an active voice session can keep its microphone and WebSocket alive after the app
is minimized.

Before building for iPhone, set the backend URL that the phone can reach:

```bash
cd /Users/karansaini/Projects/codex-voice-agent/frontend
cp .env.ios.example .env.local
```

Edit `.env.local` so `VITE_API_BASE_URL` points to the HTTPS backend URL on your
network and `VITE_API_TOKEN` matches `CODEX_API_TOKEN`. The iPhone cannot use
Vite's `/api` proxy from the packaged app.

Build and sync the iOS app:

```bash
cd /Users/karansaini/Projects/codex-voice-agent/frontend
npm run build
npx cap sync ios
open ios/App/App.xcodeproj
```

Install on a physical iPhone without App Store publishing:

1. Connect the iPhone to the Mac.
2. Open `frontend/ios/App/App.xcodeproj` in Xcode.
3. Select the `App` scheme and your iPhone as the run destination.
4. In Signing & Capabilities, choose your Apple developer team.
5. Keep Background Modes enabled with Audio selected. The project also declares
   the microphone permission text in `Info.plist`.
6. Press Run. Xcode will build, sign, and install the app on the phone.
7. If iOS asks whether to trust the developer profile, approve it in Settings.

After installation, the Mac is not needed to keep the app running. The backend
still needs to be reachable from the iPhone, and the background connection only
continues while an actual voice/audio session is active; iOS may still stop idle
apps that are not using audio.
