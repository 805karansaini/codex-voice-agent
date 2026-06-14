# Frontend Redesign — "Operator Console"

> **Update 2 (2026-06-06)** — addressed direct feedback:
> - **No copies, ever.** `codex_runner.resolve_workdir()` now validates the folder
>   exists and runs **in place**; the old `mkdir(parents=True)` that silently
>   created empty folders (the "copy" you saw with `interview-automation`) is gone.
> - **Add-project validates + de-dupes.** The modal calls `GET /api/project/info`
>   to confirm the directory exists and resolves it; duplicate paths are rejected.
> - **Live workspace data.** `GET /api/project/info` returns git branch + file
>   count, shown in the topbar pill and Workspace card.
> - **Streaming Codex + end-only TTS.** `POST /api/codex/stream` (SSE) streams
>   `AgentMessageDeltaNotification` deltas into the bubble in real time; TTS speaks
>   only once, on the final text.
> - **UI fixes.** Project-card name/path no longer overlap (block layout), higher
>   bubble contrast, streaming caret + indicator.
> - **Live voice workdir timing fix** — the Gemini Live session now reads the
>   opening `config` frame *before* connecting, so the working directory is in the
>   system prompt (not just used for Codex handoffs).
>
> **Update 3 (2026-06-06)** — product hardening:
> - **Server project store.** Added `GET/POST/DELETE /api/projects` backed by
>   `backend/data/projects.json`; the frontend hydrates from the backend and keeps
>   browser storage as a fallback.
> - **Per-project history.** Chat, direct Codex, streaming Codex, and Live voice
>   now include `project_id`; `/api/history` can list or clear a single project.
> - **Action log.** The context panel now shows recent local Codex actions and
>   whether they are running, done, or failed.
> - **Risky-action confirmation.** Obvious file/git/dependency-changing prompts
>   open an in-app Review before running modal before running in the selected
>   folder. The modal shows project, mode, folder, risk reason, and exact task.
> - **Agent streaming.** Added `POST /api/chat/stream`; Agent mode now streams
>   Gemini text into the assistant bubble and records Codex handoffs in the
>   Action log.
> - **Responsive polish.** The chat column is constrained to its real grid column,
>   and suggestion chips no longer overflow into the context panel.
>
> §6 items 6.1, 6.2, 6.3, 6.4, and 6.5 are now **done**. Remaining: commit the
> work once reviewed.

---


> A full visual + structural redesign of the Codex Voice Agent UI, plus a new
> **Projects** concept that scopes every chat / voice / Codex task to a chosen
> directory on this machine.

---

## 1. The philosophy (what we're building toward)

Today the app talks to one fixed working directory (`$HOME` →
`/Users/karansaini`). That's why asking "what is my present working directory?"
always answers `/Users/karansaini`, and "do a git pull" has no repo to act on.

The product we want is a **local operator console**: a place where you keep
several **projects**, each pinned to a real folder. When a project is active:

- its folder becomes the **present working directory** for everything,
- "how many files do I have?" counts *that* folder,
- "git pull" / "git status" runs inside *that* repo,
- Codex edits/builds/tests happen *there*,
- each project keeps its **own chat thread**.

Think Codex app / T3 Chat: a left rail of workspaces, a focused chat in the
middle, and a context panel on the right showing exactly where work is landing.

This document covers the **frontend** (done) and the **backend changes
required** to make the working-directory promise fully real (to do).

---

## 2. Design language

| Aspect | Choice | Why |
|---|---|---|
| **Aesthetic** | Refined dark "operator console" (light theme included) | Premium, calm, developer-native — not the old washed sage/white look |
| **Display font** | **Clash Display** | Distinctive, confident headings (project names, empty states) |
| **UI font** | **General Sans** | Clean, characterful body text — replaces generic system font |
| **Mono** | **JetBrains Mono** | Paths, timestamps, debug log, keycaps — reinforces the terminal context |
| **Base** | Ink scale `#0a0b0d → #24272e`, hairline borders | Layered depth instead of flat panels |
| **Signal accent** | Electric **lime** `#c8f23a` | One memorable colour — used *only* for active/live/primary actions |
| **Secondary** | Warm **amber** `#f3b85a` | Reserved for Codex handoffs / git actions |
| **Texture** | Soft radial gradients + faint film grain overlay | Atmosphere and depth, avoids the "flat AI template" feel |
| **Motion** | Staggered message reveals, live equalizer, pulsing mic glow, modal pop | High-impact moments, all CSS, `prefers-reduced-motion` respected |

