# Codex Voice Agent — Code Review & Product Roadmap

> Reviewed 2026-06-09. Covers `backend/app/*` (~3.2k lines), `frontend/src/*` (~4.2k lines),
> configs, and repo hygiene. Organized by priority: **P0 = broken/dangerous now**,
> **P1 = should fix before calling it a product**, **P2 = quality/polish**, then
> **new features**.

---

## 1. P0 — Security (this is the biggest gap between "cool demo" and "product")

The app is, by design, a remote-code-execution service: it accepts a task string and
runs an autonomous coding agent with `CODEX_SANDBOX_MODE=danger-full-access` and
`CODEX_APPROVAL_MODE=never`. That's fine for localhost — but nothing restricts it to you:

- **S1. No authentication anywhere.** `run.py` binds `0.0.0.0:8765`, Vite binds
  `0.0.0.0:5173` with `allowedHosts: true`, and the CORS regex in `main.py:48`
  deliberately allows every `192.168.*`, `10.*`, and `172.16-31.*` origin. Anyone on
  your Wi-Fi can `POST /api/codex` and execute arbitrary commands on your Mac with
  full filesystem access.
  **Fix:** add a shared bearer token (env var, checked by FastAPI dependency + WS
  query param, sent by the frontend from `VITE_API_TOKEN`). One afternoon of work,
  closes the whole class.
- **S2. The WebSocket `/api/live` has no origin or token check at all** — `accept()`
  is unconditional (`main.py:549`). Same fix as S1.
- **S3. Dangerous defaults in `.env.example` and `settings.py`:**
  `danger-full-access` + `never` approval + default workdir `$HOME`. A hallucinated
  or malicious task can touch anything in your home directory. Default should be
  `workspace-write` sandbox scoped to the active project, with full-access as an
  explicit opt-in per project (and surfaced in the UI as a red badge).
- **S4. No request limits.** `/api/transcribe` base64-decodes an unbounded body;
  audio frames on the WS are unbounded; no rate limiting. Add body size caps
  (FastAPI/uvicorn `limit_max_request_size` or manual checks) once auth exists.
- **S5. `/api/fs/pick` pops a native folder dialog on the host** for any caller —
  harmless data-wise, but a great way for someone on the LAN to spam dialogs on your
  Mac. Gate behind auth like everything else.
- **S6. `/api/history` with no params returns the entire message history** across all
  projects (`history.list()` unfiltered). Combined with S1, that's every conversation
  readable on the LAN.

---

## 2. P0 — Real bugs found in the code

- **B2. Infinite sleep loop to "park" the session (`main.py:884-885`).**
  After `end_conversation`, the server does `while True: await asyncio.sleep(3600)`
  inside the receive task and relies on the *client* to close the socket. If the
  client never does (browser closed, network drop without FIN), the task, the
  Gemini Live connection, and the websocket all leak until the process restarts.
  Fix: break out of the receive loop and let the normal teardown path
  (`asyncio.wait(FIRST_COMPLETED)` → cancel → `websocket.close()`) run, optionally
  after a short grace delay so the goodbye audio flushes.

- **B3. Artifacts leak on chat/project deletion.** `DELETE /api/chats/{chat_id}`
  (`main.py:309-315`) clears chats, history, and console but **not**
  `artifacts.clear(chat_id)`. Same for `DELETE /api/projects/{project_id}`
  (`main.py:266-274`). Only the separate `DELETE /api/history` path clears
  artifacts. Orphaned rows accumulate in `artifacts.sqlite3` forever.

- **B4. Dead N+1 enrichment in `GET /api/history` (`main.py:209-223`).** Every
  artifact in the codebase is created with `message_id=None` (all five call sites),
  so `artifacts.list(message_id=...)` can never match — yet the endpoint runs one
  SQLite query *per history row* on every fetch. Either thread real message ids
  through `_create_tool_artifact` (append the assistant history row first, pass its
  id) or delete the loop and rely on `meta["artifacts"]` which is already persisted.

