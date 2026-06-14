# Codex Voice Agent - Product Progress

Updated: 2026-06-14

Source material:
- `PRODUCT_REVIEW.md`, reviewed 2026-06-09
- Git commits from 2026-06-10 onward, inclusive

This file tracks what has been completed from the product review and what still remains.

## Completed Since 2026-06-10

### P0 Security And Safety

- [x] Added token-based access control for local HTTP and WebSocket use.
  - Commit: `4a99bc4` - Harden local agent access and fix review bugs
  - Covers review items: S1, S2, S5
- [x] Moved toward safer runtime defaults and documented safer local setup.
  - Commit: `4a99bc4` - Harden local agent access and fix review bugs
  - Covers review item: S3
- [x] Added request/body size protection for audio and local API paths.
  - Commit: `4a99bc4` - Harden local agent access and fix review bugs
  - Covers review item: S4
- [x] Required history reads to be scoped instead of returning all project history by default.
  - Commit: `114fb15` - Require scoped history reads
  - Covers review item: S6

### P0 Bugs

- [x] Fixed the unclosed voice tracing generation issue.
  - Commit: `4a99bc4` - Harden local agent access and fix review bugs
  - Covers review item: B1
- [x] Stopped the live session from parking forever after conversation end.
  - Commit: `4a99bc4` - Harden local agent access and fix review bugs
  - Covers review item: B2
- [x] Cleared artifacts when chats or projects are deleted.
  - Commit: `4a99bc4` - Harden local agent access and fix review bugs
  - Covers review item: B3
- [x] Removed the dead artifact lookup pattern from history reads.
  - Commit: `4a99bc4` - Harden local agent access and fix review bugs
  - Covers review item: B4
- [x] Added real history scope columns and more reliable history identifiers.
  - Commit: `086a19e` - Add history scope columns
  - Covers review item: B5
- [x] Added idle cleanup for Codex sessions.
  - Commit: `4a99bc4` - Harden local agent access and fix review bugs
  - Covers review item: B6
- [x] Tightened project-scoped message hydration from backend history.
  - Commit: `4a99bc4` - Harden local agent access and fix review bugs
  - Partially covers review item: B7
- [x] Stopped booting chat messages from localStorage and preserved only in-flight local messages during backend history hydration.
  - Commit: Prefer backend history for chat messages
  - Partially covers review item: B7
- [x] Stopped booting project and chat lists from localStorage.
  - Commit: Prefer backend project and chat lists
  - Covers remaining review item: B7
- [x] Consolidated projects, chats, and console state into SQLite.
  - Commit: `d2cad75` - Store project metadata in SQLite
  - Covers review item: A4
  - Notes: legacy `projects.json`, `chats.json`, and `console.json` are migrated into `history.sqlite3` on startup; app event logs remain JSONL.
- [x] Fixed Server-Sent Events parsing so multi-line data is handled correctly.
  - Commit: `4a99bc4` - Harden local agent access and fix review bugs
  - Covers review item: B8
- [x] Added project path conflict handling instead of silently deleting a matching project.
  - Commit: `4a99bc4` - Harden local agent access and fix review bugs
  - Covers review item: B9
- [x] Removed the stale reconnect callback hazard in the live voice hook.
  - Commit: Stabilize live voice reconnect callbacks
  - Covers review item: B10

### P1 Architecture And Cleanup

- [x] Removed unused non-stream chat endpoints.
  - Commit: `8e8a8e6` - Remove unused non-stream chat endpoints
  - Covers review item: A1
- [x] Moved typed chat off the Live API.
  - Commit: `cc3f545` - Move typed chat off Live API
  - Covers review item: A2
- [x] Added configurable local data storage.
  - Commit: `c6950ee` - Add CI and configurable data storage
  - Partially covers review item: A7
- [x] Replaced deprecated FastAPI startup/shutdown hooks with a lifespan context.
  - Commit: `c6950ee` - Add CI and configurable data storage
  - Covers review item: A6
- [x] Removed the stale transcription path.
  - Commit: `fbc9944` - Remove stale transcription path
  - Covers review item: R9
- [x] Logged when the microphone fallback path is used.
  - Commit: `c9853ad` - Log microphone fallback path
  - Partially covers review item: A6
