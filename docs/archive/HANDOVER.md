# Handover — Codex Voice Agent

**For:** Codex (the coding agent picking up this work)
**Date:** 2026-06-06
**Repo:** `/Users/karansaini/Projects/codex-voice-agent`
**Branch:** `main` (all work below is **uncommitted** in the working tree)

This document explains what the owner (Karan) is building, the goals he stated in
his own words, everything that has been implemented so far, the current state of
the code, and what is left to do. Read it top-to-bottom before changing anything.

---

## 1. What this project is

A **local, voice-first operator console**. The user talks (or types) to a Gemini
Live agent in the browser; when real computer work is needed (read/edit files,
run git, build, test), Gemini hands the task to **Codex** (the OpenAI Codex
Python SDK) which executes it **on this machine**.

Stack:
- **Backend** — FastAPI (`backend/app/`), Python, run with `uv`.
  - Gemini Live (google-genai) for voice + chat.
  - Codex Python SDK (`openai_codex`) for local execution.
- **Frontend** — React 19 + Vite + TypeScript, single-page (`frontend/src/main.tsx`),
  plain CSS (`frontend/src/styles.css`), Phosphor icons.
- Conversation history persisted to `backend/data/history.json` (global, see TODO).

---

## 2. The user's goal — in his own words

These are the things Karan asked for across the session. Treat them as the
source of truth for intent.

### 2a. The core product vision (Projects = directory-scoped working dir)
> "I should be able to add the directory or the folders in the sidebar … add
> projects where we should be able to select the directory and inside that
> directory we should be able to do our chat and everything. Whenever I do that,
> my present working directory would be that directory. Meaning if I ask in that
> project 'how many files I have', it should use that. If I say 'do a git pull',
> it should pull in that folder itself."

So: **each project is pinned to a real folder; that folder is the present working
directory (PWD) for all chat / voice / Codex work in that project.**

Originally the app always used `$HOME` (`/Users/karansaini`) as the workdir,
which is why "what is my pwd?" always answered `/Users/karansaini` and "git pull"
had no repo to act on.

### 2b. Redesign the UI (professional, Codex-app / T3-chat inspired)
> "This is how my current UI looks, which is really bad. I want it very
> professional looking. Take inspiration from the Codex app and T3 chat."

Later, after the first redesign:
> "This is how the UI looks really bad. Can we make it better please use the
> frontend-design skill."
(This second complaint was largely a real **layout bug** — see §3.)

### 2c. No copies — point at the original folder, in place
> "I do not want the copy mechanism … I would much rather prefer a current folder
> to be added to the app. I do not want its copy. What if I change something in
> the original folder, now I need to sync — like very bad. By design we want to
> add the directory once, keep the original only."

The app never literally copied files, BUT `codex_runner` had
`root.mkdir(parents=True, exist_ok=True)`, so when a wrong/partial path was given
it silently **created a new empty folder** instead of erroring — which the user
experienced as "it made a copy / empty dir." Fixed (see §3).

### 2d. Stream Codex output, TTS only at the end
> "Would it be possible to stream the codex response in realtime to the frontend,
> while we do not want all the things to TTS — only in the end we want the TTS
> for that."

So: **stream Codex tokens into the chat bubble live; speak (TTS) only once, on
the final complete text.** Done (see §3).

### 2e. The folder picker must return the real absolute path
> "Getting this issue [validation: 'That directory does not exist']. Selected
> this from file picker: /Users/karansaini/AlgoOneAI/glm-ocr."

Root cause: the browser `showDirectoryPicker` only returns the folder **name**,
never the absolute path. Fixed by adding a **native OS folder dialog** served by
the local backend (see §3).

---

## 3. What has been implemented (this session)

All of the following is **done and verified** but **not yet committed**.

### Backend

**`backend/app/codex_runner.py`** — rewritten
- `resolve_workdir(workdir)` — resolves `~`, requires the directory to **exist**
  (`strict=True`), raises `FileNotFoundError`/`NotADirectoryError` otherwise.
  **Removed the `mkdir` that created empty folders.** Codex runs in place via
  `cwd=root`; nothing is copied or created.
- `run_codex_stream(prompt, workdir, settings)` — async generator that streams a
  Codex turn. It runs the blocking SDK stream (`thread.turn(prompt).stream()`) in
  a worker thread and pumps events into an `asyncio.Queue`. Yields
  `{"type":"delta","text":…}` for each `AgentMessageDeltaNotification`, then
  `{"type":"done","text":<full>,"workdir":…}`, or `{"type":"error","message":…}`.
- `run_codex(...)` (non-streaming) still exists and now uses `resolve_workdir`.