- **B5. History primary key is a timestamp (`history.py:142-156`).**
  `id = datetime.now(timezone.utc).isoformat()` is the PRIMARY KEY. Two appends in
  the same microsecond (entirely possible: user + assistant rows are written
  back-to-back in voice turn_complete) raise `IntegrityError` and lose the message.
  Use `uuid4` for id and keep `created_at` as a separate ordering column (it already
  exists). Also add a real `chat_id` column instead of `json_extract` everywhere —
  the expression indexes work, but plain columns are simpler and faster.

- **B6. Codex thread sessions never expire (`codex_runner.py:62`).** `_sessions`
  grows one `AsyncCodex` subprocess per chat and only shrinks on chat deletion or
  server shutdown. A week of normal use = dozens of idle Codex processes. Add idle
  TTL eviction (e.g. close after 30 min unused; store `last_used` on the session)
  and an LRU cap.

- **B7. Frontend/backend message stores silently diverge.** Messages live in
  `localStorage` (`useProjectStore.ts`, `LS_MESSAGES`) *and* in backend SQLite, and
  hydration only happens when the local copy is empty
  (`useProjectStore.ts:130-144`). Voice turns recorded on the backend while the tab
  was closed never appear; a cleared localStorage resurrects deleted local edits;
  two browsers show different conversations. Pick one source of truth — the backend
  — and make localStorage a cache (always merge server rows by id, or just refetch
  per chat on open). This is the root cause of most "ghost message" weirdness.

- **B8. `readSseStream` only parses the first `data:` line per frame**
  (`App.tsx:74-79`). The backend currently emits single-line frames, so it works,
  but any multi-line `data:` (legal SSE, and likely once payloads embed newlines)
  silently drops data. Iterate all `data:` lines and join per spec.

- **B9. `ProjectStore.upsert` silently deletes other projects sharing a path**
  (`history.py:327`): the filter drops any row matching the new project's id *or*
  path. Path-dedupe is intentional, but it should be surfaced to the user (409 or
  merge), not a silent removal that orphans that project's chats.

- **B10. Stale-closure hazard in `connectSocket`/`stop`** (`useLiveVoice.ts`):
  `stop` is in `connectSocket`'s dependency array and `connectSocket` reschedules
  itself via `reconnectTimerRef`. It works today because everything goes through
  refs, but the reconnect timer survives a re-render that replaces `connectSocket`
  — wrap reconnection state more carefully or move the whole socket lifecycle into
  a class/ref like `AudioStreamPlayer` already is.

---

## 3. P1 — Architecture & duplication (streamlining)

- **A1. ~200 duplicated lines: `ask_gemini` vs `ask_gemini_stream`**
  (`gemini_agent.py:171-290` vs `293-498`). They differ only in yield-vs-collect.
  The non-stream `/api/chat` endpoint isn't even called by the current frontend.
  Delete `ask_gemini` + `/api/chat`, or implement the non-stream version as
  "consume the stream" (the pattern `run_codex` already uses over
  `run_codex_stream`). Same for `/api/codex` (non-stream) — keep one and derive
  the other.

- **A2. Text chat shouldn't use the Live API.** `ask_gemini_stream` opens a
  *realtime audio* connection (`client.aio.live.connect`) for typed text messages,
  returns base64 WAV in `audio_data_url`, and uses live-session semantics for a
  single request/response. Use `generate_content(stream=True)` with the same tool
  declarations: cheaper, faster, no websocket fragility, and you keep multi-turn
  function-calling. The live connection should be exclusively for `/api/live`.