- [x] Moved artifact rendering out of the large `App.tsx` file.
  - Commit: Extract artifact card component
  - Partially covers review item: A5
- [x] Moved Codex timeline rendering out of the large `App.tsx` file.
  - Commit: Extract Codex timeline component
  - Partially covers review item: A5
- [x] Moved the Change Review chip out of the large `App.tsx` file.
  - Commit: Extract change review chip component
  - Partially covers review item: A5
- [x] Moved confirm and rename dialogs out of the large `App.tsx` file.
  - Commit: Extract chat action modals
  - Partially covers review item: A5
- [x] Moved the chat top bar out of the large `App.tsx` file.
  - Commit: Extract chat top bar component
  - Partially covers review item: A5
- [x] Moved the composer footer out of the large `App.tsx` file.
  - Commit: Extract composer footer component
  - Partially covers review item: A5
- [x] Moved the console tab strip out of the large `App.tsx` file.
  - Commit: Extract console tabs component
  - Partially covers review item: A5
- [x] Moved the console stream panel out of the large `App.tsx` file.
  - Commit: Extract console stream panel component
  - Partially covers review item: A5
- [x] Moved the console handoffs panel out of the large `App.tsx` file.
  - Commit: Extract console handoffs panel component
  - Partially covers review item: A5
- [x] Moved the console actions panel out of the large `App.tsx` file.
  - Commit: Extract console actions panel component
  - Partially covers review item: A5
- [x] Moved the setup and voice controls panel out of the large `App.tsx` file.
  - Commit: Extract console voice panel component
  - Partially covers review item: A5
- [x] Moved the console stats footer out of the large `App.tsx` file.
  - Commit: Extract console stats footer component
  - Partially covers review item: A5
- [x] Moved the console header controls out of the large `App.tsx` file.
  - Commit: Extract console header component
  - Partially covers review item: A5
- [x] Moved the activity rail out of the large `App.tsx` file.
  - Commit: Extract activity rail component
  - Partially covers review item: A5
- [x] Moved the workspace project/chat sidebar out of the large `App.tsx` file.
  - Commit: Extract workspace sidebar component
  - Partially covers review item: A5
- [x] Moved the chat message stream UI out of the large `App.tsx` file.
  - Commit: Extract chat stream component
  - Partially covers review item: A5
- [x] Moved the typed chat and direct Codex streaming callbacks out of the large `App.tsx` file.
  - Commit: Extract streaming chat hook
  - Partially covers review item: A5
- [x] Moved browser speech and response-audio playback state out of the large `App.tsx` file.
  - Commit: Extract speech playback hook
  - Partially covers review item: A5
- [x] Moved console debug/action/handoff state out of the large `App.tsx` file.
  - Commit: Extract console session hook
  - Partially covers review item: A5
- [x] Moved layout sizing, mobile view, swipe, and resize-drag state out of the large `App.tsx` file.
  - Commit: Extract app layout hook
  - Partially covers review item: A5
- [x] Moved active project path/git status loading out of the large `App.tsx` file.
  - Commit: Extract project info hook
  - Partially covers review item: A5
- [x] Moved workspace search query/result loading out of the large `App.tsx` file.
  - Commit: Extract workspace search hook
  - Partially covers review item: A5
- [x] Moved setup doctor and microphone readiness checks out of the large `App.tsx` file.
  - Commit: Extract setup doctor hook
  - Partially covers review item: A5
- [x] Moved Change Review commit/revert action handling out of the large `App.tsx` file.
  - Commit: Extract change review actions hook
  - Partially covers review item: A5
- [x] Moved backend health status loading out of the large `App.tsx` file.
  - Commit: Extract backend status hook
  - Partially covers review item: A5
- [x] Moved chat markdown export handling out of the large `App.tsx` file.
  - Commit: Extract chat export hook
  - Partially covers review item: A5
- [x] Moved project/chat remove and rename dialog wiring out of the large `App.tsx` file.
  - Commit: Extract chat action dialog hook
  - Partially covers review item: A5
- [x] Moved chat display status text and suggestion selection out of the large `App.tsx` file.
  - Commit: Extract chat display state hook
  - Partially covers review item: A5
