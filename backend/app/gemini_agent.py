import base64
import wave
from io import BytesIO
from typing import Any, AsyncIterator

from google import genai
from google.genai import types

from .codex_runner import run_codex
from .settings import Settings


SYSTEM_INSTRUCTION = """
You are a voice-first local work assistant. Keep replies short and clear.
When the user asks you to inspect, edit, build, debug, test, run, or review local files,
call the run_codex_task tool. Ask Codex to do the actual computer work.
If the user is just chatting or asking a simple planning question, answer directly.
"""


def _system_instruction(workdir: str | None = None) -> str:
    if not workdir:
        return SYSTEM_INSTRUCTION
    return f"{SYSTEM_INSTRUCTION}\nThe current working directory for local work is: {workdir}\n"


def _codex_tool() -> types.Tool:
    return types.Tool(
        function_declarations=[
            types.FunctionDeclaration(
                name="run_codex_task",
                description="Run a local Codex SDK task on this computer. Use it for coding, file, terminal, repo, or project work.",
                parameters={
                    "type": "object",
                    "properties": {
                        "task": {"type": "string", "description": "The exact task Codex should perform."},
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


def live_connect_config(settings: Settings, workdir: str | None = None) -> types.LiveConnectConfig:
    return types.LiveConnectConfig(
        system_instruction=_system_instruction(workdir),
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


async def ask_gemini(message: str, settings: Settings, workdir: str | None = None) -> dict[str, Any]:
    if not settings.google_api_key:
        raise RuntimeError("GOOGLE_API_KEY is not set")

    client = genai.Client(api_key=settings.google_api_key)
    session_workdir = workdir or settings.codex_default_workdir
    config = live_connect_config(settings, session_workdir)

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
                        chosen_workdir = str(args.get("workdir") or session_workdir or settings.codex_default_workdir)
                        codex_result = await run_codex(task, chosen_workdir, settings)
                        tool_calls.append(
                            {
                                "name": call.name,
                                "args": args,
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


async def ask_gemini_stream(message: str, settings: Settings, workdir: str | None = None) -> AsyncIterator[dict[str, Any]]:
    if not settings.google_api_key:
        yield {"type": "error", "message": "GOOGLE_API_KEY is not set"}
        return

    client = genai.Client(api_key=settings.google_api_key)
    session_workdir = workdir or settings.codex_default_workdir
    config = live_connect_config(settings, session_workdir)

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
                            chosen_workdir = str(args.get("workdir") or session_workdir or settings.codex_default_workdir)
                            yield {
                                "type": "tool_call",
                                "name": call.name,
                                "task": task,
                                "workdir": chosen_workdir,
                            }
                            codex_result = await run_codex(task, chosen_workdir, settings)
                            tool_call = {
                                "name": call.name,
                                "args": args,
                                "result": codex_result.final_response,
                                "workdir": codex_result.workdir,
                            }
                            tool_calls.append(tool_call)
                            yield {
                                "type": "tool_result",
                                "name": call.name,
                                "result": codex_result.final_response,
                                "workdir": codex_result.workdir,
                            }
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
