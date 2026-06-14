# Real-Time Voice Agent Plan

## What "done" should feel like

The voice agent should feel like a live teammate, not a request/response form with a microphone.

The target experience:

- The user speaks naturally.
- The app shows the words as they are heard.
- The agent quickly acknowledges the request.
- The agent briefly says what it is going to do.
- If local work is needed, the agent hands the task to Codex.
- While Codex is working, the user sees useful progress updates instead of silence.
- If the job is quick, the app does not spam updates.
- If the job takes minutes, the app gives short status updates every so often.
- Final text and final audio arrive cleanly when the work is complete.
- The spoken response is streamed as audio, not held until the end.

## Current behavior

> Verified against the source on 2026-06-06: `backend/app/main.py`, `backend/app/gemini_agent.py`, `backend/app/codex_runner.py`, `frontend/src/hooks/useLiveVoice.ts`, and `frontend/src/components/common/AudioPlayer.tsx`. All file/line references below reflect that code.

There are three main interaction paths today.

### Text agent path

The frontend sends typed messages to `/api/chat/stream`.

The backend sends the text to Gemini Live. Gemini can answer directly or call the `run_codex_task` tool. Text chunks are streamed back to the frontend, so the assistant message appears progressively in the chat.

If Gemini calls Codex, the backend waits for Codex to finish, then sends the Codex result back to Gemini, then Gemini finishes its response.

This path feels more responsive because the Gemini-generated text is streamed to the UI. But note: this path **also blocks on Codex**. `ask_gemini_stream` calls the blocking `run_codex` during a tool call and only emits `tool_call`/`tool_result` events around that blocking wait. So the "use streaming Codex + emit progress" fix below applies to this path too, not just the live voice path.

### Direct Codex path

The frontend sends direct Codex tasks to `/api/codex/stream`.

The backend runs Codex through the Codex SDK stream and sends text deltas to the frontend. The UI updates the assistant bubble as Codex writes.

This is the best streaming path in the app today.

### Live voice path

The frontend opens `/api/live` over WebSocket.

The browser captures microphone audio, converts it to 16 kHz PCM, and continuously sends chunks to the backend.

The backend forwards those chunks to Gemini Live. Gemini sends back input transcription, output transcription, audio chunks, tool calls, interruptions, and turn completion events.

The UI shows the live transcript and assistant text preview while the voice session is active.

However, assistant audio is currently collected on the backend and only sent to the browser at `turn_complete`. That means voice output is not truly live yet.

## Why voice feels slow right now

### 1. Audio output is buffered until the end

Gemini may provide audio chunks during the turn, but the backend stores those chunks in `audio_chunks` and sends one full audio data URL only when the turn finishes.

So even if Gemini produces speech earlier, the browser cannot play it earlier.

This is probably the biggest reason the voice path feels less real-time than the text path.

### 2. Codex handoff blocks Gemini's turn

When Gemini calls `run_codex_task`, the backend runs:

```text
Gemini tool call -> run Codex -> wait for final Codex result -> send tool response back to Gemini
```

During that wait, the live voice path does not stream Codex progress to the UI.

If Codex takes 30 seconds or 10 minutes, the user mostly sees a wait state.

### 3. The voice path uses non-streaming Codex

The app already has `run_codex_stream`, and the direct Codex endpoint uses it.

But **both** Gemini tool-call paths still use `run_codex`, which waits for the final result: `/api/live` (`main.py:291`) and `ask_gemini_stream` (`gemini_agent.py:197`).

So the app has streaming Codex capability, but neither the voice agent nor the streamed text chat is using it during handoffs.

### 4. There is no explicit acknowledgement phase

The current Gemini instruction says to keep replies short and call Codex for local work. It does not require the model to first acknowledge the request, state the plan briefly, and then hand off.

Because of that, a voice request can feel like:

```text
User speaks -> transcription appears -> wait -> final answer
```

Instead, the desired shape is:

```text
User speaks -> "Got it. I'll check that now." -> Codex starts -> progress updates -> final answer
```

### 5. Long-running task updates are not modeled

There is no concept of a long-running job with periodic status.

Right now Codex is treated as a tool call that returns once. The UI has an action log, but the voice path only records the handoff after Codex has already finished.

### 6. Browser audio playback is end-of-turn playback

The UI uses one final audio URL, then plays it with an `Audio` element.

That works for complete clips, but it is not designed for low-latency audio streaming. A real-time voice experience needs a stream-oriented playback buffer.

### 7. Microphone capture uses `ScriptProcessorNode`

The frontend uses `createScriptProcessor`. It works, but it is older browser audio plumbing and can be less predictable than `AudioWorklet`.

This is not the main current bottleneck, but it is worth improving when the voice stack is upgraded.

## Product goals

### Immediate acknowledgement

For voice requests, the agent should respond quickly with a short acknowledgement.

Examples:

- "Got it. I'll inspect that now."
- "Understood. I'll check the project and come back with the result."
- "Okay. This needs local work, so I'll hand it to Codex."