Both **dark and light** themes ship; toggle lives at the bottom of the rail and
persists to `localStorage`.

---

## 3. Layout — from cramped to three-pane

**Before:** a left rail, a large mostly-empty "agent canvas", and a narrow,
hard-to-read chat squeezed on the right.

**After:** a purposeful three-column shell, each column independently
scrollable and individually collapsible.

```
┌───────────────┬─────────────────────────────┬──────────────────┐
│ PROJECTS RAIL │          CHAT (primary)      │  CONTEXT PANEL   │
│               │                              │                  │
│ + New project │  topbar: project · cwd pill  │  Workspace       │
│ ▸ Project A   │          · git · mode · live │  Quick actions   │
│ ▸ Project B   │                              │  Codex handoffs  │
│   ...         │  message stream (bubbles)    │  Live debug      │
│               │                              │  Voice output    │
│ ● status  ☾   │  live banner + composer      │                  │
└───────────────┴─────────────────────────────┴──────────────────┘
```

- **Projects rail** — brand, lime **New project** button, the project list
  (glyph, name, truncated path, active indicator), backend status + theme toggle.
- **Chat** — now the *primary* surface. Topbar shows the active project, a
  **working-directory pill**, a git pill, the **Agent / Codex** mode toggle, a
  run-state chip (Idle / Working / Live), and a panel toggle. Roomy chat bubbles
  with per-message **Codex** tags, a typing skeleton, and rich empty states with
  clickable suggestions.
- **Context panel** — Workspace facts (project, working dir, model, message
  count), **Quick actions** (List files / Git status / Git pull / Summarize —
  each fires a task in the active directory), **Codex handoffs** feed, **Live
  debug** log, and **Voice output** settings.
- Either side rail collapses to a slim reopen tab; below 980px the side panes
  hide for a single-column mobile view.

---

## 4. New feature: Projects (frontend behaviour)

- **Add project** modal: name + **absolute directory path** + accent colour.
  If the browser supports the File System Access API, a **Browse** button
  suggests a folder *name* (browsers can't expose absolute paths, so the path
  field is the source of truth — this is clearly explained inline).
- **Switching** projects swaps the active chat thread and the working directory
  used by every request.
- **Per-project chat threads**, project list, active selection, and theme are
  persisted in `localStorage` (`cva.projects.v1`, `cva.threads.v1`,
  `cva.activeProject.v1`, `cva.theme.v1`).
- **Remove project** clears its local thread.
- The active project's `path` is now **sent as `workdir`** on every request:
  - `POST /api/codex` → `{ task, workdir }`  ✅ already honoured by backend
  - `POST /api/chat`  → `{ message, workdir }`  ⚠️ *currently ignored — see §6*
  - `WS /api/live`    → a `{ type: "config", workdir }` frame on connect
    ⚠️ *currently ignored — see §6*

---

## 5. Files changed (frontend only)

| File | Change |
|---|---|
| `frontend/index.html` | Fontshare (Clash Display, General Sans) + Google (JetBrains Mono) links, `data-theme`, theme-color, title |
| `frontend/src/styles.css` | **Full rewrite** — design tokens, three-pane shell, rail, chat, composer, context panel, modal, animations, light theme, responsive |
| `frontend/src/main.tsx` | **Full rewrite** — Projects state + `localStorage`, Add Project modal, per-project threads, three-pane UI, context panel, theme toggle, collapsible panes; `workdir` now sent to chat/codex/live. Reuses the existing `useLiveVoice` hook; removed dead `useSpeech`/manual-transcribe code that wasn't wired into the UI |

No backend files were modified. `npm run build` (tsc + vite) passes cleanly.

---

## 6. Backend changes REQUIRED to fulfil the vision

The frontend already *sends* the working directory everywhere. Three of the
paths don't yet *use* it. These are the changes needed to make the
"present working directory = the project folder" promise actually true.