- [x] Moved chat auto-scroll behavior out of the large `App.tsx` file.
  - Commit: Extract message auto-scroll hook
  - Partially covers review item: A5
- [x] Moved composer input state and textarea auto-grow behavior out of the large `App.tsx` file.
  - Commit: Extract composer input hook
  - Partially covers review item: A5
- [x] Moved search-result chat navigation out of the large `App.tsx` file.
  - Commit: Extract search result navigation hook
  - Partially covers review item: A5
- [x] Moved chat switcher keyboard navigation out of the large `App.tsx` file.
  - Commit: Extract chat switcher keyboard hook
  - Partially covers review item: A5
- [x] Moved active thread clearing and console-state cleanup out of the large `App.tsx` file.
  - Commit: Extract clear thread hook
  - Partially covers review item: A5
- [x] Moved workspace sidebar expansion and show-more state out of the large `App.tsx` file.
  - Commit: Extract workspace sidebar state hook
  - Partially covers review item: A5
- [x] Moved saved microphone mode preference state out of the large `App.tsx` file.
  - Commit: Extract voice input mode hook
  - Partially covers review item: A5
- [x] Moved console tab selection state out of the large `App.tsx` file.
  - Commit: Extract console panel state hook
  - Partially covers review item: A5
- [x] Moved the console panel layout out of the large `App.tsx` file.
  - Commit: Extract console panel component
  - Partially covers review item: A5
- [x] Moved the chat panel layout out of the large `App.tsx` file.
  - Commit: Extract chat panel component
  - Partially covers review item: A5
- [x] Moved the desktop and mobile title bar out of the large `App.tsx` file.
  - Commit: Extract app title bar component
  - Partially covers review item: A5
- [x] Moved the main workspace layout shell out of the large `App.tsx` file.
  - Commit: Extract workspace layout component
  - Partially covers review item: A5
- [x] Moved live voice message and handoff bookkeeping out of the large `App.tsx` file.
  - Commit: Extract live voice session handler hook
  - Partially covers review item: A5
- [x] Moved live voice start/stop and push-to-talk control wiring out of the large `App.tsx` file.
  - Commit: Extract live voice control hook
  - Partially covers review item: A5
- [x] Moved typed chat submit orchestration out of the large `App.tsx` file.
  - Commit: Extract chat submit hook
  - Partially covers review item: A5
- [x] Moved app modal rendering out of the large `App.tsx` file.
  - Commit: Extract app modals component
  - Partially covers review item: A5
- [x] Moved top-level app controller wiring out of the large `App.tsx` file.
  - Commit: Extract app controller hook
  - Covers remaining review item: A5
- [x] Extracted live client config parsing from the large `/api/live` handler.
  - Commit: Extract live client config helper
  - Partially covers review item: A3
- [x] Extracted live voice turn state persistence from the large `/api/live` handler.
  - Commit: Extract live turn state helper
  - Partially covers review item: A3
- [x] Extracted live tool-call request preparation from the large `/api/live` handler.
  - Commit: Extract live tool-call request helper
  - Partially covers review item: A3
- [x] Extracted live Codex stream execution from the large `/api/live` handler.
  - Commit: Extract live Codex stream helper
  - Covers remaining review item: A3

### P1 Reliability And Product Correctness

- [x] Made cancel interrupt active Codex turns directly.
  - Commit: `d169667` - Interrupt active Codex turns on cancel
  - Covers review item: R1
- [x] Surfaced live voice reconnect resets in the UI.
  - Commit: `29bc729` - Surface live voice reconnect resets
  - Covers review item: R2
- [x] Stopped placeholder voice turns from being saved as real history.
  - Commit: `bd94336` - Skip placeholder voice turns
  - Covers review item: R3
- [x] Clarified the Codex status timing behavior.
  - Commit: `83d2b17` - Clarify Codex status timing
  - Partially covers review item: R4
- [x] Documented the live voice status flow and fallback timing.
  - Commit: Document live voice state flow
  - Covers review item: R4
- [x] Improved artifact content classification.
  - Commit: `92e0ce9` - Tighten artifact content classification
  - Covers review item: R5
- [x] Marked the token estimate as approximate.
  - Commit: `3d70af1` - Polish voice playback and token estimate
  - Covers review item: R6