The acknowledgement should be short enough to feel natural.

### Brief plan before work

For non-trivial tasks, the agent should say one sentence about what it will do.

Examples:

- "I'll check the relevant files first, then run a focused test if needed."
- "I'll ask Codex to inspect the backend path and report what is slowing it down."

This should not become a long plan.

### Streaming text updates

Text should keep flowing during:

- Gemini response generation.
- Codex execution.
- Long-running work.
- Final synthesis.

### Streaming audio updates

Audio should start playing as soon as the model starts speaking.

The app should not wait until the whole response is complete before the user hears anything.

### Smart progress updates

If Codex finishes quickly, no extra update is needed.

If Codex takes longer, the user should get short progress updates. A reasonable starting policy:

- No update for the first 10 seconds.
- If still running at 30 seconds, send a short "still working" update.
- After that, send updates every 2-3 minutes.
- Also send updates immediately when Codex produces meaningful progress.

The updates should be specific when possible:

- "Codex has found the backend voice path and is checking the handoff flow."
- "Codex finished inspecting the frontend and is preparing the summary."
- "Codex is still running tests."

Avoid empty updates like:

- "Still working."
- "Please wait."

### Clear handoff state

The UI should clearly show:

- Gemini is listening.
- Gemini is speaking.
- Gemini handed off to Codex.
- Codex is running.
- Codex produced progress.
- Gemini is preparing the final answer.
- The task is done.

### Natural interruption

If the user starts speaking while Gemini is responding, the app should interrupt cleanly and stop stale audio.

The current code already listens for interruption events, but streaming audio playback needs to respect the same behavior.

There is also a latent buffer bug to fix here. On `interrupted` (`main.py:313`) the backend clears `audio_chunks` and `output_text_chunks`, but **not** `input_text_chunks`. Since `input_text_chunks` seeds both the Codex task (`main.py:289`) and the persisted user history message (`main.py:337`), stale transcript can leak across an interruption. Interruption handling must reset transcript buffers server-side, not just stop audio.

## Recommended architecture

The clean long-term shape is an event-driven conversation loop.

Instead of treating Codex as a blocking tool call, the backend should create a job and stream job events to the frontend.

### Proposed event types

Use one shared event vocabulary for text, voice, and Codex:

```text
session.ready
user.transcript.delta
user.turn.complete
assistant.ack.delta
assistant.audio.delta
assistant.text.delta
assistant.interrupted
tool.call.started
tool.progress.delta
tool.progress.summary
tool.call.completed
tool.call.failed
assistant.final.delta
assistant.turn.complete
error
```

The frontend can then render one consistent timeline no matter whether the user typed or spoke.

### Codex as a streamed job

When Gemini decides local work is needed:

1. Backend emits `tool.call.started`.
2. Backend starts Codex using the existing streaming runner.
3. Backend forwards useful Codex deltas to the UI as `tool.progress.delta`.
4. Backend stores the full Codex result.
5. Backend sends the final result back to Gemini as the tool response.
6. Gemini produces the final user-facing answer.

This keeps the user informed without changing the basic Gemini tool-call contract.

### Periodic status loop

For long-running Codex tasks, run a lightweight timer alongside the Codex stream.

The timer should only speak or display an update when:

- The task has crossed a time threshold.
- There has been no visible progress recently.
- The task is still active.

The timer should stop immediately when Codex completes.

**Design caveat — spoken progress is not just tuning.** Streaming Codex progress to the *UI* is straightforward. But making Gemini *speak* interim updates is harder than it looks: while a tool call is in flight, the Live session is awaiting a single `FunctionResponse` for that call, and the tool contract is one response per call. You cannot reliably inject "still working" narration through the same tool turn. The realistic options are:

- Surface Codex progress as UI text plus your own separate TTS (or a cheap secondary model) for spoken updates, independent of the in-flight Gemini turn, or
- Restructure the handoff so progress is delivered outside the Gemini tool-call turn entirely.

This is an architecture decision, not a parameter to tune. It is the main reason spoken progress is deferred to Phase 4.

### Audio streaming to the browser

When Gemini sends audio chunks, the backend should forward each chunk immediately over the WebSocket.

The frontend should play those chunks through a streaming audio buffer.

Possible implementation paths:

- Short term: send small WAV fragments and queue them for playback.
- Better: send raw PCM chunks and play them with Web Audio.
- Best: use an `AudioWorklet` playback buffer for lower latency and smoother audio.

The current final `audio_data_url` can remain as a fallback while streaming playback is built.

## Phased implementation plan

### Phase 1: Make the current voice flow visibly responsive

Goal: improve perceived responsiveness without a full rebuild.

Work:

