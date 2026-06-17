# Gemini Live loses long Codex tool context after reconnect

## Summary

During a long Gemini Live voice turn, Gemini can call `run_codex_task` and then keep the Live session open while Codex works for several minutes. If Gemini Live sends a session-duration `GoAway` while Codex is still running, Codex can finish successfully, but the backend can no longer deliver the tool result back into the original Gemini Live session.

The UI still receives and shows the Codex result because the backend sends `tool_result` to the browser before sending the function response back to Gemini. However, Gemini does not receive the function response, so the next reconnected Live session does not know that the tool completed.

That is why the right panel showed:

- Codex completed.
- The app surfaced the Codex result in chat after Gemini did not finish.
- Gemini Live restarted.
- After reconnect, Gemini acted unaware of the completed Codex task.

## Evidence from the reported session

Chat id:

`c1e2c75b-c544-4839-866a-d1b8d22cbce8`

Long Codex task session id:

`6c3b8d2e-c16a-42b0-9e14-ebd9d00acbc5`

Timeline from `backend/data/live_sessions.jsonl`:

- `2026-06-17T02:48:22.921Z`: user asked Gemini to kick off Codex and make the backend/frontend reliability changes.
- `2026-06-17T02:48:25.624Z`: Gemini started `run_codex_task`.
- `2026-06-17T02:48:37.441Z`: client stopped audio while Codex continued.
- `2026-06-17T02:59:58.127Z`: Codex finished after about 11 minutes and 32 seconds.
- `2026-06-17T02:59:58.131Z`: backend sent `tool_result` to the browser with `result_chars=7625` and `codex_status=completed`.
- `2026-06-17T02:59:58.131Z`: backend tried to send the tool response back to Gemini.
- `2026-06-17T02:59:58.131Z`: Gemini tool-response send failed with:

```text
received 1008 (policy violation) Connection aborted because the client failed to close the connection after receiving a GoAway signal once the session durat...
```

- `2026-06-17T03:00:59.988Z`: a new Gemini Live session started.
- `2026-06-17T03:01:35.869Z`: user asked "what is the update?"
- Gemini asked which update, showing it did not have the completed tool result in its new Live context.
- `2026-06-17T03:01:44.034Z`: user asked if it was done.
- Gemini replied that no changes had been made yet, which was wrong from the app's perspective.

## Why this happened

There are two separate state paths:

1. Browser/app state
   - The backend sends `tool_result` to the frontend as soon as Codex finishes.
   - The UI can show the Codex output even if Gemini never speaks a final answer.

2. Gemini Live session state
   - The backend then calls `session.send_tool_response(...)` so Gemini can read the Codex result and answer naturally.
   - In this case, that call failed because the Gemini Live session was already closing due to session-duration `GoAway`.

The current reconnect path tells the user that context is preserved up to the last completed turn. That is accurate, but this failed case is an in-between state:

- The user turn started.
- Gemini called Codex.
- Codex completed.
- Gemini did not receive the tool result.
- Gemini never completed the turn.

The completed Codex result was visible to the app, but not persisted into the voice conversation in time for the next Gemini Live session to include it as context.

## Related earlier disconnect in the same chat

There was another disconnect earlier in the same chat:

- `2026-06-17T02:43:14.417Z`: Gemini started a Codex tool call.
- `2026-06-17T02:43:58.550Z`: websocket cleaned up while `had_active_cancel_token=true`.

That earlier case appears to be a direct disconnect while Codex was still running. The long 10-minute task is more specific and more important: Codex completed, but the tool result could not be delivered to Gemini because Gemini had already closed the Live session.

## Current code behavior to inspect

Main flow:

- `backend/app/main.py`
  - Runs the Live tool call.
  - Creates artifacts.
  - Sends `tool_result` to the browser.
  - Calls `session.send_tool_response(function_responses=responses)`.
  - Logs `gemini.tool_response_send_error` if that send fails.

Frontend fallback:

- `frontend/src/hooks/useLiveVoice.ts`
  - Starts a 25-second timer after receiving `tool_result`.
  - If Gemini does not produce a final response, it logs:
    `Gemini did not finish after Codex completed; surfaced the Codex result in chat.`

Conversation persistence:

- The voice turn is normally persisted on Gemini `turn_complete`.
- In the failure case, Gemini never reaches `turn_complete` after the tool result.
- Reconnect context is rebuilt from stored history and recent artifacts, so the next Gemini session can miss the just-completed Codex handoff.

## Desired behavior

When Codex finishes during a Gemini Live session that is closing or already closed:

1. The Codex result must still be durably recorded against the chat.
2. The next Gemini Live session must be explicitly told:
   - the previous user request,
   - that Codex completed it,
   - the Codex status,
   - where the full result/artifact is available,
   - and a concise summary of the result.
3. Gemini should not claim "no changes were made yet" after reconnect when the app already has a completed Codex result.
4. The UI should distinguish "Gemini did not receive the tool result" from a generic "Gemini did not finish" timeout.

