# Chat Artifact Workflow Plan

## Product Direction

The central chat is the primary product surface. Generated content, markdown, tool output, and task receipts must be visible from the chat itself. The right panel can continue to exist as a development and debugging aid, but the user should not need it to understand what happened or inspect generated work.

The long-term interaction model is:

- Chat shows concise summaries, key outcomes, and stable progress states.
- Full generated content is stored as a durable artifact.
- Artifact cards are rendered directly inside the chat and can expand to show full markdown or raw output.
- Follow-up requests reuse recent artifacts when they already contain the needed context.
- Debug details stay available in logs and development panels without polluting the main conversation.

## Problems To Solve

1. Tool results can be large and currently may not be visible in the central chat.
2. The assistant can claim content was shown even when the user cannot inspect it.
3. Some turns end with vague completion text like "Done."
4. Gemini can get stuck after Codex completes, leaving useful tool output hidden.
5. Gemini may call tools repeatedly even when recent Codex output already contains enough context.
6. Current logs are improving, but artifact creation and UI visibility need to be logged explicitly.

## Feature Requirements

### Central Chat Artifacts

- Create artifact cards inside assistant chat messages.
- Show title, short summary, source tool, status, timestamp, and content type.
- Render markdown by default when applicable.
- Provide a raw text view for command output or markdown source.
- Support expand/collapse without relying on the right-side debug panel.

### Artifact Storage

- Persist artifacts by chat and turn.
- Store summary, full content, content type, source tool, related workdir, and optional file paths.
- Return artifact metadata with chat and Codex stream events.
- Hydrate artifacts when loading chat history.

### Tool Result Receipts

- After Codex completes, show a user-facing receipt in chat.
- The receipt should say what happened, what output exists, whether it succeeded, and how to inspect details.
- Never end tool-backed turns with only "Done."

### Tool Call Reuse

- Give Gemini lightweight references to recent artifacts.
- If a follow-up asks to show, summarize, or continue from existing content, use the stored artifact before calling Codex again.
- Add logging for repeated tool calls that appear to overlap recent artifacts.

### Failure Recovery

- If Codex completes but Gemini does not finish within a timeout, surface the Codex artifact anyway.
- Mark the final Gemini response as incomplete rather than leaving the UI stuck.
- Show retry/cancel affordances for failed or timed-out tool work.

### Debug And Logs

- Keep durable JSONL logs for app events and live voice sessions.
- Log artifact creation, artifact visibility in chat, expansion/copy actions, tool calls, tool results, timeouts, and final turn state.
- Keep detailed debugging out of the main chat by default.

## Build Phases

### Phase 1: Foundation

- Add this plan document.
- Add artifact data types to backend and frontend contracts.
- Store Codex tool results as artifacts.
- Render basic artifact cards in central chat.
- Keep existing right-panel debug behavior unchanged.

### Phase 2: Artifact UX

- Add expandable markdown/raw views in chat.
- Add copy actions.
- Improve assistant receipts so summaries and artifacts feel like one coherent result.
- Ensure voice and text paths both create visible artifacts.

### Phase 3: Recovery And Reuse

- Add timeout fallback when Gemini stalls after Codex completion.
- Feed recent artifact references into model context.
- Add artifact-open intent handling for "show it here" style requests.
- Add repeated-tool-call diagnostics.

### Phase 4: Debug Maturity

- Add a lightweight local session/debug viewer.
- Add artifact visibility logging.
- Add filters for stuck turns, failed tool calls, and duplicate tool calls.

## Progress Log

- 2026-06-07: Created the feature plan and started Phase 1.
- 2026-06-07: Added durable artifact storage, attached Codex outputs to stream events, and rendered expandable artifact cards directly in the central chat. Commit: `5b6ab53`.
- 2026-06-07: Added voice handoff fallback so Codex results become visible in chat immediately and the live voice UI recovers if Gemini does not finish final wording. Commit: `3266027`.
- 2026-06-07: Added recent artifact references to Gemini context and prompt rules so follow-ups can reuse visible artifacts before calling tools again. Commit: `f1da09e`.
- 2026-06-07: Persisted live voice artifacts into chat history so Codex outputs remain visible after refresh. Commit: `35563c6`.
