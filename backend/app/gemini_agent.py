import base64
import wave
from io import BytesIO
from typing import Any, AsyncIterator

from google import genai
from google.genai import types

from .codex_runner import run_codex, run_codex_stream_with_timer, CancellationToken
from .prompting import improve_codex_task_prompt
from .settings import Settings


SYSTEM_INSTRUCTION = """
You are a voice-first local work assistant. Keep spoken replies short, clear, and honest.

You have access to one tool:
- run_codex_task(task, workdir)

Use run_codex_task whenever the user asks you to do work on the local computer or project, including:
- inspect, summarize, review, compare, or explain files, folders, git diffs, staged changes, unstaged changes, logs, or repo state
- run commands, tests, builds, checks, package installs, or scripts
- edit, fix, create, delete, move, or revert code or files
- debug why something is failing in the app or workspace

For those local-work requests:
1. Say at most one short acknowledgment before the tool call.
2. Then immediately call run_codex_task in the same turn.
3. Put a lightly clarified version of the user's latest request in the task argument. Improve grammar and clarity, but do not add new requirements.
4. Use the current working directory in the workdir argument when it is available.
5. Do not claim that you called, will call, are calling, or attempted to call the tool unless you actually emit the run_codex_task tool call.
6. Do not answer local file, repo, git, build, test, or debug questions from memory or guesswork. Use the tool.
7. If the user asks for an update, status, follow-up, or says "make those changes", use the recent conversation context to identify what they mean before asking them to repeat it.
8. Do not paste recent chat history into the run_codex_task task. Codex uses the same session for this chat and already has its own prior Codex turns.

Only answer directly without a tool when the user is making conversation, asking a general conceptual question, or asking for a plan that does not require looking at local files or running anything.
"""


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


def _codex_tool() -> types.Tool:
    return types.Tool(
        function_declarations=[
            types.FunctionDeclaration(
                name="run_codex_task",
                description="Run a local Codex SDK task on this computer. Use it for coding, file, terminal, repo, or project work.",
                parameters={
                    "type": "object",
                    "properties": {
                        "task": {
                            "type": "string",
                            "description": (
                                "A lightly rewritten version of the user's latest request for Codex. "
                                "Fix grammar and clarity only. Do not include chat history or tool-result transcripts."
                            ),
                        },
                        "workdir": {
                            "type": "string",
                            "description": "Local folder to work in. Use the configured default if not supplied.",
                        },
                    },
                    "required": ["task"],
                },
            )
        ]
    )


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
        tools=[_codex_tool()],
    )


async def ask_gemini(
    message: str,
    settings: Settings,
    workdir: str | None = None,
    conversation_id: str | None = None,
    conversation_context: str | None = None,
) -> dict[str, Any]:
    if not settings.google_api_key:
        raise RuntimeError("GOOGLE_API_KEY is not set")

    client = genai.Client(api_key=settings.google_api_key)
    session_workdir = workdir or settings.codex_default_workdir
    config = live_connect_config(settings, session_workdir, conversation_context)

    tool_calls = []
    text_chunks: list[str] = []
    audio_chunks: list[bytes] = []

    async with client.aio.live.connect(model=settings.gemini_model, config=config) as session:
        await session.send_client_content(
            turns=types.Content(role="user", parts=[types.Part(text=message)]),
            turn_complete=True,
        )

        while True:
            async for server_message in session.receive():
                if server_message.tool_call and server_message.tool_call.function_calls:
                    responses = []
                    for call in server_message.tool_call.function_calls:
                        args = dict(call.args or {})
                        task = str(args.get("task") or message)
                        enhanced_task = improve_codex_task_prompt(task)
                        chosen_workdir = session_workdir or settings.codex_default_workdir
                        codex_result = await run_codex(enhanced_task, chosen_workdir, settings, conversation_id)
                        tool_calls.append(
                            {
                                "name": call.name,
                                "args": {**args, "enhanced_task": enhanced_task},
                                "result": codex_result.final_response,
                                "workdir": codex_result.workdir,
                            }
                        )
                        responses.append(
                            types.FunctionResponse(
                                id=call.id,
                                name=call.name,
                                response={
                                    "result": codex_result.final_response,
                                    "workdir": codex_result.workdir,
                                },
                            )
                        )
                    await session.send_tool_response(function_responses=responses)
                    break

                content = server_message.server_content
                if content and content.output_transcription and content.output_transcription.text:
                    text_chunks.append(content.output_transcription.text)
                if content and content.model_turn:
                    for part in content.model_turn.parts or []:
                        if part.inline_data and part.inline_data.data:
                            audio_chunks.append(part.inline_data.data)
                        if part.text:
                            text_chunks.append(part.text)
                if content and content.turn_complete:
                    return {
                        "reply": "".join(text_chunks).strip() or "Done.",
                        "tool_calls": tool_calls,
                        "workdir": session_workdir,
                        "audio_data_url": _pcm_to_wav_data_url(audio_chunks),
                    }
            else:
                return {
                    "reply": "".join(text_chunks).strip() or "Done.",
                    "tool_calls": tool_calls,
                    "workdir": session_workdir,
                    "audio_data_url": _pcm_to_wav_data_url(audio_chunks),
                }

    return {
        "reply": "".join(text_chunks).strip() or "Done.",
        "tool_calls": tool_calls,
        "workdir": session_workdir,
        "audio_data_url": _pcm_to_wav_data_url(audio_chunks),
    }


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
                            async for event in run_codex_stream_with_timer(
                                enhanced_task,
                                chosen_workdir,
                                settings,
                                cancel_token,
                                conversation_id,
                            ):
                                if event.get("type") == "delta":
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
                                elif event.get("type") == "error":
                                    final_response = f"Error: {event.get('message')}"
                                    yield {
                                        "type": "error",
                                        "message": event.get("message")
                                    }

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
                            "text": "".join(text_chunks).strip() or "Done.",
                            "tool_calls": tool_calls,
                            "workdir": session_workdir,
                            "audio_data_url": _pcm_to_wav_data_url(audio_chunks),
                        }
                        return
                if not saw_message:
                    yield {
                        "type": "done",
                        "text": "".join(text_chunks).strip() or "Done.",
                        "tool_calls": tool_calls,
                        "workdir": session_workdir,
                        "audio_data_url": _pcm_to_wav_data_url(audio_chunks),
                    }
                    return
    except Exception as exc:
        yield {"type": "error", "message": str(exc)}


async def transcribe_audio(audio_bytes: bytes, mime_type: str, settings: Settings) -> str:
    if not settings.google_api_key:
        raise RuntimeError("GOOGLE_API_KEY is not set")
    if not audio_bytes:
        raise RuntimeError("No audio was recorded")

    client = genai.Client(api_key=settings.google_api_key)
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
    if not text:
        raise RuntimeError("Gemini could not transcribe the recorded audio")
    return text