### 6.1 `POST /api/chat` — accept and use `workdir` (high priority)

`ChatRequest` only has `message`, and `ask_gemini()` ignores per-request
workdir, so Gemini's Codex handoffs fall back to `codex_default_workdir`
(`$HOME`). Plumb the project directory through.

```python
# backend/app/main.py
class ChatRequest(BaseModel):
    message: str
    workdir: str | None = None      # NEW

@app.post("/api/chat")
async def chat(req: ChatRequest):
    ...
    result = await ask_gemini(req.message.strip(), settings, workdir=req.workdir)
```

```python
# backend/app/gemini_agent.py  — ask_gemini(...)
async def ask_gemini(message, settings, workdir: str | None = None):
    ...
    # when a tool call comes back:
    chosen = str(args.get("workdir") or workdir or settings.codex_default_workdir)
    codex_result = await run_codex(task, chosen, settings)
```

> Also recommended: inject the active directory into the system prompt
> (e.g. `"The current working directory is {workdir}."`) so plain answers like
> "what's my pwd?" are correct even when Codex isn't invoked.

### 6.2 `WS /api/live` — read the `{ type: "config", workdir }` frame (high priority)

`live_voice()` hardcodes `workdir = args.get("workdir") or settings.codex_default_workdir`.
Capture the config frame the client sends on connect and use it as the default
for that session.

```python
# in send_client_audio(...) loop
elif event_type == "config":
    nonlocal session_workdir
    session_workdir = str(payload.get("workdir") or "") or session_workdir

# where Codex is invoked in receive_gemini(...)
workdir = str(args.get("workdir") or session_workdir or settings.codex_default_workdir)
```

(Initialise `session_workdir = settings.codex_default_workdir` at the top of the
handler.)

### 6.3 Per-project history (medium priority)

`HistoryStore` is a single global `history.json`. The frontend currently keeps
threads per-project in `localStorage`, which works but isn't shared across
devices/sessions and mixes with the backend's global log. Recommended:

- Key history by project, e.g. `backend/data/history/<project_id>.json`, or add
  a `workdir` / `project_id` column and filter on read.
- Add `project_id` to the chat/codex request bodies (trivial frontend addition)
  and to `history.append(...)`.

### 6.4 Project info endpoint (nice-to-have — lights up real metadata)

To replace the static "working dir" pill with a **real git branch + file
count**, add a read-only endpoint the panel can call when a project is selected:

```python
@app.get("/api/project/info")
async def project_info(path: str):
    root = Path(path).expanduser()
    if not root.is_dir():
        raise HTTPException(404, "Directory not found")
    branch = subprocess.run(["git","-C",str(root),"rev-parse","--abbrev-ref","HEAD"],
                            capture_output=True, text=True).stdout.strip() or None
    file_count = sum(1 for _ in root.rglob("*") if _.is_file())  # or git ls-files
    return {"path": str(root), "branch": branch, "file_count": file_count, "exists": True}
```

The frontend already has slots for `branch` / `file_count`; wiring this in turns
the git pill and Workspace card into live data. (A `GET /api/project/validate`
to confirm a path exists when adding a project is a natural companion.)

### 6.5 Persisted projects (optional)

Projects live in `localStorage` today. If you want them shared/server-side, add
`GET/POST/DELETE /api/projects` backed by a small JSON store and have the
frontend hydrate from it instead of (or in addition to) `localStorage`.

---

## 7. Suggested rollout order

1. **6.1 + 6.2** — make the working directory real for chat and live voice
   (this is the core of the user's request).
2. **6.4** — real git branch + file count in the UI.
3. **6.3** — per-project server history.
4. **6.5** — server-side project store (multi-device).

Once 6.1/6.2 land, the demo works end-to-end: pick a project → "how many files
do I have?" / "git pull" → it runs in that folder. ✅

---

## 8. How to run

```bash
# backend
cd /Users/karansaini/Projects/codex-voice-agent && uv run run.py
# frontend
cd /Users/karansaini/Projects/codex-voice-agent/frontend && npm run dev
```

Open the Vite URL, click **New project**, paste an absolute folder path, and
start chatting. Reference screenshots: `redesign-dark.png`, `redesign-light.png`,
`redesign-modal.png`.