- Update the voice system instruction so Gemini gives a short acknowledgement before tool handoff.
- Add a `tool_call_started` event before Codex begins (currently the `tool_call` event is sent only *after* the blocking call returns).
- Use `run_codex_stream` inside the tool-call path of **both** `/api/live` and `ask_gemini_stream` — the blocking-Codex problem is identical in both, so fix both here rather than waiting for the Phase 3 unification.
- Forward Codex stream text to the frontend as progress events.
- Show progress in the live banner and action log while Codex runs.
- Fix the interruption buffer reset (clear `input_text_chunks` too) while touching this path.
- Add a simple long-running timer for "still working" updates (UI/text only in this phase — see the spoken-progress caveat above).

Expected result:

The user sees less silence immediately. Spoken acknowledgement may improve if Gemini emits audio before the tool call, but true low-latency spoken output is still a Phase 2 goal because final audio playback remains end-of-turn in this phase.

### Phase 2: Stream Gemini audio during voice responses

Goal: make spoken output start immediately.

Work:

- Add a WebSocket event for Gemini audio chunks.
- Forward `model_turn.parts[].inline_data.data` immediately instead of storing it only in `audio_chunks`.
- Add frontend streaming audio playback.
- Stop queued audio on interruption.
- Keep final `audio_data_url` as fallback for browsers where streaming playback fails.

Expected result:

The agent starts talking while the response is being generated.

### Phase 3: Unify text, voice, and Codex events

Goal: remove separate behavior between typed chat, direct Codex, and live voice.

Work:

- Define one event schema shared by all streaming endpoints.
- Make `/api/chat/stream`, `/api/codex/stream`, and `/api/live` emit compatible event names.
- Move duplicated handoff/action/progress handling into one frontend timeline layer.
- Store richer history: user transcript, acknowledgement, tool progress, final answer, audio metadata.

Expected result:

The UI behaves consistently whether the user types or speaks.

### Phase 4: Make the agent feel more human during long work

Goal: improve naturalness without adding noise.

Work:

- Add progress summarization rules.
- Let Gemini produce short spoken updates from Codex progress when useful.
- Add thresholds to avoid unnecessary updates for quick tasks.
- Add a visible elapsed timer for long-running Codex work.
- Add cancel/stop controls for long-running work.

Expected result:

Long Codex tasks feel supervised instead of abandoned.

### Phase 5: Upgrade browser audio capture/playback

Goal: reduce audio latency and improve stability.

Work:

- Replace `ScriptProcessorNode` microphone capture with `AudioWorklet`.
- Use an audio worklet or ring buffer for assistant audio playback.
- Track input/output sample rates explicitly.
- Add browser compatibility fallbacks.

Expected result:

Lower latency, smoother voice playback, and fewer browser-specific audio problems.

## Concrete inefficiencies found

### Backend

- Voice audio output is stored until turn completion instead of streamed immediately.
- Voice tool calls use blocking Codex execution instead of the existing streaming Codex runner.
- Gemini cannot continue the final answer until Codex returns, and the user gets little feedback during that gap.
- The text agent stream and live voice stream have different event shapes, so improvements have to be duplicated.
- Long-running work has no job state, no elapsed-time tracking, and no cancellation model. Note that `run_codex_stream` (`codex_runner.py:69`) runs the Codex SDK in a worker thread with no cancellation token, and the `finally: await future` will block on a runaway turn. Cancellation must be designed *into* the streaming runner (a stop signal the worker checks); it cannot be bolted on later as a pure frontend control. If cancel matters, address it earlier than Phase 4.
- The `/api/transcribe` endpoint appears to be legacy for one-shot transcription and is separate from the live voice path. Confirm the frontend no longer calls it before deprecating.

### Frontend

- Live voice only displays a temporary transcript preview; it does not create a durable in-chat progress timeline until the turn completes.
- Audio playback is built around complete audio URLs, not streaming audio chunks.
- The action log marks voice handoffs as done only after the Codex result comes back.
- The live banner has only broad states like "thinking" and "Gemini is replying"; it does not distinguish "Codex is running" from "Gemini is composing."
- Microphone capture uses older browser audio APIs.

## Suggested first build

The best first implementation should be small but meaningful:

1. Add acknowledgement behavior to the Gemini voice instruction.
2. Stream Codex progress through `/api/live`.
3. Stream Codex progress through `/api/chat/stream` when Gemini hands off from typed Agent mode.
4. Show Codex progress in the live banner, assistant message, and action log.
5. Add timer-based updates only for long-running tasks.
6. Fix interruption buffer cleanup while touching the voice path.
7. Keep final audio playback as-is for this phase.

This gives the biggest product improvement before touching the more complex audio playback layer.

After that, build true audio streaming as the next focused milestone.

## Success checklist

Before calling this project "real-time enough", verify:

- A simple voice question gets a quick spoken/text response.
- A voice request that triggers Codex shows handoff state immediately.
- A Codex task taking more than 30 seconds produces at least one useful update.
- A quick Codex task does not produce unnecessary filler updates.
- Gemini final text still appears correctly after Codex completes.
- Gemini final audio still plays.
- Streaming audio begins before the final turn is complete.
- Interrupting the assistant stops old audio and clears stale partial text.
- Typed chat still streams correctly.
- Direct Codex mode still streams correctly.
