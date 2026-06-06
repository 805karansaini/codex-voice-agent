import base64
import asyncio
import json
import shutil
import subprocess
import sys
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from google import genai
from google.genai import types

from .codex_runner import resolve_workdir, run_codex, run_codex_stream, run_codex_stream_with_timer, CancellationToken
from .gemini_agent import _pcm_to_wav_data_url, ask_gemini, ask_gemini_stream, live_connect_config, transcribe_audio
from .history import ChatStore, HistoryStore, ProjectStore
from .settings import get_settings


settings = get_settings()
history = HistoryStore(settings.history_path)
projects = ProjectStore(settings.history_path.with_name("projects.json"))
chats = ChatStore(settings.history_path.with_name("chats.json"))

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
    workdir: str | None = None
    project_id: str | None = None
    chat_id: str | None = None


class CodexRequest(BaseModel):
    task: str
    workdir: str | None = None
    project_id: str | None = None
    chat_id: str | None = None


class ProjectRequest(BaseModel):
    id: str
    name: str
    path: str
    color: str
    createdAt: int


class ChatMetaRequest(BaseModel):
    id: str
    projectId: str
    title: str
    createdAt: int


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
async def list_history(
    project_id: str | None = None, workdir: str | None = None, chat_id: str | None = None
) -> list[dict[str, object]]:
    return history.list(project_id=project_id, workdir=workdir, chat_id=chat_id)


@app.delete("/api/history")
async def clear_history(
    project_id: str | None = None, workdir: str | None = None, chat_id: str | None = None
) -> dict[str, object]:
    history.clear(project_id=project_id, workdir=workdir, chat_id=chat_id)
    return {"ok": True}


@app.get("/api/projects")
async def list_projects() -> list[dict[str, object]]:
    return projects.list()


@app.post("/api/projects")
async def save_project(req: ProjectRequest) -> dict[str, object]:
    if not req.id.strip() or not req.name.strip():
        raise HTTPException(status_code=400, detail="Project id and name are required")
    try:
        root = resolve_workdir(req.path)
    except (FileNotFoundError, NotADirectoryError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    project = {
        "id": req.id.strip(),
        "name": req.name.strip(),
        "path": str(root),
        "color": req.color,
        "createdAt": req.createdAt,
    }
    return projects.upsert(project)


@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: str) -> dict[str, object]:
    projects.delete(project_id)
    chats.delete_for_project(project_id)
    history.clear(project_id=project_id)
    return {"ok": True}


@app.get("/api/chats")
async def list_chats(project_id: str | None = None) -> list[dict[str, object]]:
    return chats.list(project_id=project_id)


@app.post("/api/chats")
async def save_chat(req: ChatMetaRequest) -> dict[str, object]:
    if not req.id.strip() or not req.projectId.strip():
        raise HTTPException(status_code=400, detail="Chat id and projectId are required")
    chat = {
        "id": req.id.strip(),
        "projectId": req.projectId.strip(),
        "title": req.title.strip() or "New chat",
        "createdAt": req.createdAt,
    }
    return chats.upsert(chat)


@app.delete("/api/chats/{chat_id}")
async def delete_chat(chat_id: str) -> dict[str, object]:
    chats.delete(chat_id)
    history.clear(chat_id=chat_id)
    return {"ok": True}


@app.post("/api/chat")
async def chat(req: ChatRequest) -> dict[str, object]:
    text = req.message.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message is required")
    history_meta = {
        "workdir": req.workdir or settings.codex_default_workdir,
        "project_id": req.project_id,
        "chat_id": req.chat_id,
    }
    history.append("user", text, history_meta)
    try:
        result = await ask_gemini(text, settings, workdir=req.workdir)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    history.append(
        "assistant",
        result["reply"],
        {
            "tool_calls": result["tool_calls"],
            "workdir": result.get("workdir"),
            "project_id": req.project_id,
            "chat_id": req.chat_id,
        },
    )
    return result


