import base64
import wave
from io import BytesIO
from typing import Any, AsyncIterator

from google import genai
from google.genai import types

from . import tracing
from .codex_runner import run_codex_stream_with_timer, CancellationToken
from .prompting import improve_codex_task_prompt
from .settings import Settings


SYSTEM_INSTRUCTION = """
You are a voice-first local work assistant. Your spoken replies must be short, factual, and honest.
This app is designed to feel real-time: acknowledge quickly, do work in the background, then
deliver results when ready.

TOOL-CALLING RULES (you must unmistakably follow these):

1. When the user asks about files, code, repos, git state, builds, tests, commands,
   or any local-computer work: say ONE brief sentence of acknowledgment (e.g. "On it."
   or "Checking that now.") and IMMEDIATELY call the tool in the SAME turn.
   The acknowledgment alone is NEVER a complete turn — the tool call must follow it.
2. You must unmistakably use the provided tool-calling mechanism to execute functions.
   NEVER write or speak the tool name, its parameters, or anything resembling a
   function call in your audio or text output. Tool calls are API-level actions,
   not spoken words.
3. NEVER claim you already called, finished, or completed a tool action unless the
   system actually executed it and returned a result to you. If you did not receive
   a tool result, you did not call the tool — do not pretend otherwise.
4. Do not answer local file, repo, git, build, test, or debug questions from memory
   or guesswork. Always use the tool.
5. After the tool returns a result, explain that result to the user clearly and
   completely. If the user asks to see content, show it in your response instead of
   telling them to open a file elsewhere.
6. For the task parameter: use a lightly cleaned version of the user's request.
   Improve grammar and clarity only. Do not inject chat history — Codex has its own
   session memory.
7. For follow-up requests ("make those changes", "what about X"), use the recent
   conversation context to understand intent. Do not ask the user to repeat.
8. Never end a tool-backed turn with only "Done" or a vague note. Include the
   answer, outcome, or next useful detail from the tool result.
9. If recent artifact references already contain the answer and the user asks to
   show or revisit prior output, use those references. Call the tool again only
   when the user asks for fresh local state or a new task.

Only answer directly without the tool when the user is making conversation, asking
a general conceptual question, or asking for a plan that requires no local access.

CONVERSATION ENDING RULES:
If the user indicates they are done, wants to end the conversation, or says goodbye (e.g., "goodbye", "bye", "bye-bye", "I'm done", "that's all", "leave session", "close the connection", or multilingual equivalents like "ok bye", "main chalta hoon"), you MUST immediately call the `end_conversation` tool and say goodbye to cleanly conclude the session.
"""


def _turn_input(message: str, conversation_context: str | None) -> dict[str, str]:
    """Readable trace input for a turn: the new user message plus the running
    conversation so the whole context is visible on the trace. Cross-turn flow
    is best viewed in the Langfuse Sessions tab (grouped by chat_id)."""
    return {
        "user_message": message,
        "conversation_so_far": conversation_context or "(start of conversation)",
    }


def _system_instruction(workdir: str | None = None, conversation_context: str | None = None) -> str:
    parts = [SYSTEM_INSTRUCTION.strip()]
    if workdir:
        parts.append(f"The current working directory for local work is: {workdir}")
    if conversation_context:
        parts.append(
            "\n".join(
                [
                    "Recent conversation in this chat:",
                    conversation_context.strip(),
                    "Use this chat history to resolve follow-up requests. Do not treat it as file-system truth; use the tool for local work.",
                ]
            )
        )
    return "\n\n".join(parts) + "\n"


def _get_tools() -> list[types.Tool]:
    return [
        types.Tool(
            function_declarations=[
                types.FunctionDeclaration(
                    name="run_codex_task",
                    description=(
                        "Execute a task on the user's local computer using the Codex coding agent. "
                        "MUST be called for ANY request involving: files, code, directories, git, "
                        "commands, tests, builds, debugging, reviews, diffs, or project inspection. "
                        "Call this tool instead of answering from memory for any local-work question."
                    ),
                    parameters={
                        "type": "object",
                        "properties": {
                            "task": {
                                "type": "string",
                                "description": (
                                    "The task to perform, written as a clear instruction. "
                                    "Derived from the user's request with improved grammar. "
                                    "Do not include conversation history."
                                ),
                            },
                            "workdir": {
                                "type": "string",
                                "description": (
                                    "Absolute path to the working directory. "
                                    "Defaults to the session's configured directory if omitted."
                                ),
                            },
                        },
                        "required": ["task"],
                    },
                ),
                types.FunctionDeclaration(
                    name="end_conversation",
                    description=(
                        "End the conversation and gracefully close/disconnect the voice session. "
                        "MUST be called immediately when the user explicitly requests to end the conversation, "
                        "says goodbye, or indicates they are finished/done with the voice session (e.g., \"goodbye\", "
                        "\"bye\", \"bye-bye\", \"I'm done\", \"close session\", \"that is all\", \"theek hai bye\")."
                    ),
                    parameters={
                        "type": "object",
                        "properties": {},
                    },
                ),
            ]
        )
    ]