**`backend/app/gemini_agent.py`** — edited (by the user, then refined)
- `_system_instruction(workdir)` injects `"The current working directory for
  local work is: {workdir}"` into the system prompt.
- `live_connect_config(settings, workdir=None)` and
  `ask_gemini(message, settings, workdir=None)` now take the workdir and use it
  for Codex handoffs (`args.get("workdir") or session_workdir or default`).
- `ask_gemini` returns `workdir` in its response dict.

**`backend/app/main.py`** — edited
- `ChatRequest` gained `workdir: str | None`. `/api/chat` passes it to
  `ask_gemini` and records it in history.
- **`/api/live` (WebSocket)**: now reads the **opening `config` frame before
  opening the Gemini Live session**, so the workdir is baked into the system
  prompt (not just used for Codex handoffs). `session_workdir` flows through tool
  calls and `turn_complete`. The client sends `{type:"config", workdir}` on
  connect; `send_client_audio` also handles a `config` frame mid-stream.
- **`GET /api/project/info?path=`** — validates the dir exists; returns
  `{path, name, exists, is_git, branch, file_count}`. `branch` via
  `git rev-parse --abbrev-ref HEAD`; `file_count` via `git ls-files` (falls back
  to a shallow count). Used both to validate-on-add and to populate the panel.
- **`POST /api/codex/stream`** — SSE endpoint (`text/event-stream`). Streams the
  `run_codex_stream` events as `data: {json}\n\n`; appends the final assistant
  text to history when done.
- **`POST /api/fs/pick`** — opens a **native OS folder dialog** and returns the
  true absolute path. macOS uses `osascript … choose folder`; Linux falls back to
  `zenity`/`kdialog`. Returns `{path, cancelled}`. This is how Browse gets a real
  absolute path despite the browser limitation.

### Frontend (`frontend/src/main.tsx`, `styles.css`, `index.html`)

- **Full UI redesign** — "Operator Console" aesthetic. Three-pane, collapsible
  layout: **Projects rail | Chat (primary) | Context panel**. Dark + light
  themes (toggle persists). Fonts: Clash Display (display), General Sans (UI),
  JetBrains Mono (mono) loaded in `index.html`. One lime accent for active/live,
  amber for Codex/git.
- **Projects** — create/select/remove projects, each pinned to a folder. Stored
  in `localStorage` (`cva.projects.v1`, `cva.activeProject.v1`,
  `cva.threads.v1`, `cva.theme.v1`). **Per-project chat threads.** The active
  project's `path` is sent as `workdir` on every request (chat, codex, live
  `config` frame).
- **Add Project modal** — validates the folder via `/api/project/info` (404 →
  "directory does not exist"), **rejects duplicate paths**, and **Browse** calls
  `/api/fs/pick` to get the real absolute path + auto-fill the name.
- **Streaming Codex** — in Codex mode, `send()` calls `streamCodex()` which reads
  the SSE stream and appends deltas into the assistant bubble in real time (with
  a blinking caret + "streaming" tag). **TTS is spoken only once, on the final
  text** (`speak()` helper). Agent (Gemini) mode is unchanged (non-streaming,
  TTS/audio on final reply).
- **Live workspace data** — topbar git-branch pill + Workspace card show real
  `branch` and `file_count` from `/api/project/info`; a "folder missing" pill
  shows if the path no longer exists.
- **Bug fixes / polish** — project-card name/path were overlapping (spans weren't
  block-level) → fixed; higher bubble contrast; quick-action chips (List files /
  Git status / Git pull / Summarize) that fire tasks in the active dir.

### Verified during the session
- `npm run build` (tsc + vite) passes.
- Backend imports clean; all routes registered.
- `/api/project/info` returns real data (e.g. branch `main`, 26 files).
- SSE streaming smoke-tested: `hello`→` from`→` cod`→`ex`→`done`.
- Bad path → 404 and **no folder created**.
- The native macOS `choose folder` AppleScript structure compiles and returns a
  POSIX path.

---

## 4. Current repo state

**Everything is uncommitted.** `git status --short`:

```
 M backend/app/codex_runner.py
 M backend/app/gemini_agent.py
 M backend/app/main.py
AM frontend-updated.md
M  frontend/index.html
MM frontend/src/main.tsx
MM frontend/src/styles.css
A  redesign-dark.png  redesign-light.png  redesign-modal.png  (design screenshots)
?? redesign-v2-dark.png
```

`backend/data/history.json` is the global conversation log.