@app.post("/api/chat/stream")
async def chat_stream(req: ChatRequest) -> StreamingResponse:
    text = req.message.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message is required")
    workdir = req.workdir or settings.codex_default_workdir
    history.append("user", text, {"workdir": workdir, "project_id": req.project_id, "chat_id": req.chat_id})

    cancel_token = CancellationToken()

    async def event_source():
        final_text = ""
        final_workdir = workdir
        final_tool_calls = []
        try:
            async for event in ask_gemini_stream(text, settings, workdir=req.workdir, cancel_token=cancel_token):
                if event.get("type") == "done":
                    final_text = str(event.get("text") or "")
                    final_workdir = str(event.get("workdir") or workdir)
                    final_tool_calls = list(event.get("tool_calls") or [])
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
        finally:
            cancel_token.cancel()
            if final_text:
                history.append(
                    "assistant",
                    final_text,
                    {
                        "tool_calls": final_tool_calls,
                        "workdir": final_workdir,
                        "project_id": req.project_id,
                        "chat_id": req.chat_id,
                    },
                )

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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
    session_chat_id: str | None = None
    current_task_cancel_token: CancellationToken | None = None

    async def send_client_audio(session: object, initial: dict | None = None) -> None:
        nonlocal session_workdir, session_project_id, session_chat_id, current_task_cancel_token
        pending = initial
        while True:
            payload = pending if pending is not None else await websocket.receive_json()
            pending = None
            event_type = payload.get("type")
            if event_type == "config":
                session_workdir = str(payload.get("workdir") or "").strip() or session_workdir
                session_project_id = str(payload.get("project_id") or "").strip() or session_project_id
                session_chat_id = str(payload.get("chat_id") or "").strip() or session_chat_id
                await websocket.send_json({"type": "debug", "message": f"Active workdir: {session_workdir}"})
            elif event_type == "audio":
                audio_base64 = str(payload.get("data") or "")
                if not audio_base64:
                    continue
                audio_bytes = base64.b64decode(audio_base64)
                mime_type = str(payload.get("mime_type") or "audio/pcm;rate=16000")
                await session.send_realtime_input(audio=types.Blob(data=audio_bytes, mime_type=mime_type))
            elif event_type == "stop":
                await session.send_realtime_input(audio_stream_end=True)
                await websocket.send_json({"type": "debug", "message": "Sent audio stream end to Gemini."})
            elif event_type == "cancel_task":
                if current_task_cancel_token:
                    current_task_cancel_token.cancel()
                    await websocket.send_json({"type": "debug", "message": "Codex task cancelled."})
            elif event_type == "close":
                return

    async def receive_gemini(session: object) -> None:
        nonlocal audio_chunks, input_text_chunks, output_text_chunks, current_task_cancel_token
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
                        workdir = str(args.get("workdir") or session_workdir or settings.codex_default_workdir)
                        
                        await websocket.send_json(
                            {
                                "type": "tool_call_started",
                                "name": call.name,
                                "task": task,
                                "workdir": workdir,
                            }
                        )

                        cancel_token = CancellationToken()
                        current_task_cancel_token = cancel_token

                        final_response = ""
                        resolved_workdir = workdir
                        async for event in run_codex_stream_with_timer(task, workdir, settings, cancel_token):
                            if event.get("type") == "delta":
                                text_delta = event.get("text", "")
                                final_response += text_delta
                                await websocket.send_json(
                                    {
                                        "type": "tool_progress",
                                        "name": call.name,
                                        "text": text_delta,
                                    }
                                )
                            elif event.get("type") == "status":
                                await websocket.send_json(
                                    {
                                        "type": "status",
                                        "message": event.get("message"),
                                        "elapsed": event.get("elapsed"),
                                    }
                                )
                            elif event.get("type") == "done":
                                final_response = event.get("text", final_response)
                                resolved_workdir = event.get("workdir", workdir)
                            elif event.get("type") == "error":
                                final_response = f"Error: {event.get('message')}"
                                await websocket.send_json(
                                    {
                                        "type": "tool_call_failed",
                                        "name": call.name,
                                        "message": event.get("message"),
                                    }
                                )

                        current_task_cancel_token = None

                        responses.append(
                            types.FunctionResponse(
                                id=call.id,
                                name=call.name,
                                response={"result": final_response, "workdir": resolved_workdir},
                            )
                        )
                        await websocket.send_json(
                            {
                                "type": "tool_result",
                                "name": call.name,
                                "result": final_response,
                                "workdir": resolved_workdir,
                            }
                        )
                    await session.send_tool_response(function_responses=responses)

                content = server_message.server_content
                if not content:
                    continue

                if content.interrupted:
                    if current_task_cancel_token:
                        current_task_cancel_token.cancel()
                    audio_chunks = []
                    input_text_chunks = []
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
                            audio_b64 = base64.b64encode(part.inline_data.data).decode("ascii")
                            await websocket.send_json(
                                {
                                    "type": "assistant_audio_delta",
                                    "data": audio_b64,
                                }
                            )
                        if part.text:
                            output_text_chunks.append(part.text)
                            await websocket.send_json({"type": "assistant_delta", "text": part.text})

                if content.turn_complete:
                    user_text = "".join(input_text_chunks).strip()
                    assistant_text = "".join(output_text_chunks).strip() or "Done."
                    if user_text:
                        history.append("user", user_text, {"workdir": session_workdir, "project_id": session_project_id, "chat_id": session_chat_id})
                    history.append("assistant", assistant_text, {"workdir": session_workdir, "project_id": session_project_id, "chat_id": session_chat_id})
                    await websocket.send_json(
                        {
                            "type": "turn_complete",
                            "user_text": user_text,
                            "assistant_text": assistant_text,
                            "workdir": session_workdir,
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
        # Read the opening frame first: the client sends {type:"config", workdir}
        # on connect, so we can bake the working directory into the system prompt.
        first_payload: dict | None = await websocket.receive_json()
        if first_payload.get("type") == "config":
            session_workdir = str(first_payload.get("workdir") or "").strip() or session_workdir
            session_project_id = str(first_payload.get("project_id") or "").strip() or session_project_id
            session_chat_id = str(first_payload.get("chat_id") or "").strip() or session_chat_id
            await websocket.send_json({"type": "debug", "message": f"Active workdir: {session_workdir}"})
            first_payload = None

        async with client.aio.live.connect(
            model=settings.gemini_model, config=live_connect_config(settings, session_workdir)
        ) as session:
            await websocket.send_json({"type": "debug", "message": "Connected to Gemini Live."})
            send_task = asyncio.create_task(send_client_audio(session, first_payload))
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
    history.append("user", task, {"direct_codex": True, "workdir": workdir, "project_id": req.project_id, "chat_id": req.chat_id})
    try:
        result = await run_codex(task, workdir, settings)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    history.append("assistant", result.final_response, {"direct_codex": True, "workdir": result.workdir, "project_id": req.project_id, "chat_id": req.chat_id})
    return {"reply": result.final_response, "workdir": result.workdir}


def _git_branch(root: Path) -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, timeout=2,
        )
        branch = out.stdout.strip()
        return branch or None
    except Exception:
        return None


def _file_count(root: Path) -> int | None:
    """Count tracked files when it's a git repo, else a shallow file count."""
    try:
        tracked = subprocess.run(
            ["git", "-C", str(root), "ls-files"], capture_output=True, text=True, timeout=3,
        )
        if tracked.returncode == 0 and tracked.stdout.strip():
            return len([line for line in tracked.stdout.splitlines() if line.strip()])
    except Exception:
        pass
    try:
        return sum(1 for entry in root.iterdir() if entry.is_file())
    except Exception:
        return None


def _pick_directory_sync() -> str | None:
    """Open a real native folder dialog on the host and return the absolute path.

    Browsers cannot expose absolute paths from their directory picker, but this
    backend runs locally, so it can use the OS picker (macOS osascript, or
    zenity/kdialog on Linux). Returns None if the user cancels.
    """
    if sys.platform == "darwin":
        script = (
            'try\n'
            '  POSIX path of (choose folder with prompt "Select a project folder")\n'
            'on error number -128\n'
            '  return ""\n'
            'end try'
        )
        proc = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
        return (proc.stdout.strip() or None) if proc.returncode == 0 else None
    if shutil.which("zenity"):
        proc = subprocess.run(
            ["zenity", "--file-selection", "--directory", "--title=Select a project folder"],
            capture_output=True, text=True,
        )
        return proc.stdout.strip() or None
    if shutil.which("kdialog"):
        proc = subprocess.run(
            ["kdialog", "--getexistingdirectory", str(Path.home())], capture_output=True, text=True
        )
        return proc.stdout.strip() or None
    raise RuntimeError("No native folder picker is available on this host. Paste the path instead.")


@app.post("/api/fs/pick")
async def fs_pick() -> dict[str, object]:
    try:
        path = await asyncio.to_thread(_pick_directory_sync)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if not path:
        return {"path": None, "cancelled": True}
    cleaned = path.rstrip("/") or "/"
    return {"path": cleaned, "cancelled": False}


@app.get("/api/project/info")
async def project_info(path: str) -> dict[str, object]:
    """Validate a directory and report git branch + file count.

    Used both to confirm a folder exists before adding it (no copies, no
    auto-created folders) and to populate the workspace panel.
    """
    try:
        root = resolve_workdir(path)
    except (FileNotFoundError, NotADirectoryError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    is_git = (root / ".git").exists()
    return {
        "path": str(root),
        "name": root.name,
        "exists": True,
        "is_git": is_git,
        "branch": _git_branch(root) if is_git else None,
        "file_count": _file_count(root),
    }


@app.post("/api/codex/stream")
async def codex_stream(req: CodexRequest) -> StreamingResponse:
    task = req.task.strip()
    if not task:
        raise HTTPException(status_code=400, detail="Task is required")
    workdir = req.workdir or settings.codex_default_workdir
    history.append("user", task, {"direct_codex": True, "workdir": workdir, "project_id": req.project_id, "chat_id": req.chat_id})

    cancel_token = CancellationToken()

    async def event_source():
        final_text = ""
        final_workdir = workdir
        try:
            async for event in run_codex_stream_with_timer(task, workdir, settings, cancel_token):
                if event.get("type") == "done":
                    final_text = str(event.get("text") or "")
                    final_workdir = str(event.get("workdir") or workdir)
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
        finally:
            cancel_token.cancel()
            if final_text:
                history.append(
                    "assistant",
                    final_text,
                    {"direct_codex": True, "workdir": final_workdir, "project_id": req.project_id, "chat_id": req.chat_id},
                )

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