## Possible fix approach

### 1. Persist completed Codex handoffs immediately

After Codex finishes and before attempting `session.send_tool_response(...)`, persist a durable handoff record for the current chat.

That record should include:

- chat id
- project id
- workdir
- original user text
- tool name
- Codex status
- Codex result summary or full artifact reference
- Codex turn id
- Codex thread id
- artifact ids
- timestamp
- whether Gemini acknowledged the tool result

This should happen before sending the response back to Gemini because `send_tool_response` can fail.

### 2. Mark Gemini tool-result delivery separately

Track whether Gemini actually accepted the function response.

Suggested states:

- `codex_completed`
- `tool_result_sent_to_client`
- `tool_response_sent_to_gemini`
- `tool_response_failed_to_gemini`
- `gemini_final_response_completed`

In this bug, the state would be:

- `codex_completed`
- `tool_result_sent_to_client`
- `tool_response_failed_to_gemini`

That state should be visible in logs and usable by reconnect context.

### 3. Include unfinished Codex handoffs in reconnect context

When building Gemini Live context for a new session, include recent completed Codex handoffs that Gemini did not acknowledge or summarize.

The context should say something like:

```text
Important recent handoff:
The previous Gemini Live session called Codex for this user request:
"Refactor the backend by modularizing main.py..."

Codex completed successfully, but the Gemini Live session disconnected before Gemini received the result.
The result is available as artifact <id>. Summary: <short summary>.
If the user asks for an update, answer from this completed Codex result instead of saying no work was done.
```

### 4. Recover after `send_tool_response` failure

When `session.send_tool_response(...)` fails because the Live session is closed:

- persist the failed delivery state,
- notify the frontend with a more specific event, for example `tool_result_gemini_delivery_failed`,
- close or restart the Live websocket intentionally,
- and ensure the next session includes the undelivered handoff in context.

Do not rely only on the frontend 25-second fallback timer.

### 5. Optional: proactively rotate long Live sessions

If Gemini Live has a known maximum session duration, track session age and avoid starting a long Codex tool call too close to that limit.

Possible behavior:

- Before starting Codex, if the Live session is near expiry, persist the user request, restart Gemini Live, then run Codex under the fresh session.
- Or treat long Codex tasks as app-owned background jobs and resume Gemini after completion with a fresh context packet.

The durable handoff fix is still needed because network closes can happen at any time.

## Testing plan

### Unit tests

Add backend tests for:

1. Codex completes and `send_tool_response` succeeds.
   - Expect handoff persisted.
   - Expect state marks Gemini delivery as successful.

2. Codex completes and `send_tool_response` raises.
   - Expect handoff still persisted.
   - Expect state marks Gemini delivery as failed.
   - Expect reconnect context includes the completed Codex result.

3. Gemini reconnect context builder sees a recent undelivered completed handoff.
   - Expect the context to include the original user request, completion status, artifact reference, and instruction not to deny the work.

4. Gemini later completes a final response for that handoff.
   - Expect the handoff to be marked acknowledged/summarized so it does not keep being injected forever.

### Frontend tests

Add tests for the Live voice hook/session handlers:

1. `tool_result` arrives and Gemini later answers.
   - No timeout/failure message should remain.

2. `tool_result` arrives and no Gemini answer arrives.
   - The app should show that the Codex result is available.

3. Backend sends `tool_result_gemini_delivery_failed`.
   - The UI should show a clearer message that Codex completed but Gemini reconnected before reading the result.

### Manual test

Use a fake or monkeypatched Gemini Live session that raises during `send_tool_response`.

Steps:

1. Start the backend and frontend.
2. Start Gemini Live voice for a chat.
3. Trigger a Codex tool call with a representative long task.
4. Make the fake Live session fail when the backend sends the tool response back to Gemini.
5. Confirm the browser still shows the Codex result.
6. Confirm a new Gemini Live session starts.
7. Ask: "What is the update?"
8. Expected: Gemini answers from the completed Codex handoff instead of asking which task or saying no changes were made.

### Real-session regression test

Run one real Gemini Live session with a long Codex task that takes longer than the current Live session duration limit, or simulate this by forcing the backend's Gemini session wrapper to close before `send_tool_response`.

Expected result:

- Codex result remains visible.
- The reconnect message is accurate.
- The next Gemini response knows the completed task and can summarize it.
- Logs clearly show whether Gemini accepted or missed the tool result.

## Acceptance criteria

- A completed Codex task is never lost from Gemini reconnect context just because the original Live session closed.
- If Gemini did not receive the tool result, the app records that explicitly.
- After reconnect, asking "is it done?" or "what is the update?" produces an answer based on the completed Codex result.
- The UI no longer makes this look like a generic silence/timeout when the real cause is failed delivery back to Gemini.
- Automated tests cover both successful and failed Gemini tool-response delivery.