There is a companion doc **`frontend-updated.md`** (design rationale + the full
list of required/optional backend changes with code snippets). It overlaps with
this handover but goes deeper on the frontend design language and the §6 backend
checklist. Keep both in sync if you change behavior.

---

## 5. API surface (current)

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | model + key status, default workdir |
| `GET /api/history` · `DELETE /api/history` | global history (see TODO) |
| `POST /api/chat` `{message, workdir}` | Gemini agent (may hand off to Codex) |
| `POST /api/codex` `{task, workdir}` | direct Codex, non-streaming |
| `POST /api/codex/stream` `{task, workdir}` | **SSE** streaming Codex |
| `WS /api/live` | Gemini Live voice; first frame `{type:"config", workdir}` |
| `POST /api/transcribe` | one-shot audio → text |
| `GET /api/project/info?path=` | validate dir + git branch + file count |
| `POST /api/fs/pick` | native OS folder dialog → absolute path |

---

## 6. What's left to do (prioritized)

1. **Commit the work.** Nothing is committed yet. Suggest a clean commit (branch
   first if you want) once reviewed.

### Completed after this handover

- Added `GET/POST/DELETE /api/projects` with a local `backend/data/projects.json`
  store. The frontend now hydrates projects from the backend and still keeps
  browser storage as a fallback.
- Added `project_id` to chat, direct Codex, streaming Codex, and Live config
  flows. History can now be listed or cleared by project.
- Added a visible Action log for Codex work and handoffs.
- Added a confirmation prompt before obvious risky local tasks such as git
  pulls/pushes, deletes, installs, commits, and file-edit requests.
- Replaced the raw browser confirmation with an in-app Review before running
  modal that shows project, mode, working folder, risk reason, and exact task.
- Added `POST /api/chat/stream` and moved Agent mode to streaming replies.
  Gemini text now appears in the assistant bubble as it arrives, and Agent
  handoffs to Codex show in the Action log.
- Fixed the default-width layout so the chat column no longer expands underneath
  the context panel, and suggestion chips stay inside the chat column.

---

## 7. How to run & test

```bash
# Backend (from repo root)
uv run run.py            # serves on http://127.0.0.1:8765

# Frontend (separate terminal)
cd frontend && npm run dev   # Vite proxies /api → backend; open the shown URL
```

Notes:
- **Use `npm run dev`, not `npm run preview`**, when testing API calls — only the
  dev server proxies `/api` to the backend (preview config has no proxy).
- After backend code changes, **restart `run.py`** (no auto-reload assumed).
- `.env` needs `GOOGLE_API_KEY`. Codex uses the existing local Codex login.
- `/api/fs/pick` opens a **real GUI dialog** on the host — don't call it from
  headless automation (it blocks waiting for the user).

---

## 8. Important gotchas

- **No copies / no mkdir.** Never reintroduce directory creation in
  `codex_runner`. The contract is: operate on the **original existing folder**,
  in place. Validate, don't create.
- **Browser can't read absolute paths.** Any "pick a folder" UX must go through
  `/api/fs/pick` (backend native dialog). `showDirectoryPicker` only yields the
  folder name and must not be trusted as a path.
- **Live voice workdir timing.** The Gemini Live system prompt is fixed at
  connect time, so the workdir **must** be read from the `config` frame *before*
  `client.aio.live.connect(...)`. Don't move that read back after connect.
- **TTS once, at the end.** When adding streaming anywhere, accumulate deltas for
  display but only call `speak()` / play audio on the final text — per the user's
  explicit request.
- **Codex SDK streaming shape.** Use `thread.turn(prompt).stream()` and filter
  `AgentMessageDeltaNotification` (`.delta`) for assistant text; end on
  `TurnCompletedNotification`. The blocking iterator must be bridged to async via
  a thread + queue (see `run_codex_stream`).

---

## 9. Quick orientation map

```
backend/app/
  main.py          FastAPI app + all routes (chat, codex, codex/stream, live,
                   project/info, fs/pick, history, transcribe)
  gemini_agent.py  Gemini Live config, ask_gemini, system instruction w/ workdir,
                   transcription, PCM→WAV
  codex_runner.py  resolve_workdir (validate, no copy), run_codex, run_codex_stream
  history.py       global JSON history store (per-project = TODO)
  settings.py      env-driven settings (GOOGLE_API_KEY, models, default workdir,
                   codex approval/sandbox modes)
frontend/
  index.html       fonts + theme bootstrap
  src/main.tsx     entire UI: projects, 3-pane layout, modal, live voice hook,
                   streaming send, context panel
  src/styles.css   "Operator Console" design system (dark + light)
frontend-updated.md  design rationale + backend change checklist (§6)
HANDOVER.md          this file
```