- [x] Improved voice playback truncation behavior.
  - Commit: `3d70af1` - Polish voice playback and token estimate
  - Covers review item: R7
- [x] Replaced blocking browser prompts for chat actions with in-app dialogs.
  - Commit: `335686c` - Replace blocking chat action dialogs
  - Covers review item: R8
- [x] Documented the console overwrite behavior.
  - Commit: `31b53fa` - Document console state overwrite behavior
  - Covers review item: R10
- [x] Improved console accessibility state.
  - Commit: `e363a85` - Improve console accessibility state
  - Partially covers review item: Q7
- [x] Added live-region support for streaming chat responses.
  - Commit: Add streaming response accessibility status
  - Partially covers review item: Q7
- [x] Added focus trapping and focus restoration to modal dialogs.
  - Commit: Improve modal focus handling
  - Partially covers review item: Q7
- [x] Added keyboard navigation and active-state semantics to the chat switcher.
  - Commit: Improve chat switcher keyboard flow
  - Covers remaining review item: Q7

### P2 Quality, Tests, And Repo Hygiene

- [x] Added backend tests for auth, history, cancellation, and log rotation.
  - Commits: `4a99bc4`, `d169667`, `06970b5`, `086a19e`
  - Partially covers review item: Q1
- [x] Added focused frontend tests for SSE stream framing.
  - Commit: Add frontend SSE parser tests
  - Partially covers review item: Q1
  - Notes: covers split chunks, multiline data frames, and malformed-frame recovery.
- [x] Added focused frontend tests for artifact dedupe and change artifact filtering.
  - Commit: Add frontend artifact helper tests
  - Partially covers review item: Q1
- [x] Added focused frontend tests for backend history row to message merging.
  - Commit: Add frontend history merge tests
  - Partially covers review item: Q1
- [x] Added prompting sanitizer tests and tightened fake tool-call cleanup.
  - Commit: Add prompting sanitizer tests
  - Covers remaining review item: Q1 examples
- [x] Added GitHub Actions CI.
  - Commit: `c6950ee` - Add CI and configurable data storage
  - Covers review item: Q3
- [x] Added local JSONL event log rotation.
  - Commit: `06970b5` - Rotate local JSONL event logs
  - Covers review item: Q6
- [x] Made the Gemini Live disconnect-cleanup logging path explicit and tested.
  - Commit: Clarify Gemini cleanup exception handling
  - Covers remaining review item: Q6
- [x] Added initial backend and frontend lint/format tooling.
  - Commit: Add lint and format tooling
  - Covers review item: Q2
  - Notes: backend Ruff and frontend ESLint now run in CI; Prettier config and scripts are available for follow-up formatting passes.
- [x] Removed simple unused frontend code flagged by lint.
  - Commit: Remove unused frontend lint warnings
  - Partially covers review item: Q2
  - Notes: frontend lint warnings dropped from seven to three; the remaining warnings are hook dependency follow-ups.
- [x] Resolved the remaining frontend hook dependency lint warnings.
  - Commit: Resolve frontend hook lint warnings
  - Partially covers review item: Q2
  - Notes: `npm run lint` now completes with no frontend warnings.
- [x] Added backend Pyright type checking to local verification and CI.
  - Commit: Add backend pyright check
  - Partially covers review item: Q2
  - Notes: Pyright now checks `backend/app` and `tests`, and the current backend passes with zero reported issues.
- [x] Enforced frontend Prettier checks in CI.
  - Commit: Enforce frontend prettier check
  - Partially covers review item: Q2
  - Notes: tracked frontend source and config files have been formatted, and CI now runs `npm run format:check` before frontend lint.
- [x] Enabled type-aware frontend linting for app and config TypeScript files.
  - Commit: Add type-aware frontend linting
  - Covers remaining review item: Q2
  - Notes: typed lint now catches unhandled promises and unsafe string coercion in frontend source/config files while leaving Node test files on standard lint rules.
- [x] Documented why the Google GenAI SDK stays pinned.
  - Commit: Document Google GenAI SDK pin
  - Covers review item: Q5
  - Notes: `google-genai` has newer major versions, but the app keeps the Live API client fixed until the voice-session surface is intentionally re-tested.
