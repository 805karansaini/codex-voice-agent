# Live Voice State Flow

This note documents the status flow used by the live voice UI. It is meant to
keep future changes aligned between `frontend/src/hooks/useLiveVoice.ts` and the
backend WebSocket events from `/api/live`.

## UI states

| State | Meaning | Main entry points | Main exit points |
|---|---|---|---|
| `idle` | No live voice session is active. | Initial page load, manual stop, graceful session end after playback. | User starts voice. |
| `connecting` | The browser has or is opening microphone/WebSocket resources. | User starts voice, or a non-manual WebSocket close occurs while the mic stream still exists. | WebSocket opens, browser lacks microphone support, microphone/WebSocket startup fails. |
| `live` | The app is listening for the next user turn. | WebSocket opens, a normal turn completes, or the Codex-result fallback fires. | User speech transcript arrives, assistant response starts, Codex starts, stop/error. |
| `thinking` | Gemini is forming or finishing a response. | User transcript, assistant text delta, Codex result, or Codex failure. | Turn completes, Codex starts, error, stop. |
| `working` | Codex is running on behalf of the voice session. | Backend sends `tool_call_started`. | Backend sends `tool_result`, `tool_call_failed`, error, or stop. |
| `error` | Live voice cannot continue without user action. | Browser does not support microphone/WebSocket, microphone startup fails, backend sends `error`. | User stops and starts again. |

## Backend event handling

The frontend treats these `/api/live` messages as the source of truth:

| Event | Frontend effect |
|---|---|
| `ready`, `debug` | Log only; no state change. |
| `user_transcript` | Append user preview, enter `thinking`, announce that Gemini is composing. |
| `assistant_delta` | Append assistant preview, stay in `thinking`, play/stream response text. |
| `assistant_audio_delta` | Play streamed audio; does not change state by itself. |
| `turn_complete` | Persist the completed turn, clear previews, return to `live` unless the backend says the session ended. |
| `interrupted` | Stop current audio and clear assistant preview. |
| `tool_call_started` | Enter `working`, create/update the Codex handoff UI. |
| `tool_progress`, `codex_event`, `status` | Keep current state and update progress text. |
| `tool_result` | Enter `thinking`, surface the Codex result, and start the fallback timer. |
| `tool_call_failed` | Enter `thinking`, clear the Codex handoff, and show the failure. |
| `error` | Enter `error` and show the backend message. |

## Fallback timing

Backend Codex status events begin after about 20 seconds and then repeat about
once per minute. The frontend waits 25 seconds after `tool_result` before
falling back to the Codex result in chat. This avoids a blank voice turn when
Gemini receives the Codex result but does not produce a final `turn_complete`.

## Reconnect behavior

If the WebSocket closes without a manual stop while the microphone stream still
exists, the frontend enters `connecting`, keeps the microphone resources, and
tries to reconnect after a short delay. The UI records that the live session was
restarted and makes clear that context is preserved only through the last
completed turn.

## Stop behavior

Manual stop closes the WebSocket, stops microphone tracks, clears timers, and
returns to `idle`. If the backend marks a turn as `session_ended`, the frontend
waits for audio playback to finish before stopping so the final answer is not
cut off.