def _pcm_to_wav_data_url(audio_chunks: list[bytes], sample_rate: int = 24000) -> str | None:
    if not audio_chunks:
        return None

    buffer = BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(b"".join(audio_chunks))

    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:audio/wav;base64,{encoded}"


def live_connect_config(
    settings: Settings,
    workdir: str | None = None,
    conversation_context: str | None = None,
) -> types.LiveConnectConfig:
    return types.LiveConnectConfig(
        system_instruction=_system_instruction(workdir, conversation_context),
        response_modalities=[types.Modality.AUDIO],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        speech_config=types.SpeechConfig(
            language_code=settings.gemini_language_code,
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=settings.gemini_voice_name)
            ),
        ),
        tools=_get_tools(),
    )


async def ask_gemini_stream(
    message: str,
    settings: Settings,
    workdir: str | None = None,
    cancel_token: CancellationToken = None,
    conversation_id: str | None = None,
    conversation_context: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    if not settings.google_api_key:
        yield {"type": "error", "message": "GOOGLE_API_KEY is not set"}
        return

    client = genai.Client(api_key=settings.google_api_key)
    session_workdir = workdir or settings.codex_default_workdir
    config = live_connect_config(settings, session_workdir, conversation_context)

    tool_calls = []
    text_chunks: list[str] = []
    audio_chunks: list[bytes] = []
    codex_events: list[dict[str, Any]] = []
    codex_turn_id = None
    codex_thread_id = None
    codex_status = None

    def _finalize_generation() -> str:
        final_text = "".join(text_chunks).strip() or "Done."
        tracing.update_current_generation(
            output=final_text, metadata={"tool_calls": len(tool_calls)}
        )
        return final_text

    with tracing.session_context(
        session_id=conversation_id,
        metadata={"workdir": session_workdir},
        tags=["voice-chat", "stream"],
    ), tracing.generation(
        "gemini-voice-turn",
        model=settings.gemini_model,
        input=_turn_input(message, conversation_context),
    ) as gen:
        try:
            async with client.aio.live.connect(model=settings.gemini_model, config=config) as session:
                await session.send_client_content(
                    turns=types.Content(role="user", parts=[types.Part(text=message)]),
                    turn_complete=True,
                )

                while True:
                    saw_message = False
                    async for server_message in session.receive():
                        saw_message = True

                        if server_message.tool_call and server_message.tool_call.function_calls:
                            responses = []
                            for call in server_message.tool_call.function_calls:
                                if call.name == "end_conversation":
                                    responses.append(
                                        types.FunctionResponse(
                                            id=call.id,
                                            name=call.name,
                                            response={"result": "Session ended successfully."},
                                        )
                                    )
                                    tool_calls.append(
                                        {
                                            "name": call.name,
                                            "args": {},
                                            "result": "Session ended successfully.",
                                            "workdir": session_workdir,
                                        }
                                    )
                                    continue
                                args = dict(call.args or {})
                                task = str(args.get("task") or message)
                                enhanced_task = improve_codex_task_prompt(task)
                                chosen_workdir = session_workdir or settings.codex_default_workdir
                                yield {
                                    "type": "tool_call",
                                    "name": call.name,
                                    "task": enhanced_task,
                                    "original_task": task,
                                    "workdir": chosen_workdir,
                                }
                                final_response = ""
                                resolved_workdir = chosen_workdir
                                with tracing.tool_call(
                                    call.name,
                                    parent=gen,
                                    input={"task": enhanced_task, "workdir": chosen_workdir},
                                ) as tool_obs:
                                    async for event in run_codex_stream_with_timer(
                                        enhanced_task,
                                        chosen_workdir,
                                        settings,
                                        cancel_token,
                                        conversation_id,
                                    ):
                                        if event.get("type") == "codex_event":
                                            codex_events.append(event)
                                            codex_turn_id = event.get("turn_id") or codex_turn_id
                                            codex_thread_id = event.get("thread_id") or codex_thread_id
                                            yield {"type": "codex_event", "event": event}
                                        elif event.get("type") == "delta":
                                            text_delta = event.get("text", "")
                                            final_response += text_delta
                                            yield {
                                                "type": "tool_progress",
                                                "name": call.name,
                                                "text": text_delta,
                                            }
                                        elif event.get("type") == "status":
                                            yield {
                                                "type": "status",
                                                "message": event.get("message"),
                                                "elapsed": event.get("elapsed"),
                                            }
                                        elif event.get("type") == "done":
                                            final_response = event.get("text", final_response)
                                            resolved_workdir = event.get("workdir", chosen_workdir)
                                            codex_events[:] = list(event.get("events") or codex_events)
                                            codex_turn_id = event.get("turn_id") or codex_turn_id
                                            codex_thread_id = event.get("thread_id") or codex_thread_id
                                            codex_status = event.get("status") or codex_status
                                        elif event.get("type") == "error":
                                            final_response = f"Error: {event.get('message')}"
                                            yield {
                                                "type": "error",
                                                "message": event.get("message")
                                            }
                                    tracing.update_observation(
                                        tool_obs,
                                        output=final_response,
                                        metadata={"workdir": resolved_workdir, "status": codex_status},
                                    )

                                tool_call = {
                                    "name": call.name,
                                    "args": {**args, "enhanced_task": enhanced_task},
                                    "result": final_response,
                                    "workdir": resolved_workdir,
                                }
                                tool_calls.append(tool_call)
                                yield {
                                    "type": "tool_result",
                                    "name": call.name,
                                    "result": final_response,
                                    "workdir": resolved_workdir,
                                    "codex_events": codex_events[-200:],
                                    "codex_turn_id": codex_turn_id,
                                    "codex_thread_id": codex_thread_id,
                                    "codex_status": codex_status,
                                }
                                responses.append(
                                    types.FunctionResponse(
                                        id=call.id,
                                        name=call.name,
                                        response={
                                            "result": final_response,
                                            "workdir": resolved_workdir,
                                        },
                                    )
                                )
                            await session.send_tool_response(function_responses=responses)
                            break

                        content = server_message.server_content
                        if content and content.output_transcription and content.output_transcription.text:
                            text = content.output_transcription.text
                            text_chunks.append(text)
                            yield {"type": "delta", "text": text}
                        if content and content.model_turn:
                            for part in content.model_turn.parts or []:
                                if part.inline_data and part.inline_data.data:
                                    audio_chunks.append(part.inline_data.data)
                                if part.text:
                                    text_chunks.append(part.text)
                                    yield {"type": "delta", "text": part.text}
                        if content and content.turn_complete:
                            yield {
                                "type": "done",
                                "text": _finalize_generation(),
                                "tool_calls": tool_calls,
                                "workdir": session_workdir,
                                "codex_events": codex_events[-200:],
                                "codex_turn_id": codex_turn_id,
                                "codex_thread_id": codex_thread_id,
                                "codex_status": codex_status,
                                "audio_data_url": _pcm_to_wav_data_url(audio_chunks),
                            }
                            return
                    if not saw_message:
                        yield {
                            "type": "done",
                            "text": _finalize_generation(),
                            "tool_calls": tool_calls,
                            "workdir": session_workdir,
                            "codex_events": codex_events[-200:],
                            "codex_turn_id": codex_turn_id,
                            "codex_thread_id": codex_thread_id,
                            "codex_status": codex_status,
                            "audio_data_url": _pcm_to_wav_data_url(audio_chunks),
                        }
                        return
        except Exception as exc:
            tracing.update_current_generation(level="ERROR", status_message=str(exc))
            yield {"type": "error", "message": str(exc)}


async def transcribe_audio(audio_bytes: bytes, mime_type: str, settings: Settings) -> str:
    if not settings.google_api_key:
        raise RuntimeError("GOOGLE_API_KEY is not set")
    if not audio_bytes:
        raise RuntimeError("No audio was recorded")

    client = genai.Client(api_key=settings.google_api_key)
    # The underlying generate_content call is auto-instrumented (model + token
    # usage). The wrapping span gives the trace a readable name; we never record
    # the raw audio bytes, only the resulting transcript.
    with tracing.span("transcribe-audio", input={"mime_type": mime_type, "bytes": len(audio_bytes)}):
        response = await client.aio.models.generate_content(
            model=settings.gemini_transcription_model,
            contents=[
                types.Content(
                    role="user",
                    parts=[
                        types.Part(text="Transcribe this audio exactly. Return only the spoken words."),
                        types.Part(inline_data=types.Blob(data=audio_bytes, mime_type=mime_type)),
                    ],
                )
            ],
            config=types.GenerateContentConfig(temperature=0, response_mime_type="text/plain"),
        )
        text = (response.text or "").strip()
        tracing.update_current_span(output=text)
        if not text:
            raise RuntimeError("Gemini could not transcribe the recorded audio")
        return text
