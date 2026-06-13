import base64
import wave
from io import BytesIO
from pathlib import Path
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


def _resolve_tool_workdir(requested: object, session_workdir: str, project_root: str | None = None) -> str:
    raw = str(requested or "").strip() or session_workdir
    root = Path(project_root or session_workdir).expanduser().resolve(strict=True)
    resolved = Path(raw).expanduser().resolve(strict=True)
    if resolved != root and root not in resolved.parents:
        raise ValueError("Tool workdir must stay inside the selected project")
    return str(resolved)


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
    project_root: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    if not settings.google_api_key:
        yield {"type": "error", "message": "GOOGLE_API_KEY is not set"}
        return

    client = genai.Client(api_key=settings.google_api_key)
    session_workdir = workdir or settings.codex_default_workdir
    config = types.GenerateContentConfig(
        system_instruction=_system_instruction(session_workdir, conversation_context),
        response_mime_type="text/plain",
        tools=_get_tools(),
        tool_config=types.ToolConfig(
            function_calling_config=types.FunctionCallingConfig(mode=types.FunctionCallingConfigMode.AUTO)
        ),
    )

    tool_calls = []
    text_chunks: list[str] = []
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

    def _done_event() -> dict[str, Any]:
        return {
            "type": "done",
            "text": _finalize_generation(),
            "tool_calls": tool_calls,
            "workdir": session_workdir,
            "codex_events": codex_events[-200:],
            "codex_turn_id": codex_turn_id,
            "codex_thread_id": codex_thread_id,
            "codex_status": codex_status,
            "audio_data_url": None,
        }

    with tracing.session_context(
        session_id=conversation_id,
        metadata={"workdir": session_workdir},
        tags=["text-chat", "stream"],
    ), tracing.generation(
        "gemini-text-turn",
        model=settings.gemini_text_model,
        input=_turn_input(message, conversation_context),
    ) as gen:
        try:
            contents: list[types.Content] = [
                types.Content(role="user", parts=[types.Part(text=message)])
            ]

            while True:
                function_calls: list[types.FunctionCall] = []
                model_parts: list[types.Part] = []
                stream = await client.aio.models.generate_content_stream(
                    model=settings.gemini_text_model,
                    contents=contents,
                    config=config,
                )
                async for chunk in stream:
                    for candidate in chunk.candidates or []:
                        content = candidate.content
                        if not content:
                            continue
                        for part in content.parts or []:
                            if part.function_call:
                                function_calls.append(part.function_call)
                                model_parts.append(types.Part(function_call=part.function_call))
                            if part.text:
                                text_chunks.append(part.text)
                                model_parts.append(types.Part(text=part.text))
                                yield {"type": "delta", "text": part.text}

                if not function_calls:
                    yield _done_event()
                    return

                contents.append(types.Content(role="model", parts=model_parts))
                response_parts: list[types.Part] = []
                for call in function_calls:
                    if call.name == "end_conversation":
                        response = types.FunctionResponse(
                            id=call.id,
                            name=call.name,
                            response={"result": "Session ended successfully."},
                        )
                        tool_calls.append(
                            {
                                "name": call.name,
                                "args": {},
                                "result": "Session ended successfully.",
                                "workdir": session_workdir,
                            }
                        )
                        response_parts.append(types.Part(function_response=response))
                        continue

                    args = dict(call.args or {})
                    task = str(args.get("task") or message)
                    enhanced_task = improve_codex_task_prompt(task)
                    chosen_workdir = _resolve_tool_workdir(
                        args.get("workdir"),
                        session_workdir or settings.codex_default_workdir,
                        project_root,
                    )
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
                                yield {"type": "error", "message": event.get("message")}
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
                    response_parts.append(
                        types.Part(
                            function_response=types.FunctionResponse(
                                id=call.id,
                                name=call.name,
                                response={"result": final_response, "workdir": resolved_workdir},
                            )
                        )
                    )
                contents.append(types.Content(role="user", parts=response_parts))
        except Exception as exc:
            tracing.update_current_generation(level="ERROR", status_message=str(exc))
            yield {"type": "error", "message": str(exc)}