- [x] Updated README around auth, data storage, and removed stale transcription references.
  - Commits: `4a99bc4`, `c6950ee`, `fbc9944`, `cc3f545`
  - Partially covers review item: Q8
- [x] Archived loose planning notes and ignored generated local app artifacts.
  - Commit: Archive planning notes
  - Partially covers review items: Q4, Q8
  - Notes: `HANDOVER.md`, `REALTIME_VOICE_AGENT_PLAN.md`, and `frontend-updated.md` now live under `docs/archive/`; generated iOS app files are ignored.
- [x] Documented the project docs layout and archive decision.
  - Commit: `73bbabd` - Document project docs layout
  - Covers remaining review items: Q4, Q8

### New Features From The Roadmap

- [x] Captured git diff artifacts after Codex changes.
  - Commit: `2fb66b8` - Capture diff artifacts for Codex changes
  - Partially covers review feature: F1
- [x] Surfaced Codex change-review artifacts in the frontend.
  - Commit: `7fe962e` - Surface Codex change review artifacts
  - Partially covers review feature: F1
- [x] Added a Change Review revert action for changed files.
  - Commit: Add change review revert action
  - Partially covers review feature: F1
- [x] Added a Change Review commit action for changed files.
  - Commit: Add change review commit action
  - Partially covers review feature: F1
- [x] Added optional pre-Codex checkpoint commits for dirty projects.
  - Commit: `3e2bcee` - Add optional Codex checkpoints
  - Covers remaining review feature: F1
  - Notes: `CODEX_AUTO_CHECKPOINT=true` creates a checkpoint commit before Codex starts when the selected project already has uncommitted changes; the default stays off.
- [x] Added project briefing context for voice/session startup.
  - Commit: `19dda8a` - Add project briefing context
  - Covers review feature: F5
- [x] Corrected false live tool claims by feeding a corrective path back into the session.
  - Commit: `e4724d1` - Correct false live tool claims
  - Covers review feature: F4
- [x] Added chat export as markdown.
  - Commit: Export chats as markdown
  - Covers review feature: F6
- [x] Added search across chats and artifacts.
  - Commit: Search chats and artifacts
  - Covers review feature: F6
- [x] Added a Codex token usage meter.
  - Commit: Show Codex token usage
  - Partially covers review feature: F6
  - Notes: Codex token usage events are now persisted and shown in the console footer; Gemini Live usage still needs provider-side usage capture.
- [x] Added an onboarding doctor for setup checks.
  - Commit: Add onboarding doctor
  - Covers review feature: F6
- [x] Supported project-scoped monorepo subpaths for Codex work.
  - Commit: Support project subpath workdirs
  - Covers review feature: F6
- [x] Added a push-to-talk microphone mode for voice sessions.
  - Commit: Add push-to-talk voice mode
  - Covers review feature: F6

## Still Remaining Or Pending

### Highest Priority

- [x] Finish making backend history the single source of truth for messages.
  - Review item: B7
  - Current status: complete. Messages, project lists, and chat lists now hydrate from the backend instead of booting from browser copies; localStorage keeps only UI preferences such as active selection and theme.
- [x] Decompose the large `/api/live` handler into smaller, testable parts.
  - Review item: A3
  - Current status: complete. Shared live client config parsing, voice turn persistence, tool-call request preparation, and Codex stream execution now live in focused tested helpers.
- [x] Break up the large `App.tsx` file into focused components and hooks.
  - Review item: A5
  - Current status: complete. `App.tsx` is now a small shell composed from focused components and hooks.
- [x] Consolidate project, chat, and console storage into SQLite.
  - Review item: A4
  - Current status: complete. Projects, chat metadata, and console state now use SQLite tables in the history database with one-time migration from the old JSON files.
- [x] Complete the Change Review feature.
  - Review feature: F1
  - Current status: complete. Diff artifacts are captured and surfaced, changed files can be committed or reverted from the review chip with confirmation, and optional pre-Codex checkpoint commits can be enabled for dirty projects.

### Product Features

- [ ] Build a real background task queue with voice or UI completion notifications.
  - Review feature: F2
- [ ] Persist Codex threads across server restarts.
  - Review feature: F3
