# Codex Voice Agent - Product Progress

Updated: 2026-06-13

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
- [x] Fixed Server-Sent Events parsing so multi-line data is handled correctly.
  - Commit: `4a99bc4` - Harden local agent access and fix review bugs
  - Covers review item: B8
- [x] Added project path conflict handling instead of silently deleting a matching project.
  - Commit: `4a99bc4` - Harden local agent access and fix review bugs
  - Covers review item: B9

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
- [x] Removed the stale transcription path.
  - Commit: `fbc9944` - Remove stale transcription path
  - Covers review item: R9
- [x] Logged when the microphone fallback path is used.
  - Commit: `c9853ad` - Log microphone fallback path
  - Partially covers review item: A6

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

### P2 Quality, Tests, And Repo Hygiene

- [x] Added backend tests for auth, history, cancellation, and log rotation.
  - Commits: `4a99bc4`, `d169667`, `06970b5`, `086a19e`
  - Partially covers review item: Q1
- [x] Added GitHub Actions CI.
  - Commit: `c6950ee` - Add CI and configurable data storage
  - Covers review item: Q3
- [x] Added local JSONL event log rotation.
  - Commit: `06970b5` - Rotate local JSONL event logs
  - Covers review item: Q6
- [x] Added initial backend and frontend lint/format tooling.
  - Commit: Add lint and format tooling
  - Covers review item: Q2
  - Notes: backend Ruff and frontend ESLint now run in CI; Prettier config and scripts are available for follow-up formatting passes.
- [x] Updated README around auth, data storage, and removed stale transcription references.
  - Commits: `4a99bc4`, `c6950ee`, `fbc9944`, `cc3f545`
  - Partially covers review item: Q8

### New Features From The Roadmap

- [x] Captured git diff artifacts after Codex changes.
  - Commit: `2fb66b8` - Capture diff artifacts for Codex changes
  - Partially covers review feature: F1
- [x] Surfaced Codex change-review artifacts in the frontend.
  - Commit: `7fe962e` - Surface Codex change review artifacts
  - Partially covers review feature: F1
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

## Still Remaining Or Pending

### Highest Priority

- [ ] Finish making backend history the single source of truth for messages.
  - Review item: B7
  - Current status: partially improved, but the broader frontend/backend message ownership problem still needs a full pass.
- [ ] Decompose the large `/api/live` handler into smaller, testable parts.
  - Review item: A3
- [ ] Break up the large `App.tsx` file into focused components and hooks.
  - Review item: A5
- [ ] Consolidate project, chat, and console storage into SQLite.
  - Review item: A4
- [ ] Complete the Change Review feature.
  - Review feature: F1
  - Done so far: diff artifacts are captured and surfaced.
  - Remaining: approval flow, revert action, commit action, and optional auto-checkpoint before Codex turns.

### Product Features

- [ ] Build a real background task queue with voice or UI completion notifications.
  - Review feature: F2
- [ ] Persist Codex threads across server restarts.
  - Review feature: F3
- [ ] Support multiple workdirs or monorepo subpaths per project.
  - Review feature: F6
- [ ] Add mobile wake-word or push-to-talk mode.
  - Review feature: F6
- [ ] Add Gemini Live usage and cost estimates.
  - Review feature: F6
  - Current status: Codex token usage is visible; Gemini Live token/audio usage and pricing are still pending.
### Reliability And Polish

- [ ] Fully document or simplify the live voice status and fallback timing state machine.
  - Review item: R4
  - Current status: timing behavior was clarified, but the full state machine is not fully formalized.
- [ ] Replace deprecated FastAPI startup/shutdown hooks with a lifespan context.
  - Review item: A6
- [ ] Continue accessibility improvements.
  - Review item: Q7
  - Remaining examples: focus management, chat switcher keyboard flow, and live-region support for streaming responses.
- [ ] Expand the test suite beyond the current backend-focused coverage.
  - Review item: Q1
  - Remaining examples: frontend SSE framing, artifact dedupe, prompting sanitizers, and frontend store merge behavior.
- [ ] Tighten code quality gates further.
  - Follow-up to review item: Q2
  - Remaining examples: enforce a full Prettier check after a formatting-only pass, consider type-aware linting, and add pyright or mypy if the codebase is ready for it.
- [ ] Finish README and repo hygiene cleanup.
  - Review items: Q4, Q8
  - Remaining examples: archive old planning docs, ignore local data directories, remove bundled/duplicate app artifacts, and keep docs aligned with current storage paths.
- [ ] Review the `python-genai` pin and document or relax it.
  - Review item: Q5

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
| 2026-06-13 | current commit | Add lint and format tooling |
| 2026-06-13 | current commit | Export chats as markdown |
| 2026-06-13 | current commit | Search chats and artifacts |
| 2026-06-13 | current commit | Show Codex token usage |
| 2026-06-13 | current commit | Add onboarding doctor |
