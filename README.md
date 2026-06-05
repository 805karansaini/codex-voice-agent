# Codex Voice Agent

Local web app for talking to Gemini and letting it run Codex tasks on this machine.

## What it does

- Starts a browser voice session using your microphone.
- Sends the spoken task to a FastAPI backend.
- Lets Gemini decide whether Codex should be called.
- Runs Codex through the Python SDK, reusing the existing local Codex login.
- Saves local conversation history in `backend/data/history.json`.

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

Set `GOOGLE_API_KEY` to your Google AI Studio key. The default model is `gemini-3.1-flash-live-preview`.

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