- **A3. The `/api/live` handler is a 550-line function** (`main.py:547-1101`) with
  ~10 `nonlocal` state vars and duplicated turn-persistence blocks (the
  `session_ended_by_tool` path at 826-885 repeats the `turn_complete` path at
  941-1021 almost verbatim — that's how bug B1 slipped in). Extract a
  `LiveTurnState` class holding chunks/codex-state with `persist_turn()` and
  `reset()` methods; both code paths call it. This file should become ~150 lines.

- **A4. Four storage backends for one app.** History + artifacts are SQLite;
  projects, chats, console are whole-file-rewrite JSON; app events are JSONL.
  Consolidate projects/chats/console into the same SQLite DB (one file, real
  transactions, no read-modify-write races between the two JSON locks). Keep JSONL
  for logs only.

- **A5. `App.tsx` is 2,146 lines.** Extract: `ArtifactCard`, `CodexTimeline`
  (already components — move to files), `ChatPanel`, `ExplorerSidebar`,
  `ConsolePanel`, `Composer`, `VoiceBanner`, and the SSE handling
  (`streamAgent`/`streamCodex` share ~70% — one `useStreamingChat` hook with a
  mode flag). Target: App.tsx under 300 lines of layout.

- **A6. Deprecated APIs:** `@app.on_event("startup"/"shutdown")` → FastAPI
  lifespan context (`main.py:77-85`); `createScriptProcessor` fallback is fine to
  keep but log when it's used; React 19 + `ScriptProcessorNode` will eventually
  bite on Safari.

- **A7. Settings gaps:** `history_path` is hardcoded (`settings.py:24`) — make it
  env-configurable (`DATA_DIR`); `run.py` hardcodes port 8765 and `log_level="debug"`
  (noisy; make both env-driven); the `false_tool_claim` keyword list
  (`main.py:949-956`) is detection-only — either act on it (auto-nudge the model
  with a system message, see F4) or move it to the logger.

---

## 4. P1 — Reliability & correctness details

- **R1. Cancel doesn't reach ephemeral Codex runs.** `cancel_task` only calls
  `interrupt_codex_thread_session`, which requires a chat-keyed session. The HTTP
  stream paths create a `CancellationToken` that `_stream_turn` checks *between
  events* — a long-running command emits no events, so cancel waits for it. Call
  `turn.interrupt()` directly when the token flips (store the active turn on the
  token), not just opportunistically inside the event loop.
- **R2. Voice reconnect loses the Gemini session.** On WS close with a live mic,
  the client reconnects (`useLiveVoice.ts:473-493`) — but the server builds a brand
  new Gemini session whose system prompt contains only persisted history. Anything
  said in the open turn is gone, with no UI hint. At minimum surface "session
  restarted — context up to your last completed turn" in the chat.
- **R3. `turn_complete` fallback texts pollute history.** `assistant_text` defaults
  to `"Done."` and `userText || "Voice message"` (`useLiveVoice.ts:357-362`,
  `main.py:943`), so noise-triggered empty turns persist junk rows. Skip persisting
  turns where both sides are empty.
- **R4. The 25s `TOOL_RESULT_FALLBACK_MS` and the backend's 20s/60s status timer are
  magic numbers** that interact (status events reset nothing; the fallback only
  clears on transcript). Document the state machine or derive one from the other.
- **R5. `_artifact_content_type` classifies nearly everything as markdown**
  (`main.py:117-120` — `"- "`, `` ` ``, `|` match most shell output). Use a
  cheaper rule: markdown only if Codex's final message; command output → `text`.
- **R6. Token estimate is `chars/4.2`** (`App.tsx:2119`) and counts only message
  text, not codex events/artifacts that get injected as context. Fine as a hint —
  label it "≈".
- **R7. `speak()` truncates TTS to 500 chars mid-word** (`App.tsx:499`). Truncate at
  sentence boundary and say so.
- **R8. Native `window.prompt`/`window.confirm` for rename/delete** (`App.tsx:1116-1132`)
  — blocks the event loop and behaves inconsistently across browsers. Replace with
  small in-app modals (AddProjectModal already sets the pattern).
- **R9. `transcribe` endpoint + `pendingAudioUrl`/`SILENT_WAV` plumbing appear to be
  vestiges of the pre-Live push-to-talk flow.** If nothing calls `/api/transcribe`,
  delete it and the autoplay-unlock machinery, or keep it and document it as the
  fallback path.
- **R10. `console.json` debounce races:** the 250ms debounced `saveConsoleState`
  (`App.tsx:414-424`) can fire after switching chats (guard exists via
  `consoleLoadedChatRef` — good), but two tabs editing the same chat still
  last-write-wins over the whole console blob. Acceptable locally; worth a note.

---

## 5. P2 — Code quality, DX, repo hygiene

- **Q1. Zero tests.** There's a `.pytest_cache` but no test files. Highest-value
  starters: `prompting.py` sanitizers, `history.py` stores (pure, fast),
  `_normalize_event`, `appendCodexEvent`/`appendArtifact` dedupe, `readSseStream`
  framing. None require mocking Gemini.
- **Q2. No linting/formatting config:** add `ruff` + `ruff format` (backend),
  `eslint` + `prettier` (frontend), `mypy`/`pyright` would catch B1-style scoping
  bugs (`pyright` flags the unused local assignment).
- **Q3. No CI.** A 5-minute GitHub Actions workflow: ruff + pyright + pytest +
  `tsc --noEmit` + eslint. The repo is git-hosted; this is free insurance.
- **Q4. Repo bloat:** `Code-Companion-Pro/` (a whole second Lovable app),
  `Code-Companion-Pro.zip`, `frontend-updated.md`, `HANDOVER.md`,
  `REALTIME_VOICE_AGENT_PLAN.md`, `frontend-verification.png`, and `backend/data/*`
  (your actual chat history — `chats.json`, `history.json`, `console.json`) are in
  or about to be in version control. Move data dirs into `.gitignore`, archive the
  planning docs into `docs/`, delete the zip.
- **Q5. `python-genai` pinned to `1.33.0`** — Live API is moving fast; document why
  it's pinned or move to a compatible range with a lockfile (uv.lock already does
  the real pinning).
- **Q6. Logging:** `live_sessions.jsonl` and `app_events.jsonl` grow forever — add
  rotation or size caps. Also the websocket exception handler string-matches
  `"generator didn't stop after throw()"` (`main.py:1072`) — fragile; match the
  exception type or at least comment which library version produces it.
- **Q7. Accessibility/keyboard:** no focus management when panels toggle, no
  `Cmd+K`-style chat switcher, no `aria-live` on streaming responses. The voice
  banner is great visually but invisible to screen readers.
- **Q8. README drift:** README still says history lives in
  `backend/data/history.json` — it's `history.sqlite3` now. Document the auth token
  once S1 lands, and the data dir layout.

---

## 6. New features

### ⭐ F1 (the flagship): Change Review — see, approve, and revert what Codex did

Right now Codex edits files with full access and the user's only window into it is a
transient timeline of "Applying file changes." For a tool whose whole job is
*modifying your code by voice*, the killer missing feature is trust:

- Backend: after each Codex turn that produced `fileChange` items, capture
  `git diff` (and `git status`) in the workdir; store it as a first-class artifact
  (`content_type: "diff"`); include changed-file list in the `tool_result` event.
- Frontend: light up the disabled **Files** rail tab as a per-turn diff viewer
  (Monaco-style or a simple unified-diff renderer with syntax highlighting).
  Each assistant message that changed files gets a chip: **"3 files changed +84 −12 — Review"**.
- Actions: **Revert this turn** (`git stash`/`git checkout -- <files>` of just that
  turn's files), **Commit this turn** (generated commit message from the task), and
  a standing **auto-commit checkpoint before every Codex turn** option so revert is
  always safe even in dirty trees.
- Voice integration: "what did you just change?" answers from the stored diff
  artifact instead of re-running Codex (the artifact-reference plumbing in
  `_chat_context` already exists — this slots right in).

This converts the scariest property of the app (autonomous edits) into its most
impressive demo ("change it… show me… revert it") and reuses existing
infrastructure: artifacts, the git helpers in `main.py` (`_git_branch`), and the
console panel.

### F2: Background task queue with voice notifications

Long Codex tasks currently hold the conversation hostage (the live session blocks in
the tool-call loop; the 20s status timer is a band-aid). Instead:

- "Run the test suite and tell me when it's done" → enqueue the task, return the
  tool response immediately ("Started — I'll tell you when it finishes"), keep
  talking.
- A small in-process job table (id, chat_id, task, status, result) + the existing
  `run_codex_stream`; on completion, inject a notification into the live session
  (Gemini Live supports server-sent turns) or surface a banner in the chat if voice
  has ended.
- The Console "Actions" tab becomes the job monitor (it already renders
  running/done/failed — wire it to real jobs instead of UI-local state).
- Add a local desktop notification when a background job finishes.

### F3: Persistent Codex threads across restarts

`codex_threads` already returns `thread_id`s and you persist them in history meta —
but on server restart every chat loses its Codex session memory. Store
`codex_thread_id` per chat and use the SDK's thread-resume (if exposed) or feed a
summarized recap on first turn. Cheap, and "it remembered where we left off
yesterday" is a wow moment for a voice tool.

### F4: Close the loop on hallucinated tool calls

You detect `false_tool_claim` (`main.py:947-956`) and sanitize transcripts
(`prompting.py`), but the model gets no feedback. When detected, send a
non-spoken corrective turn back into the session ("You claimed to run a tool but no
tool was called. Call run_codex_task now.") — in practice this makes the model
immediately issue the real call, turning a logged failure into a self-healing one.

### F5: Project briefing on session start

When a voice session connects (or a project is opened), prefetch git status, branch,
last 3 commits, and dirty-file count (you already have `_git_branch`/`_file_count`)
and put it in the system prompt. Then "good morning, what's the state of the repo?"
answers instantly without a Codex round-trip — huge perceived-latency win for the
most common opening question.

### F6: Smaller but worthwhile

- **Search across chats/artifacts** (SQLite FTS5 on history + artifacts — ~30 lines).
- **Export chat as markdown** (it's already markdown-rendered).
- **Multiple workdirs per project / monorepo subpaths** (chat-level workdir override
  is already half-supported by the tool schema's `workdir` param — it's currently
  ignored in favor of `session_workdir`; honor it after validating it's inside the
  project root).
- **Wake word / push-to-talk toggle** on mobile, where open-mic burns battery.
- **Cost/usage meter**: Gemini Live + Codex usage per chat (token usage events are
  already in the Codex stream: `thread/tokenUsage/updated` — currently summarized
  and thrown away).
- **Onboarding doctor**: `GET /api/health` already reports key presence — add a
  first-run screen checking Google key, Codex login, git availability, and mic
  permission with fix-it hints.

---

## 7. Suggested order of attack

| # | Item | Size |
|---|------|------|
| 1 | S1+S2+S3: token auth, WS auth, safe sandbox defaults | S |
| 2 | B1–B6 bug fixes (each is small and isolated) | S |
| 3 | B7: backend as single source of truth for messages | M |
| 4 | A1+A2: delete dead non-stream paths, text chat off Live API | M |
| 5 | Q1–Q4: ruff/eslint/pytest/CI + repo cleanup | S |
| 6 | A3+A5: decompose the live handler and App.tsx | M |
| 7 | **F1: Change Review (diff/approve/revert)** | L — the feature |
| 8 | F2: background task queue | M |
| 9 | F4+F5: hallucination feedback + project briefing | S |

The theme: this codebase has already solved the *hard* problems (live audio
pipeline, tool-call orchestration, streaming, session reuse, tracing). What stands
between it and a product is trust (security + change review), one source of truth
for data, and deleting the duplicated halves it has outgrown.
