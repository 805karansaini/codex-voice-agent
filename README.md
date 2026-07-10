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

Set `CODEX_AUTO_CHECKPOINT=true` if you want the backend to create a git
checkpoint commit before each Codex turn when the selected project already has
uncommitted changes. The default is `false`, so normal runs do not create commits
unless you opt in.

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

## Project docs

- `PRODUCT_REVIEW.md` is the source review and roadmap.
- `PRODUCT_PROGRESS.md` tracks completed and pending review items.
- `docs/live-voice-state-flow.md` documents the live voice state flow.
- `docs/chat-artifact-workflow-plan.md` documents the chat artifact workflow.
- `docs/archive/` keeps older planning notes as historical references; they are
  not required for normal setup or operation.
