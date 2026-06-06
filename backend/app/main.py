import base64
import asyncio

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai
from google.genai import types

from .codex_runner import run_codex
from .gemini_agent import _pcm_to_wav_data_url, ask_gemini, live_connect_config, transcribe_audio
from .history import HistoryStore
from .settings import get_settings


settings = get_settings()
history = HistoryStore(settings.history_path)

app = FastAPI(title="Codex Voice Agent")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173", "http://0.0.0.0:5173"],
    allow_origin_regex=r"http://(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+):5173",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str


class CodexRequest(BaseModel):
    task: str
    workdir: str | None = None


class TranscribeRequest(BaseModel):
    audio_base64: str
    mime_type: str = "audio/webm"


@app.get("/api/health")
async def health() -> dict[str, object]:
    return {
        "ok": True,
        "gemini_model": settings.gemini_model,
        "gemini_transcription_model": settings.gemini_transcription_model,
        "gemini_voice_name": settings.gemini_voice_name,
        "has_google_api_key": bool(settings.google_api_key),
        "codex_default_workdir": settings.codex_default_workdir,
    }


@app.get("/api/history")
async def list_history() -> list[dict[str, object]]:
    return history.list()


@app.delete("/api/history")
async def clear_history() -> dict[str, object]:
    history.clear()
    return {"ok": True}


@app.post("/api/chat")
async def chat(req: ChatRequest) -> dict[str, object]:
    text = req.message.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message is required")
    history.append("user", text)
    try:
        result = await ask_gemini(text, settings)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    history.append("assistant", result["reply"], {"tool_calls": result["tool_calls"]})
    return result


@app.post("/api/transcribe")
async def transcribe(req: TranscribeRequest) -> dict[str, object]:
    try:
        audio_bytes = base64.b64decode(req.audio_base64)
        text = await transcribe_audio(audio_bytes, req.mime_type, settings)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"text": text}


@app.websocket("/api/live")
async def live_voice(websocket: WebSocket) -> None:
    await websocket.accept()
    if not settings.google_api_key:
        await websocket.send_json({"type": "error", "message": "GOOGLE_API_KEY is not set"})
        await websocket.close()
        return

    client = genai.Client(api_key=settings.google_api_key)
    audio_chunks: list[bytes] = []
    input_text_chunks: list[str] = []
    output_text_chunks: list[str] = []

    async def send_client_audio(session: object) -> None:
        while True:
            payload = await websocket.receive_json()
            event_type = payload.get("type")
            if event_type == "audio":
                audio_base64 = str(payload.get("data") or "")
                if not audio_base64:
                    continue
                audio_bytes = base64.b64decode(audio_base64)
                mime_type = str(payload.get("mime_type") or "audio/pcm;rate=16000")
                await session.send_realtime_input(audio=types.Blob(data=audio_bytes, mime_type=mime_type))
            elif event_type == "stop":
                await session.send_realtime_input(audio_stream_end=True)
                await websocket.send_json({"type": "debug", "message": "Sent audio stream end to Gemini."})
            elif event_type == "close":
                return

    async def receive_gemini(session: object) -> None:
        nonlocal audio_chunks, input_text_chunks, output_text_chunks
        while True:
            received_message = False
            async for server_message in session.receive():
                received_message = True
                if server_message.setup_complete:
                    await websocket.send_json({"type": "ready", "message": "Gemini Live session ready."})

                if server_message.tool_call and server_message.tool_call.function_calls:
                    responses = []
                    user_text = "".join(input_text_chunks).strip()
                    for call in server_message.tool_call.function_calls:
                        args = dict(call.args or {})
                        task = str(args.get("task") or user_text or "Run the requested local task.")
                        workdir = str(args.get("workdir") or settings.codex_default_workdir)
                        codex_result = await run_codex(task, workdir, settings)
                        responses.append(
                            types.FunctionResponse(
                                id=call.id,
                                name=call.name,
                                response={"result": codex_result.final_response, "workdir": codex_result.workdir},
                            )
                        )
                        await websocket.send_json(
                            {
                                "type": "tool_call",
                                "name": call.name,
                                "result": codex_result.final_response,
                                "workdir": codex_result.workdir,
                            }
                        )
                    await session.send_tool_response(function_responses=responses)

                content = server_message.server_content
                if not content:
                    continue

                if content.interrupted:
                    audio_chunks = []
                    output_text_chunks = []
                    await websocket.send_json({"type": "interrupted"})

                if content.input_transcription and content.input_transcription.text:
                    text = content.input_transcription.text
                    input_text_chunks.append(text)
                    await websocket.send_json({"type": "user_transcript", "text": text})

                if content.output_transcription and content.output_transcription.text:
                    text = content.output_transcription.text
                    output_text_chunks.append(text)
                    await websocket.send_json({"type": "assistant_delta", "text": text})

                if content.model_turn:
                    for part in content.model_turn.parts or []:
                        if part.inline_data and part.inline_data.data:
                            audio_chunks.append(part.inline_data.data)
                        if part.text:
                            output_text_chunks.append(part.text)
                            await websocket.send_json({"type": "assistant_delta", "text": part.text})

                if content.turn_complete:
                    user_text = "".join(input_text_chunks).strip()
                    assistant_text = "".join(output_text_chunks).strip() or "Done."
                    if user_text:
                        history.append("user", user_text)
                    history.append("assistant", assistant_text)
                    await websocket.send_json(
                        {
                            "type": "turn_complete",
                            "user_text": user_text,
                            "assistant_text": assistant_text,
                            "audio_data_url": _pcm_to_wav_data_url(audio_chunks),
                        }
                    )
                    audio_chunks = []
                    input_text_chunks = []
                    output_text_chunks = []
            if received_message:
                await websocket.send_json({"type": "debug", "message": "Gemini receive loop is waiting for the next turn."})
            await asyncio.sleep(0.05)

    try:
        async with client.aio.live.connect(model=settings.gemini_model, config=live_connect_config(settings)) as session:
            await websocket.send_json({"type": "debug", "message": "Connected to Gemini Live."})
            send_task = asyncio.create_task(send_client_audio(session))
            receive_task = asyncio.create_task(receive_gemini(session))
            done, pending = await asyncio.wait({send_task, receive_task}, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            for task in done:
                task.result()
            await websocket.close()
    except WebSocketDisconnect:
        return
    except Exception as exc:
        try:
            await websocket.send_json({"type": "error", "message": str(exc)})
        except Exception:
            return


@app.post("/api/codex")
async def codex(req: CodexRequest) -> dict[str, object]:
    task = req.task.strip()
    if not task:
        raise HTTPException(status_code=400, detail="Task is required")
    workdir = req.workdir or settings.codex_default_workdir
    history.append("user", task, {"direct_codex": True, "workdir": workdir})
    try:
        result = await run_codex(task, workdir, settings)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    history.append("assistant", result.final_response, {"direct_codex": True, "workdir": result.workdir})
    return {"reply": result.final_response, "workdir": result.workdir}