- [ ] Add Gemini Live usage and cost estimates.
  - Review feature: F6
  - Current status: Codex token usage is visible; Gemini Live token/audio usage and pricing are still pending.
### Reliability And Polish
- [x] Tighten code quality gates further.
  - Follow-up to review item: Q2
  - Current status: complete. Backend Ruff/Pyright, frontend Prettier, ESLint, and type-aware frontend linting are now part of the local/CI verification path.
- [x] Finish README and repo hygiene cleanup.
  - Review items: Q4, Q8
  - Current status: complete. Local data paths and generated artifacts are ignored, old planning notes are archived under `docs/archive/`, and README now documents which docs are active versus historical references.

## Commit Log Used

| Date | Commit | Summary |
|---|---|---|
| 2026-06-10 | `4a99bc4` | Harden local agent access and fix review bugs |
| 2026-06-10 | `c6950ee` | Add CI and configurable data storage |
| 2026-06-10 | `3d70af1` | Polish voice playback and token estimate |
| 2026-06-11 | `335686c` | Replace blocking chat action dialogs |
| 2026-06-11 | `d169667` | Interrupt active Codex turns on cancel |
| 2026-06-11 | `92e0ce9` | Tighten artifact content classification |
| 2026-06-11 | `29bc729` | Surface live voice reconnect resets |
| 2026-06-11 | `06970b5` | Rotate local JSONL event logs |
| 2026-06-11 | `8e8a8e6` | Remove unused non-stream chat endpoints |
| 2026-06-11 | `2fb66b8` | Capture diff artifacts for Codex changes |
| 2026-06-11 | `7fe962e` | Surface Codex change review artifacts |
| 2026-06-11 | `fbc9944` | Remove stale transcription path |
| 2026-06-11 | `c9853ad` | Log microphone fallback path |
| 2026-06-11 | `83d2b17` | Clarify Codex status timing |
| 2026-06-11 | `bd94336` | Skip placeholder voice turns |
| 2026-06-11 | `114fb15` | Require scoped history reads |
| 2026-06-11 | `086a19e` | Add history scope columns |
| 2026-06-11 | `19dda8a` | Add project briefing context |
| 2026-06-11 | `e363a85` | Improve console accessibility state |
| 2026-06-11 | `31b53fa` | Document console state overwrite behavior |
| 2026-06-11 | `e4724d1` | Correct false live tool claims |
| 2026-06-11 | `cc3f545` | Move typed chat off Live API |
| 2026-06-13 | `e7bdbde` | Add lint and format tooling |
| 2026-06-13 | `72bd4db` | Export chats as markdown |
| 2026-06-13 | `2b389a8` | Search chats and artifacts |
| 2026-06-13 | `ac92495` | Show Codex token usage |
| 2026-06-13 | `ae8619c` | Add onboarding doctor |
| 2026-06-13 | `644e386` | Support project subpath workdirs |
| 2026-06-13 | `86ff171` | Add push-to-talk voice mode |
| 2026-06-13 | `cc31257` | Mark FastAPI lifespan complete |
| 2026-06-13 | `2855ac2` | Document Google GenAI SDK pin |
| 2026-06-13 | `3bc5757` | Add streaming response accessibility status |
| 2026-06-13 | `055b548` | Document live voice state flow |
| 2026-06-13 | `b93083c` | Extract artifact card component |
| 2026-06-13 | `7974699` | Extract Codex timeline component |
| 2026-06-13 | `ca150ef` | Extract change review chip component |
| 2026-06-13 | `ea99f17` | Extract chat action modals |
| 2026-06-13 | `7400810` | Remove unused frontend lint warnings |
| 2026-06-13 | `2e5c9aa` | Resolve frontend hook lint warnings |
| 2026-06-13 | `8757351` | Improve modal focus handling |
| 2026-06-13 | `099dd89` | Improve chat switcher keyboard flow |
| 2026-06-13 | `7a32b3e` | Add frontend SSE parser tests |
| 2026-06-13 | `dda61a9` | Add frontend artifact helper tests |
| 2026-06-13 | `a2527e0` | Add frontend history merge tests |
| 2026-06-13 | `6d60c7d` | Add prompting sanitizer tests |
| 2026-06-13 | `1db6766` | Add change review revert action |
| 2026-06-13 | `8ba335e` | Add change review commit action |
| 2026-06-13 | `e8e63b1` | Add backend pyright check |
| 2026-06-13 | `2fe3ca1` | Enforce frontend prettier check |
| 2026-06-13 | `4272adf` | Stabilize live voice reconnect callbacks |
| 2026-06-13 | `8556cbe` | Clarify Gemini cleanup exception handling |
| 2026-06-13 | `09ddb5f` | Prefer backend history for chat messages |
| 2026-06-13 | `e71d8fe` | Extract chat top bar component |
| 2026-06-13 | `6e92e87` | Extract composer footer component |
| 2026-06-13 | `95f6eea` | Extract console tabs component |
| 2026-06-13 | `30f9a65` | Extract console stream panel component |
| 2026-06-13 | `fd74a93` | Extract console handoffs panel component |
| 2026-06-13 | `528db7f` | Extract console actions panel component |
| 2026-06-13 | `fa0d3d0` | Extract console voice panel component |
| 2026-06-13 | `d550d0d` | Extract console stats footer component |
| 2026-06-13 | `ee45dda` | Extract console header component |
| 2026-06-13 | `86ff76b` | Extract activity rail component |
| 2026-06-13 | `17f51a9` | Extract workspace sidebar component |
| 2026-06-13 | `a96f775` | Extract chat stream component |
| 2026-06-13 | `7f5c9b1` | Extract streaming chat hook |
| 2026-06-13 | `40eb179` | Extract speech playback hook |
| 2026-06-13 | `135bc1b` | Extract console session hook |
| 2026-06-13 | `2aa3d22` | Extract app layout hook |
| 2026-06-13 | `6f0f03f` | Extract project info hook |
| 2026-06-13 | `bb9da8f` | Extract workspace search hook |
| 2026-06-13 | `3b304e4` | Extract setup doctor hook |
| 2026-06-13 | `637be55` | Extract change review actions hook |
| 2026-06-13 | `0f8df96` | Extract backend status hook |
| 2026-06-13 | `1c1f027` | Extract chat export hook |
| 2026-06-13 | `ffff7e9` | Extract chat action dialog hook |
| 2026-06-13 | `df5dc44` | Extract chat display state hook |
| 2026-06-13 | `4c6ec76` | Extract message auto-scroll hook |
| 2026-06-13 | `14e1ce0` | Extract composer input hook |
| 2026-06-13 | `e61345c` | Extract search result navigation hook |
| 2026-06-13 | `88cb541` | Extract chat switcher keyboard hook |
| 2026-06-13 | `624246b` | Extract clear thread hook |
| 2026-06-13 | `89a2115` | Extract workspace sidebar state hook |
| 2026-06-13 | `a0aa3b3` | Extract voice input mode hook |
| 2026-06-13 | `2dfe08d` | Extract console panel state hook |
| 2026-06-13 | `0eeefc8` | Extract console panel component |
| 2026-06-13 | `038e689` | Extract chat panel component |
| 2026-06-13 | `5234a4b` | Extract app title bar component |
| 2026-06-13 | `294f7b1` | Extract workspace layout component |
| 2026-06-13 | `b182a8d` | Extract live voice session handler hook |
| 2026-06-14 | `8a28bf8` | Complete App decomposition |
| 2026-06-14 | `2c3b85c` | Extract live handler helpers |
| 2026-06-14 | `7b093cb` | Prefer backend project and chat lists |
| 2026-06-14 | `d806145` | Archive planning notes |
| 2026-06-14 | `4b299eb` | Add Capacitor frontend config |
| 2026-06-14 | `5b070a9` | Add type-aware frontend linting |
| 2026-06-14 | `8a54a26` | Update product progress tracker |
| 2026-06-14 | `2edb10f` | Refresh product progress log |
| 2026-06-14 | `3e2bcee` | Add optional Codex checkpoints |
| 2026-06-14 | `6536cd2` | Update progress for Codex checkpoints |
| 2026-06-14 | `d2cad75` | Store project metadata in SQLite |
| 2026-06-14 | `8faad61` | Update progress for SQLite storage |
| 2026-06-14 | `73bbabd` | Document project docs layout |
