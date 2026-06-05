from typing import Any

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


async def ask_gemini(message: str, settings: Settings) -> dict[str, Any]:
    if not settings.google_api_key:
        raise RuntimeError("GOOGLE_API_KEY is not set")

    client = genai.Client(api_key=settings.google_api_key)
    config = types.LiveConnectConfig(
        system_instruction=SYSTEM_INSTRUCTION,
        response_modalities=[types.Modality.AUDIO],
        output_audio_transcription=types.AudioTranscriptionConfig(),
        tools=[_codex_tool()],
    )

    tool_calls = []
    text_chunks: list[str] = []

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
                        workdir = str(args.get("workdir") or settings.codex_default_workdir)
                        codex_result = await run_codex(task, workdir, settings)
                        tool_calls.append(
                            {"name": call.name, "args": args, "result": codex_result.final_response}
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
                        if part.text:
                            text_chunks.append(part.text)
                if content and content.turn_complete:
                    return {
                        "reply": "".join(text_chunks).strip() or "Done.",
                        "tool_calls": tool_calls,
                    }
            else:
                return {
                    "reply": "".join(text_chunks).strip() or "Done.",
                    "tool_calls": tool_calls,
                }

    return {
        "reply": "".join(text_chunks).strip() or "Done.",
        "tool_calls": tool_calls,
    }
