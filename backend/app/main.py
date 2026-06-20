import asyncio
import base64
import json
import re
import shutil
import subprocess
import sys
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, AsyncIterator, Protocol, TypedDict, cast

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

from .codex_runner import (
    CancellationToken,
    close_codex_thread_session,
    close_codex_thread_sessions,
    close_codex_thread_sessions_for,
    interrupt_codex_thread_session,
    resolve_workdir,
    run_codex_stream_with_timer,
)
from .gemini_agent import _pcm_to_wav_data_url, ask_gemini_stream, live_connect_config
from .history import (
    ArtifactStore,
    ChatStore,
    CodexHandoffStore,
    ConsoleStore,
    HistoryStore,
    ProjectStore,
)
from .live_logging import JsonlEventLogger, LiveSessionLogger, clip_text
from .prompting import build_recent_conversation_context, improve_codex_task_prompt
from .routes.change_review import create_router as create_change_review_router
from .routes.codex_jobs import create_router as create_codex_jobs_router
from .services.background_jobs import BackgroundJobService, CodexBackgroundJob
from .services.change_review import (
    CommitResult,
    RevertResult,
    artifact_content_type,
    artifact_summary,
    changed_files_from_status,
    commit_changed_files,
    create_change_review_artifact,
    create_tool_artifact,
    event_item_type,
    git_output,
    has_file_changes,
    revert_changed_files,
)
from .settings import get_settings
from . import tracing


class _LiveSession(Protocol):
    async def send_realtime_input(self, **kwargs: Any) -> None: ...

    async def send_tool_response(self, **kwargs: Any) -> None: ...

    async def send_client_content(self, **kwargs: Any) -> None: ...

    def receive(self) -> AsyncIterator[Any]: ...


_RevertResult = RevertResult
_CommitResult = CommitResult


class _LiveClientConfig(TypedDict):
    project_id: str | None
    chat_id: str | None
    workdir: str
    conversation_context: str


class _LiveCompletion(TypedDict):
    handoff: dict[str, object]
    result: str
    artifacts: list[dict[str, object]]


@dataclass(frozen=True)
class _LiveToolCallRequest:
    name: str
    is_end_conversation: bool
    task: str
    enhanced_task: str
    workdir: str


@dataclass(frozen=True)
class _LiveCodexResult:
    response: str
    workdir: str
    events: list[object]
    turn_id: str | None
    thread_id: str | None
    status: str | None
    job_id: str | None = None
    background_status: str | None = None


@dataclass
class _LiveTurnState:
    audio_chunks: list[bytes] = field(default_factory=list)
    input_audio_bytes: int = 0
    input_text_chunks: list[str] = field(default_factory=list)
    output_text_chunks: list[str] = field(default_factory=list)
    streamed_audio: bool = False
    codex_events: list[object] = field(default_factory=list)
    codex_turn_id: str | None = None
    codex_thread_id: str | None = None
    codex_status: str | None = None
    artifacts: list[dict[str, object]] = field(default_factory=list)
    handoff_ids: list[str] = field(default_factory=list)

    @property
    def user_text(self) -> str:
        return "".join(self.input_text_chunks).strip()

    @property
    def assistant_text(self) -> str:
        return "".join(self.output_text_chunks).strip()

    def add_codex_result(
        self,
        *,
        events: list[object],
        turn_id: str | None,
        thread_id: str | None,
        status: str | None,
        artifacts_for_result: list[dict[str, object] | None],
    ) -> None:
        self.codex_events = events[-200:]
        self.codex_turn_id = turn_id
        self.codex_thread_id = thread_id
        self.codex_status = status
        self.artifacts.extend(artifact for artifact in artifacts_for_result if artifact)

    def has_persistable_content(self) -> bool:
        return bool(self.user_text or self.assistant_text or self.artifacts)

    def audio_data_url(self) -> str | None:
        if self.streamed_audio:
            return ""
        return _pcm_to_wav_data_url(self.audio_chunks)

    def usage_estimate(self) -> dict[str, object]:
        input_text_chars = len(self.user_text)
        output_text_chars = len(self.assistant_text)
        output_audio_bytes = sum(len(chunk) for chunk in self.audio_chunks)
        estimated_input_tokens = round(input_text_chars / 4.2)
        estimated_output_tokens = round(output_text_chars / 4.2)
        # Gemini Live pricing depends on model and modality. Without provider
        # usage metadata in Live events, expose a transparent local estimate.
        estimated_cost_usd = round(
            (estimated_input_tokens * 0.10 / 1_000_000)
            + (estimated_output_tokens * 0.40 / 1_000_000),
            6,
        )
        return {
            "estimated": True,
            "input_text_chars": input_text_chars,
            "output_text_chars": output_text_chars,
            "input_audio_bytes": self.input_audio_bytes,
            "output_audio_bytes": output_audio_bytes,
            "estimated_input_tokens": estimated_input_tokens,
            "estimated_output_tokens": estimated_output_tokens,
            "estimated_total_tokens": estimated_input_tokens + estimated_output_tokens,
            "estimated_cost_usd": estimated_cost_usd,
        }

    def persist(
        self,
        *,
        history_store: HistoryStore,
        workdir: str,
        project_id: str | None,
        chat_id: str | None,
        fallback_assistant_text: str = "",
    ) -> None:
        if self.user_text:
            history_store.append(
                "user",
                self.user_text,
                {"workdir": workdir, "project_id": project_id, "chat_id": chat_id},
            )
        history_store.append(
            "assistant",
            self.assistant_text or fallback_assistant_text,
            {
                "workdir": workdir,
                "project_id": project_id,
                "chat_id": chat_id,
                "codex_events": self.codex_events,
                "codex_turn_id": self.codex_turn_id,
                "codex_thread_id": self.codex_thread_id,
                "codex_status": self.codex_status,
                "artifacts": self.artifacts,
                "gemini_live_usage": self.usage_estimate(),
            },
        )

    def reset(self) -> None:
        self.audio_chunks.clear()
        self.input_audio_bytes = 0
        self.input_text_chunks.clear()
        self.output_text_chunks.clear()
        self.streamed_audio = False
        self.codex_events = []
        self.codex_turn_id = None
        self.codex_thread_id = None
        self.codex_status = None
        self.artifacts = []
        self.handoff_ids = []


settings = get_settings()
history = HistoryStore(settings.history_path)
artifacts = ArtifactStore(settings.history_path)
projects = ProjectStore(settings.history_path.with_name("projects.json"), db_path=settings.history_path)
chats = ChatStore(settings.history_path.with_name("chats.json"), db_path=settings.history_path)
console = ConsoleStore(settings.history_path.with_name("console.json"), db_path=settings.history_path)
app_log = JsonlEventLogger(settings.history_path.with_name("app_events.jsonl"))
model_context_log = JsonlEventLogger(settings.history_path.with_name("model_context_packets.jsonl"))
codex_handoffs = CodexHandoffStore(settings.history_path)
_live_resumption_handles: dict[str, str] = {}
_live_completion_subscribers: dict[str, set[asyncio.Queue[_LiveCompletion]]] = {}
def _artifact_summary(text: object, limit: int = 220) -> str:
    return artifact_summary(text, limit)


def _artifact_content_type(text: object) -> str:
    return artifact_content_type(text)


def _create_tool_artifact(
    *,
    chat_id: str | None,
    message_id: str | None,
    title: str,
    content: object,
    source: str,
    workdir: str | None,
) -> dict[str, object] | None:
    return create_tool_artifact(
        artifacts=artifacts,
        app_log=app_log,
        chat_id=chat_id,
        message_id=message_id,
        title=title,
        content=content,
        source=source,
        workdir=workdir,
    )


def _create_tool_artifact_for_job(
    chat_id: str | None,
    message_id: str | None,
    title: str,
    content: object,
    source: str,
    workdir: str | None,
) -> dict[str, object] | None:
    return _create_tool_artifact(
        chat_id=chat_id,
        message_id=message_id,
        title=title,
        content=content,
        source=source,
        workdir=workdir,
    )


def _event_item_type(event: object) -> str:
    return event_item_type(event)


def _has_file_changes(events: list[object]) -> bool:
    return has_file_changes(events)


def _git_output(root: Path, args: list[str]) -> str:
    return git_output(root, args)


def _changed_files_from_status(status_text: str) -> list[str]:
    return changed_files_from_status(status_text)


def _create_change_review_artifact(
    *,
    chat_id: str | None,
    workdir: str | None,
    codex_events: list[object],
) -> dict[str, object] | None:
    return create_change_review_artifact(
        artifacts=artifacts,
        app_log=app_log,
        chat_id=chat_id,
        workdir=workdir,
        codex_events=codex_events,
    )


def _create_change_review_artifact_for_job(
    chat_id: str | None,
    workdir: str | None,
    codex_events: list[object],
) -> dict[str, object] | None:
    return _create_change_review_artifact(
        chat_id=chat_id,
        workdir=workdir,
        codex_events=codex_events,
    )


def _artifact_id(item: dict[str, object] | None) -> str | None:
    if not item:
        return None
    value = item.get("id")
    return str(value) if value else None


def _persist_live_codex_handoff(
    *,
    chat_id: str | None,
    project_id: str | None,
    workdir: str | None,
    user_text: str,
    tool_name: str | None,
    result: _LiveCodexResult,
    artifact: dict[str, object] | None,
    change_artifact: dict[str, object] | None,
) -> dict[str, Any]:
    artifact_ids = [
        artifact_id
        for artifact_id in (_artifact_id(artifact), _artifact_id(change_artifact))
        if artifact_id
    ]
    return codex_handoffs.create(
        chat_id=chat_id,
        project_id=project_id,
        workdir=workdir,
        user_text=user_text,
        tool_name=str(tool_name or "run_codex_task"),
        codex_status=result.status,
        result_summary=_artifact_summary(result.response, limit=500),
        result_artifact_id=_artifact_id(artifact),
        codex_turn_id=result.turn_id,
        codex_thread_id=result.thread_id,
        artifact_ids=artifact_ids,
    )


def _persist_background_codex_handoff(job: CodexBackgroundJob) -> dict[str, object] | None:
    result_artifact = job.artifacts[0] if job.artifacts else None
    change_artifact = job.artifacts[1] if len(job.artifacts) > 1 else None
    result = _LiveCodexResult(
        response=job.result,
        workdir=job.workdir,
        events=list(job.codex_events),
        turn_id=job.codex_turn_id,
        thread_id=job.codex_thread_id,
        status=job.codex_status or job.status,
        job_id=job.id,
        background_status=job.status,
    )
    handoff = _persist_live_codex_handoff(
        chat_id=job.chat_id,
        project_id=job.project_id,
        workdir=job.workdir,
        user_text=job.task,
        tool_name="run_codex_task",
        result=result,
        artifact=result_artifact,
        change_artifact=change_artifact,
    )
    app_log.write(
        "codex.handoff_persisted",
        chat_id=job.chat_id,
        handoff_id=handoff.get("id"),
        delivery_state=handoff.get("delivery_state"),
        artifact_id=handoff.get("result_artifact_id"),
        codex_status=result.status,
        background_job_id=job.id,
    )
    if handoff.get("id"):
        codex_handoffs.mark_delivery(str(handoff["id"]), "background_completion_pending", acknowledged=False)
        handoff = codex_handoffs.get(str(handoff["id"])) or handoff
        for queue in _live_completion_subscribers.get(job.chat_id or "", set()):
            queue.put_nowait({"handoff": handoff, "result": job.result, "artifacts": job.artifacts})
    return handoff


def _acknowledge_background_completion(chat_id: str | None, handoff_id: str) -> bool:
    if not chat_id or not handoff_id:
        return False
    handoff = codex_handoffs.get(handoff_id)
    if handoff is None or handoff.get("chat_id") != chat_id:
        return False
    codex_handoffs.mark_delivery(
        handoff_id, "background_completion_received", acknowledged=False
    )
    return True


def _revert_changed_files(workdir: str, files: list[str]) -> _RevertResult:
    return revert_changed_files(workdir, files)


def _commit_changed_files(workdir: str, files: list[str], message: str) -> _CommitResult:
    return commit_changed_files(workdir, files, message)


_background_jobs = BackgroundJobService(
    settings=settings,
    history=history,
    app_log=app_log,
    create_tool_artifact=_create_tool_artifact_for_job,
    create_change_review_artifact=_create_change_review_artifact_for_job,
    run_codex_stream=run_codex_stream_with_timer,
    create_handoff=_persist_background_codex_handoff,
)

# Backward-compatible names for focused tests and route handlers.
_CodexBackgroundJob = CodexBackgroundJob
_codex_jobs = _background_jobs.jobs


def _sync_background_job_dependencies() -> None:
    _background_jobs.configure(
        history=history,
        app_log=app_log,
        run_codex_stream=run_codex_stream_with_timer,
        create_handoff=_persist_background_codex_handoff,
    )


async def _store_job(job: _CodexBackgroundJob) -> None:
    _sync_background_job_dependencies()
    await _background_jobs.store(job)


async def _get_job(job_id: str) -> _CodexBackgroundJob | None:
    _sync_background_job_dependencies()
    return await _background_jobs.get(job_id)


async def _list_jobs(chat_id: str | None = None) -> list[dict[str, object]]:
    _sync_background_job_dependencies()
    return await _background_jobs.list(chat_id)


async def _run_codex_background_job(job_id: str) -> None:
    _sync_background_job_dependencies()
    await _background_jobs.run(job_id)


async def _enqueue_codex_background_job(
    *,
    task: str,
    enhanced_task: str,
    workdir: str,
    project_id: str | None,
    chat_id: str | None,
    source: str = "direct",
) -> _CodexBackgroundJob:
    job = _CodexBackgroundJob(
        id=str(uuid.uuid4()),
        task=task,
        enhanced_task=enhanced_task,
        workdir=workdir,
        project_id=project_id,
        chat_id=chat_id,
    )
    await _store_job(job)
    history.append(
        "user",
        task,
        {
            "direct_codex": True,
            "background_job_id": job.id,
            "workdir": workdir,
            "project_id": project_id,
            "chat_id": chat_id,
        },
    )
    asyncio.create_task(_run_codex_background_job(job.id))
    app_log.write(
        "codex_job.queued",
        job_id=job.id,
        chat_id=chat_id,
        project_id=project_id,
        workdir=workdir,
        task_chars=len(task),
        source=source,
    )
    return job


@asynccontextmanager
async def lifespan(app: FastAPI):
    tracing.setup_tracing()
    try:
        yield
    finally:
        await close_codex_thread_sessions()
        tracing.shutdown()


app = FastAPI(title="Codex Voice Agent", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173", "http://0.0.0.0:5173"],
    allow_origin_regex=r"https?://(127\.0\.0\.1|localhost|0\.0\.0\.0|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


_LOCAL_CLIENTS = {"127.0.0.1", "::1", "localhost"}


def _token_matches(value: str | None) -> bool:
    expected = (settings.api_token or "").strip()
    return bool(expected and value and value.strip() == expected)


def _bearer_token(value: str | None) -> str | None:
    if not value:
        return None
    scheme, _, token = value.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token.strip()


def _client_host(value: object) -> str:
    return str(value or "").split("%", 1)[0]


def _is_local_host(host: str) -> bool:
    return host in _LOCAL_CLIENTS


def _has_history_filter(project_id: str | None, workdir: str | None, chat_id: str | None) -> bool:
    return any(value is not None and value.strip() for value in (project_id, workdir, chat_id))


def _project_root(project_id: str | None) -> Path | None:
    if not project_id:
        return None
    project = next((item for item in projects.list() if item.get("id") == project_id), None)
    if not project:
        return None
    try:
        return resolve_workdir(str(project.get("path") or ""))
    except Exception:
        return None


def _resolve_scoped_workdir(
    requested_workdir: str | None,
    *,
    project_id: str | None = None,
    fallback_workdir: str | None = None,
) -> str:
    raw_workdir = requested_workdir or fallback_workdir or settings.codex_default_workdir
    resolved = resolve_workdir(raw_workdir)
    root = _project_root(project_id)
    if root is None:
        return str(resolved)
    if resolved != root and root not in resolved.parents:
        raise HTTPException(status_code=400, detail="Workdir must be inside the selected project")
    return str(resolved)


app.include_router(
    create_change_review_router(
        revert_changed_files=_revert_changed_files,
        commit_changed_files=_commit_changed_files,
        write_log=app_log.write,
    )
)
app.include_router(
    create_codex_jobs_router(
        resolve_workdir=lambda workdir, project_id: _resolve_scoped_workdir(
            workdir, project_id=project_id
        ),
        enqueue_job=_enqueue_codex_background_job,
        get_job=_get_job,
        list_jobs=_list_jobs,
    )
)


def _live_client_config_from_payload(
    payload: dict[str, Any],
    *,
    current_project_id: str | None,
    current_chat_id: str | None,
    current_workdir: str,
) -> _LiveClientConfig:
    project_id = str(payload.get("project_id") or "").strip() or current_project_id
    chat_id = str(payload.get("chat_id") or "").strip() or current_chat_id
    workdir = _resolve_scoped_workdir(
        str(payload.get("workdir") or "").strip() or None,
        project_id=project_id,
        fallback_workdir=current_workdir,
    )
    return {
        "project_id": project_id,
        "chat_id": chat_id,
        "workdir": workdir,
        "conversation_context": _chat_context(chat_id, workdir),
    }


def _live_tool_call_request(
    *,
    name: str | None,
    args: dict[str, Any],
    user_text: str,
    project_id: str | None,
    fallback_workdir: str,
) -> _LiveToolCallRequest:
    call_name = str(name or "")
    if call_name in {"end_conversation", "get_codex_status"}:
        return _LiveToolCallRequest(
            name=call_name,
            is_end_conversation=call_name == "end_conversation",
            task="",
            enhanced_task="",
            workdir=fallback_workdir,
        )

    task = str(args.get("task") or user_text or "Run the requested local task.")
    workdir = _resolve_scoped_workdir(
        str(args.get("workdir") or "").strip() or None,
        project_id=project_id,
        fallback_workdir=fallback_workdir,
    )
    return _LiveToolCallRequest(
        name=call_name,
        is_end_conversation=False,
        task=task,
        enhanced_task=improve_codex_task_prompt(task),
        workdir=workdir,
    )


def _codex_status_for_chat(chat_id: str | None) -> str:
    if not chat_id:
        return "No chat is selected, so I cannot find a Codex background job."
    jobs = [job for job in list(_codex_jobs.values()) if job.chat_id == chat_id]
    if not jobs:
        return "Codex is not currently running a background task in this chat."
    jobs.sort(key=lambda item: item.updated_at, reverse=True)
    job = jobs[0]
    if job.status == "done":
        result = str(job.result).strip() if job.result else "Codex finished."
        return (
            "Codex finished the latest task. Use this exact completed Codex result when the "
            f"user asks what Codex found or asks you to read/summarize it:\n{result}"
        )
    if job.status == "failed":
        return f"Codex failed the latest task. {job.error or 'No error details were recorded.'}"
    progress = job.latest_status or "Codex is still working."
    return f"Codex is still running. Latest progress: {progress}"


def _background_result_speech_prompt(text: str) -> str:
    return (
        "A background Codex task finished while the voice session remained open. "
        "Read the following result aloud clearly and with useful detail. Do not say only "
        "that it is done. If the result is long, speak a concise but complete version "
        "that preserves the important list items, decisions, and outcomes.\n\n"
        f"Codex result:\n{text}"
    )


def _compact_spoken_text(text: object) -> str:
    return " ".join(str(text or "").split())


async def _run_live_codex_tool(
    *,
    request: _LiveToolCallRequest,
    settings_value: Any,
    cancel_token: CancellationToken,
    chat_id: str | None,
    call_name: str | None,
    send_json: Any,
    live_log: LiveSessionLogger,
    turn_gen: Any,
) -> _LiveCodexResult:
    final_response = ""
    resolved_workdir = request.workdir
    codex_events: list[object] = []
    codex_turn_id = None
    codex_thread_id = None
    codex_status = None

    with tracing.tool_call(
        call_name or "",
        parent=turn_gen,
        input={"task": request.enhanced_task, "workdir": request.workdir},
    ) as tool_obs:
        async for event in run_codex_stream_with_timer(
            request.enhanced_task,
            request.workdir,
            settings_value,
            cancel_token,
            chat_id,
        ):
            if event.get("type") == "codex_event":
                codex_events.append(event)
                codex_turn_id = event.get("turn_id") or codex_turn_id
                codex_thread_id = event.get("thread_id") or codex_thread_id
                await send_json(
                    {
                        "type": "codex_event",
                        "event": event,
                    }
                )
            elif event.get("type") == "delta":
                text_delta = event.get("text", "")
                final_response += text_delta
                await send_json(
                    {
                        "type": "tool_progress",
                        "name": call_name,
                        "text": text_delta,
                    }
                )
            elif event.get("type") == "status":
                await send_json(
                    {
                        "type": "status",
                        "message": event.get("message"),
                        "elapsed": event.get("elapsed"),
                    }
                )
            elif event.get("type") == "done":
                final_response = event.get("text", final_response)
                resolved_workdir = event.get("workdir", request.workdir)
                codex_events = list(event.get("events") or codex_events)
                codex_turn_id = event.get("turn_id") or codex_turn_id
                codex_thread_id = event.get("thread_id") or codex_thread_id
                codex_status = event.get("status") or codex_status
                live_log.write(
                    "codex.done",
                    chat_id=chat_id,
                    status=codex_status,
                    turn_id=codex_turn_id,
                    thread_id=codex_thread_id,
                    result_chars=len(str(final_response or "")),
                    result_preview=clip_text(final_response),
                    event_count=len(codex_events),
                )
            elif event.get("type") == "error":
                final_response = f"Error: {event.get('message')}"
                live_log.write(
                    "codex.error",
                    chat_id=chat_id,
                    message=clip_text(event.get("message")),
                )
                await send_json(
                    {
                        "type": "tool_call_failed",
                        "name": call_name,
                        "message": event.get("message"),
                    }
                )
        tracing.update_observation(
            tool_obs,
            output=final_response,
            metadata={"workdir": resolved_workdir, "status": codex_status},
        )

    return _LiveCodexResult(
        response=final_response,
        workdir=resolved_workdir,
        events=codex_events,
        turn_id=codex_turn_id,
        thread_id=codex_thread_id,
        status=codex_status,
    )


async def _start_live_codex_background_job(
    *,
    request: _LiveToolCallRequest,
    project_id: str | None,
    chat_id: str | None,
    call_name: str | None,
    send_json: Any,
    live_log: LiveSessionLogger,
) -> _LiveCodexResult:
    job = await _enqueue_codex_background_job(
        task=request.task,
        enhanced_task=request.enhanced_task,
        workdir=request.workdir,
        project_id=project_id,
        chat_id=chat_id,
        source="voice",
    )
    message = (
        "Codex is running this task in the background. "
        "You can ask for status at any time, and the final result will appear in this chat when it finishes."
    )
    live_log.write(
        "codex.background_started",
        chat_id=chat_id,
        job_id=job.id,
        workdir=job.workdir,
        task=clip_text(job.task),
    )
    await send_json(
        {
            "type": "tool_result",
            "name": call_name,
            "result": message,
            "workdir": job.workdir,
            "artifact": None,
            "change_artifact": None,
            "changed_files": [],
            "codex_events": [],
            "codex_turn_id": None,
            "codex_thread_id": None,
            "codex_status": "running",
            "background_job_id": job.id,
            "background_job_status": job.status,
        }
    )
    return _LiveCodexResult(
        response=message,
        workdir=job.workdir,
        events=[],
        turn_id=None,
        thread_id=None,
        status="running",
        job_id=job.id,
        background_status=job.status,
    )


def _doctor_check(name: str, ok: bool, message: str, fix: str = "") -> dict[str, object]:
    return {"name": name, "ok": ok, "message": message, "fix": fix}


def _codex_doctor_auth_check() -> dict[str, object]:
    if shutil.which("codex") is None:
        return _doctor_check(
            "Codex login",
            False,
            "Codex CLI is missing",
            "Install Codex CLI and run codex login.",
        )
    try:
        proc = subprocess.run(
            ["codex", "doctor", "--json"],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
    except Exception as exc:
        return _doctor_check(
            "Codex login",
            False,
            "Unable to run codex doctor",
            f"Run codex doctor locally. Error: {exc}",
        )
    if proc.returncode != 0:
        return _doctor_check(
            "Codex login",
            False,
            "Codex doctor reported a problem",
            "Run codex doctor locally and follow its auth remediation.",
        )
    try:
        report = json.loads(proc.stdout)
    except Exception:
        return _doctor_check(
            "Codex login",
            False,
            "Codex doctor returned an unreadable report",
            "Run codex doctor locally and check the auth section.",
        )
    auth = (report.get("checks") or {}).get("auth.credentials") or {}
    ok = auth.get("status") == "ok"
    return _doctor_check(
        "Codex login",
        ok,
        str(auth.get("summary") or ("Configured" if ok else "Not configured")),
        "" if ok else str(auth.get("remediation") or "Run codex login."),
    )


def _doctor_checks() -> list[dict[str, object]]:
    checks = [
        _doctor_check(
            "Google API key",
            bool(settings.google_api_key),
            "Configured" if settings.google_api_key else "Missing",
            "Set GOOGLE_API_KEY in the backend environment.",
        ),
        _doctor_check(
            "API token",
            bool(settings.api_token),
            "Remote access is protected"
            if settings.api_token
            else "Localhost-only fallback is active",
            "Set CODEX_API_TOKEN on the backend and VITE_API_TOKEN in the frontend before using LAN/mobile access.",
        ),
        _doctor_check(
            "Git",
            shutil.which("git") is not None,
            "Available" if shutil.which("git") else "Missing",
            "Install git so project status, diffs, and change review work correctly.",
        ),
        _codex_doctor_auth_check(),
        _doctor_check(
            "Default work folder",
            Path(settings.codex_default_workdir).expanduser().exists(),
            settings.codex_default_workdir,
            "Set CODEX_DEFAULT_WORKDIR to an existing folder.",
        ),
    ]
    try:
        __import__("openai_codex")
        codex_ok = True
    except Exception:
        codex_ok = False
    checks.append(
        _doctor_check(
            "Codex SDK",
            codex_ok,
            "Available" if codex_ok else "Missing",
            "Install backend dependencies with uv sync.",
        )
    )
    return checks


def _is_false_tool_claim(assistant_text: str, used_codex: bool) -> bool:
    if used_codex:
        return False
    value = assistant_text.lower()
    return any(
        keyword in value
        for keyword in (
            "run_codex",
            "calling the tool",
            "calling codex",
            "pulling those",
            "i'm pulling",
            "i'll pull",
            "running the tool",
            "running codex",
            "i'll get that",
            "let me get",
            "i'll fetch",
            "i'll check",
            "let me check",
        )
    )


@app.middleware("http")
async def require_api_auth(request: Request, call_next):
    if request.method == "OPTIONS" or request.url.path == "/api/health":
        return await call_next(request)
    token = _bearer_token(request.headers.get("authorization")) or request.headers.get(
        "x-api-token"
    )
    if _token_matches(token):
        return await call_next(request)
    if not settings.api_token and _is_local_host(
        _client_host(request.client.host if request.client else "")
    ):
        return await call_next(request)
    return JSONResponse(
        status_code=status.HTTP_401_UNAUTHORIZED,
        content={
            "detail": "Set CODEX_API_TOKEN on the backend and VITE_API_TOKEN in the frontend to allow remote access."
        },
    )


async def _authorize_live_websocket(websocket: WebSocket) -> bool:
    token = (
        websocket.query_params.get("api_token")
        or _bearer_token(websocket.headers.get("authorization"))
        or websocket.headers.get("x-api-token")
    )
    if _token_matches(token):
        return True
    if not settings.api_token and _is_local_host(
        _client_host(websocket.client.host if websocket.client else "")
    ):
        return True
    await websocket.close(code=1008)
    return False


def _chat_title(text: object) -> str:
    value = " ".join(str(text or "").split())
    if not value:
        return "New chat"
    return value if len(value) <= 44 else f"{value[:41]}..."


def _chat_created_at(value: object) -> int:
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            pass
        try:
            return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
        except ValueError:
            return 0
    return 0


def _is_gemini_disconnect_cleanup_exception(exc: Exception) -> bool:
    # google-genai 1.33 can raise this RuntimeError while unwinding the Live
    # async generator after a websocket disconnect. It is cleanup noise, not a
    # user-visible session failure.
    return isinstance(exc, RuntimeError) and "generator didn't stop after throw()" in str(exc)


def _project_briefing(workdir: str | None) -> str:
    if not workdir:
        return ""
    try:
        root = resolve_workdir(workdir)
    except Exception:
        return ""
    branch = _git_output(root, ["branch", "--show-current"])
    status_text = _git_output(root, ["status", "--short"])
    commits = _git_output(root, ["log", "--oneline", "-3"])
    parts = [f"Project briefing for {root}:"]
    if branch:
        parts.append(f"Current git branch: {branch}")
    parts.append("Working tree status:")
    parts.append(status_text or "clean")
    if commits:
        parts.append("Recent commits:")
        parts.append(commits)
    return "\n".join(parts)


def _chat_context(chat_id: str | None, workdir: str | None = None) -> str:
    parts = [_project_briefing(workdir)]
    if chat_id:
        parts.append(build_recent_conversation_context(history.list(chat_id=chat_id)))
        jobs = [
            job
            for job in list(_codex_jobs.values())
            if job.chat_id == chat_id and job.status in {"queued", "running", "done", "failed"}
        ]
        jobs.sort(key=lambda item: item.updated_at, reverse=True)
        if jobs:
            lines = ["Current and recent Codex background jobs for this chat:"]
            for job in jobs[:5]:
                if job.status in {"done", "failed"} and job.result:
                    detail = _artifact_summary(job.result, limit=4000)
                else:
                    detail = job.latest_status or "No progress update yet."
                lines.extend(
                    [
                        "- Job id: " + job.id,
                        "  User request: " + job.task,
                        "  Status: " + job.status,
                        "  Completed result: " + detail,
                    ]
                )
            lines.append(
                "If the user asks for Codex status, progress, or the previous Codex output, answer from these job records instead of guessing."
            )
            parts.append("\n".join(lines))
    recent_artifacts = artifacts.list(chat_id=chat_id)[-5:] if chat_id else []
    if recent_artifacts:
        lines = ["Recent visible artifacts in this chat:"]
        for item in recent_artifacts:
            lines.append(
                "- "
                f"id={item.get('id')} "
                f"title={item.get('title')} "
                f"source={item.get('source')} "
                f"summary={item.get('summary')}"
            )
        lines.append(
            "If a follow-up asks about one of these generated outputs, answer from the artifact reference instead of calling Codex again unless fresh local state is required."
        )
        parts.append("\n".join(lines))
    pending_handoffs = codex_handoffs.pending_for_chat(chat_id) if chat_id else []
    if pending_handoffs:
        lines = ["Important recent Codex handoffs Gemini has not yet summarized:"]
        for item in pending_handoffs:
            artifact_ref = item.get("result_artifact_id") or ", ".join(
                str(value) for value in item.get("artifact_ids", []) if value
            )
            lines.extend(
                [
                    "- Previous user request: " + str(item.get("user_text") or "(not captured)"),
                    "  Codex status: " + str(item.get("codex_status") or "completed"),
                    "  Gemini delivery state: " + str(item.get("delivery_state") or "unknown"),
                    "  Artifact reference: " + str(artifact_ref or "not available"),
                    "  Summary: " + str(item.get("result_summary") or "Codex completed."),
                    "  If the user asks for an update, answer from this completed Codex result instead of saying no work was done.",
                ]
            )
        parts.append("\n".join(lines))
    return "\n\n".join(part for part in parts if part.strip())


def _latest_artifact_replay(chat_id: str | None, user_text: str) -> str | None:
    if not chat_id:
        return None
    normalized = " ".join(user_text.lower().split())
    replay_phrases = (
        "you already have it",
        "give me the full summary",
        "full summary",
        "repeat that",
        "show me that result",
        "show that result",
        "what was the result",
    )
    if not any(phrase in normalized for phrase in replay_phrases):
        return None
    pending = codex_handoffs.pending_for_chat(chat_id)
    artifact_id = None
    if pending:
        latest = pending[0]
        artifact_id = latest.get("result_artifact_id")
    rows = artifacts.list(chat_id=chat_id)
    if artifact_id:
        for row in reversed(rows):
            if row.get("id") == artifact_id:
                return str(row.get("content") or "")
    for row in reversed(rows):
        source = str(row.get("source") or "")
        if source in {"background_codex", "run_codex_task"}:
            return str(row.get("content") or "")
    return None


def _write_model_context_packet(
    *,
    surface: str,
    chat_id: str | None,
    project_id: str | None,
    workdir: str | None,
    model: str,
    user_text: str | None,
    conversation_context: str,
    extra: dict[str, object] | None = None,
) -> None:
    recent_artifacts = artifacts.list(chat_id=chat_id)[-5:] if chat_id else []
    pending_handoffs = codex_handoffs.pending_for_chat(chat_id) if chat_id else []
    model_context_log.write(
        "model_context.packet",
        surface=surface,
        chat_id=chat_id,
        project_id=project_id,
        workdir=workdir,
        model=model,
        user_text=clip_text(user_text or "", limit=1000),
        context_chars=len(conversation_context),
        context_preview=clip_text(conversation_context, limit=4000),
        recent_artifact_ids=[item.get("id") for item in recent_artifacts],
        pending_handoff_ids=[item.get("id") for item in pending_handoffs],
        **(extra or {}),
    )


def _function_response(
    *,
    call_id: str | None,
    name: str | None,
    response: dict[str, object],
) -> types.FunctionResponse:
    return types.FunctionResponse(
        id=call_id,
        name=name,
        response=response,
    )


def _markdown_title(value: object) -> str:
    title = " ".join(str(value or "").split())
    return title or "Chat export"


def _markdown_filename(value: object) -> str:
    title = _markdown_title(value).lower()
    title = re.sub(r"[^a-z0-9._-]+", "-", title).strip(".-")
    return f"{title or 'chat-export'}.md"


def _chat_export_markdown(
    *,
    chat: dict[str, object] | None,
    rows: list[dict[str, object]],
    artifact_rows: list[dict[str, object]],
) -> str:
    title = _markdown_title(chat.get("title") if chat else None)
    lines = [f"# {title}", ""]
    if chat:
        lines.extend(
            [
                f"- Chat ID: `{chat.get('id')}`",
                f"- Project ID: `{chat.get('projectId')}`",
                "",
            ]
        )

    if rows:
        lines.append("## Conversation")
        lines.append("")
        for row in rows:
            role = str(row.get("role") or "message").strip().title()
            text = str(row.get("text") or "").strip() or "_No text recorded._"
            lines.extend([f"### {role}", "", text, ""])

            raw_meta = row.get("meta")
            meta: dict[str, Any] = raw_meta if isinstance(raw_meta, dict) else {}
            for artifact in list(meta.get("artifacts") or []):
                if not isinstance(artifact, dict):
                    continue
                artifact_title = _markdown_title(artifact.get("title"))
                artifact_summary = str(artifact.get("summary") or "").strip()
                lines.append(f"- Artifact: **{artifact_title}**")
                if artifact_summary:
                    lines.append(f"  - {artifact_summary}")
                lines.append("")
    else:
        lines.extend(["## Conversation", "", "_No messages recorded._", ""])

    if artifact_rows:
        lines.extend(["## Artifacts", ""])
        for artifact in artifact_rows:
            artifact_title = _markdown_title(artifact.get("title"))
            content_type = str(artifact.get("content_type") or "text")
            summary = str(artifact.get("summary") or "").strip()
            content = str(artifact.get("content") or "").strip()
            lines.extend([f"### {artifact_title}", ""])
            if summary:
                lines.extend([summary, ""])
            if content:
                fence = "diff" if content_type == "diff" else ""
                lines.extend([f"```{fence}", content, "```", ""])

    return "\n".join(lines).rstrip() + "\n"


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


_FILE_BROWSER_IGNORED_DIRECTORIES = {
    ".git",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "__pycache__",
    "build",
    "dist",
    "node_modules",
}
_FILE_BROWSER_MAX_BYTES = 512 * 1024


def _is_file_browser_hidden(relative_path: Path) -> bool:
    return any(part in _FILE_BROWSER_IGNORED_DIRECTORIES for part in relative_path.parts) or any(
        part == ".DS_Store" or part == ".env" or part.startswith(".env.")
        for part in relative_path.parts
    )


def _file_browser_root(project_id: str) -> Path:
    root = _project_root(project_id)
    if root is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return root


def _file_browser_path(root: Path, relative_path: str) -> Path:
    requested = Path(relative_path)
    if not relative_path or requested.is_absolute() or ".." in requested.parts:
        raise HTTPException(status_code=400, detail="Invalid file path")
    candidate = (root / requested).resolve()
    if not candidate.is_relative_to(root):
        raise HTTPException(status_code=400, detail="File must be inside the selected project")
    return candidate


class ConsoleStateRequest(BaseModel):
    actions: list[dict[str, object]] = []
    handoffs: list[dict[str, object]] = []
    debugEntries: list[dict[str, object]] = []


@app.get("/api/health")
async def health() -> dict[str, object]:
    return {
        "ok": True,
        "gemini_model": settings.gemini_model,
        "gemini_text_model": settings.gemini_text_model,
        "gemini_voice_name": settings.gemini_voice_name,
        "has_google_api_key": bool(settings.google_api_key),
        "codex_default_workdir": settings.codex_default_workdir,
    }


@app.get("/api/doctor")
async def doctor() -> dict[str, object]:
    checks = _doctor_checks()
    return {"ok": all(bool(check["ok"]) for check in checks), "checks": checks}


@app.get("/api/history")
async def list_history(
    project_id: str | None = None, workdir: str | None = None, chat_id: str | None = None
) -> list[dict[str, object]]:
    if not _has_history_filter(project_id, workdir, chat_id):
        raise HTTPException(status_code=400, detail="Provide project_id, workdir, or chat_id")
    return history.list(project_id=project_id, workdir=workdir, chat_id=chat_id)


@app.delete("/api/history")
async def clear_history(
    project_id: str | None = None, workdir: str | None = None, chat_id: str | None = None
) -> dict[str, object]:
    if project_id is not None:
        chat_ids = [
            str(chat.get("id")) for chat in chats.list(project_id=project_id) if chat.get("id")
        ]
        await close_codex_thread_sessions_for(chat_ids)
        for cid in chat_ids:
            artifacts.clear(cid)
            codex_handoffs.clear(cid)
    elif chat_id is not None:
        await close_codex_thread_session(chat_id)
    history.clear(project_id=project_id, workdir=workdir, chat_id=chat_id)
    if chat_id is not None:
        artifacts.clear(chat_id)
        codex_handoffs.clear(chat_id)
    return {"ok": True}


@app.get("/api/search")
async def search_content(q: str, limit: int = 20) -> list[dict[str, object]]:
    query = " ".join(q.split())
    if len(query) < 2:
        return []
    safe_limit = max(1, min(limit, 50))
    results = history.search(query, limit=safe_limit) + artifacts.search(query, limit=safe_limit)
    results.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return results[:safe_limit]


@app.get("/api/projects")
async def list_projects() -> list[dict[str, object]]:
    return projects.list()


@app.get("/api/projects/{project_id}/files")
async def list_project_files(project_id: str, path: str = "") -> dict[str, object]:
    """Return one directory level for the selected project's lazy file browser."""
    root = _file_browser_root(project_id)
    directory = root if not path else _file_browser_path(root, path)
    if not directory.exists() or not directory.is_dir():
        raise HTTPException(status_code=404, detail="Folder not found")
    entries: list[dict[str, object]] = []
    for child in sorted(directory.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower())):
        relative = child.relative_to(root)
        if _is_file_browser_hidden(relative):
            continue
        entries.append({"path": relative.as_posix(), "is_directory": child.is_dir()})
        if len(entries) >= 500:
            break
    return {"root": str(root), "entries": entries, "truncated": len(entries) >= 500}


@app.get("/api/projects/{project_id}/files/content")
async def read_project_file(project_id: str, path: str) -> dict[str, object]:
    root = _file_browser_root(project_id)
    file_path = _file_browser_path(root, path)
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    size = file_path.stat().st_size
    if size > _FILE_BROWSER_MAX_BYTES:
        raise HTTPException(status_code=413, detail="This file is too large to preview")
    try:
        content = file_path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=415, detail="Binary files cannot be previewed") from exc
    return {"path": path, "content": content, "size": size}


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
    try:
        return projects.upsert(project)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: str) -> dict[str, object]:
    chat_ids = [str(chat.get("id")) for chat in chats.list(project_id=project_id) if chat.get("id")]
    await close_codex_thread_sessions_for(chat_ids)
    projects.delete(project_id)
    chats.delete_for_project(project_id)
    history.clear(project_id=project_id)
    for chat_id in chat_ids:
        artifacts.clear(chat_id)
        codex_handoffs.clear(chat_id)
    console.clear_for_project(chat_ids)
    return {"ok": True}


@app.get("/api/chats")
async def list_chats(project_id: str | None = None) -> list[dict[str, object]]:
    stored = chats.list(project_id=project_id)
    by_id: dict[str, dict[str, Any]] = {
        str(chat.get("id")): dict(chat) for chat in stored if chat.get("id")
    }
    for summary in history.chat_summaries(project_id=project_id):
        chat_id = str(summary["chat_id"])
        if chat_id in by_id:
            continue
        recovered = {
            "id": chat_id,
            "projectId": str(summary["project_id"]),
            "title": _chat_title(summary.get("first_user_text")),
            "createdAt": _chat_created_at(summary.get("created_at")),
        }
        by_id[chat_id] = recovered
        chats.upsert(recovered)

    def chat_created_at(chat: dict[str, Any]) -> int:
        value = chat.get("createdAt")
        try:
            return int(value) if value is not None else 0
        except (TypeError, ValueError):
            return 0

    return sorted(by_id.values(), key=chat_created_at, reverse=True)


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


@app.get("/api/chats/{chat_id}/export.md")
async def export_chat_markdown(chat_id: str) -> Response:
    chat = next((item for item in chats.list() if item.get("id") == chat_id), None)
    rows = history.list(chat_id=chat_id)
    artifact_rows = artifacts.list(chat_id=chat_id)
    if chat is None and not rows and not artifact_rows:
        raise HTTPException(status_code=404, detail="Chat not found")

    markdown = _chat_export_markdown(chat=chat, rows=rows, artifact_rows=artifact_rows)
    filename = _markdown_filename(chat.get("title") if chat else chat_id)
    return Response(
        content=markdown,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.delete("/api/chats/{chat_id}")
async def delete_chat(chat_id: str) -> dict[str, object]:
    await close_codex_thread_session(chat_id)
    chats.delete(chat_id)
    history.clear(chat_id=chat_id)
    artifacts.clear(chat_id)
    codex_handoffs.clear(chat_id)
    console.clear(chat_id)
    return {"ok": True}


@app.get("/api/chats/{chat_id}/console")
async def get_console_state(chat_id: str) -> dict[str, object]:
    return console.get(chat_id)


@app.put("/api/chats/{chat_id}/console")
async def save_console_state(chat_id: str, req: ConsoleStateRequest) -> dict[str, object]:
    app_log.write(
        "console.save",
        chat_id=chat_id,
        action_count=len(req.actions),
        handoff_count=len(req.handoffs),
        debug_count=len(req.debugEntries),
        running_actions=sum(1 for action in req.actions if action.get("status") == "running"),
        failed_actions=sum(1 for action in req.actions if action.get("status") == "failed"),
    )
    return console.put(
        chat_id,
        {
            "actions": req.actions,
            "handoffs": req.handoffs,
            "debugEntries": req.debugEntries,
        },
    )


@app.delete("/api/chats/{chat_id}/console")
async def clear_console_state(chat_id: str) -> dict[str, object]:
    app_log.write("console.clear", chat_id=chat_id)
    console.clear(chat_id)
    return {"ok": True}


@app.post("/api/chat/stream")
async def chat_stream(req: ChatRequest) -> StreamingResponse:
    text = req.message.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message is required")
    workdir = _resolve_scoped_workdir(req.workdir, project_id=req.project_id)
    project_root = str(_project_root(req.project_id) or workdir)
    conversation_context = _chat_context(req.chat_id, workdir)
    artifact_replay = _latest_artifact_replay(req.chat_id, text)
    history.append(
        "user", text, {"workdir": workdir, "project_id": req.project_id, "chat_id": req.chat_id}
    )
    _write_model_context_packet(
        surface="chat",
        chat_id=req.chat_id,
        project_id=req.project_id,
        workdir=workdir,
        model=settings.gemini_text_model,
        user_text=text,
        conversation_context=conversation_context,
        extra={"direct_artifact_replay": bool(artifact_replay)},
    )
    app_log.write(
        "chat_stream.start",
        chat_id=req.chat_id,
        project_id=req.project_id,
        workdir=workdir,
        message_chars=len(text),
        context_chars=len(conversation_context),
    )

    cancel_token = CancellationToken()

    async def event_source():
        if artifact_replay is not None:
            history.append(
                "assistant",
                artifact_replay,
                {
                    "direct_artifact_replay": True,
                    "workdir": workdir,
                    "project_id": req.project_id,
                    "chat_id": req.chat_id,
                },
            )
            app_log.write(
                "chat_stream.artifact_replay",
                chat_id=req.chat_id,
                reply_chars=len(artifact_replay),
            )
            yield f"data: {json.dumps({'type': 'done', 'text': artifact_replay, 'workdir': workdir})}\n\n"
            return
        final_text = ""
        final_workdir = workdir
        final_tool_calls = []
        final_codex_events = []
        final_artifacts = []
        final_codex_turn_id = None
        final_codex_thread_id = None
        final_codex_status = None
        try:
            async for event in ask_gemini_stream(
                text,
                settings,
                workdir=workdir,
                cancel_token=cancel_token,
                conversation_id=req.chat_id,
                conversation_context=conversation_context,
                project_root=project_root,
            ):
                if event.get("type") == "done":
                    final_text = str(event.get("text") or "")
                    final_workdir = str(event.get("workdir") or workdir)
                    final_tool_calls = list(event.get("tool_calls") or [])
                    final_codex_events = list(event.get("codex_events") or [])
                    final_codex_turn_id = event.get("codex_turn_id")
                    final_codex_thread_id = event.get("codex_thread_id")
                    final_codex_status = event.get("codex_status")
                    app_log.write(
                        "chat_stream.done_event",
                        chat_id=req.chat_id,
                        reply_chars=len(final_text),
                        tool_call_count=len(final_tool_calls),
                        codex_status=final_codex_status,
                    )
                elif event.get("type") == "tool_call":
                    app_log.write(
                        "chat_stream.tool_call",
                        chat_id=req.chat_id,
                        name=event.get("name"),
                        task=clip_text(event.get("task")),
                        workdir=event.get("workdir"),
                    )
                elif event.get("type") == "tool_result":
                    result_events = list(event.get("codex_events") or [])
                    artifact = _create_tool_artifact(
                        chat_id=req.chat_id,
                        message_id=None,
                        title=f"{event.get('name') or 'Codex'} output",
                        content=event.get("result"),
                        source=str(event.get("name") or "run_codex_task"),
                        workdir=str(event.get("workdir") or workdir),
                    )
                    if artifact:
                        final_artifacts.append(artifact)
                        event["artifact"] = artifact
                    change_artifact = _create_change_review_artifact(
                        chat_id=req.chat_id,
                        workdir=str(event.get("workdir") or workdir),
                        codex_events=result_events,
                    )
                    if change_artifact:
                        final_artifacts.append(change_artifact)
                        event["change_artifact"] = change_artifact
                        event["changed_files"] = change_artifact.get("changed_files", [])
                    app_log.write(
                        "chat_stream.tool_result",
                        chat_id=req.chat_id,
                        name=event.get("name"),
                        result_chars=len(str(event.get("result") or "")),
                        codex_status=event.get("codex_status"),
                    )
                elif event.get("type") == "error":
                    app_log.write(
                        "chat_stream.error_event",
                        chat_id=req.chat_id,
                        message=clip_text(event.get("message")),
                    )
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as exc:
            app_log.write("chat_stream.exception", chat_id=req.chat_id, message=clip_text(exc))
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
        finally:
            cancel_token.cancel()
            app_log.write(
                "chat_stream.finally",
                chat_id=req.chat_id,
                final_text_chars=len(final_text),
                codex_status=final_codex_status,
                persisted=bool(final_text),
            )
            if final_text:
                history.append(
                    "assistant",
                    final_text,
                    {
                        "tool_calls": final_tool_calls,
                        "artifacts": final_artifacts,
                        "codex_events": final_codex_events,
                        "codex_turn_id": final_codex_turn_id,
                        "codex_thread_id": final_codex_thread_id,
                        "codex_status": final_codex_status,
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


@app.websocket("/api/live")
async def live_voice(websocket: WebSocket) -> None:
    if not await _authorize_live_websocket(websocket):
        return
    await websocket.accept()
    live_log = LiveSessionLogger(
        settings.history_path.with_name("live_sessions.jsonl"), str(uuid.uuid4())
    )
    live_log.write("websocket.accepted")
    if not settings.google_api_key:
        live_log.write("websocket.error", message="GOOGLE_API_KEY is not set")
        await websocket.send_json({"type": "error", "message": "GOOGLE_API_KEY is not set"})
        await websocket.close()
        return

    client = genai.Client(api_key=settings.google_api_key)
    turn_state = _LiveTurnState()
    session_workdir = settings.codex_default_workdir
    session_project_id: str | None = None
    session_chat_id: str | None = None
    session_conversation_context = ""
    current_task_cancel_token: CancellationToken | None = None
    active_turn_gen = None
    session_ended_by_tool = False
    completion_queue: asyncio.Queue[_LiveCompletion] = asyncio.Queue()

    async def deliver_completions() -> None:
        while True:
            item = await completion_queue.get()
            await websocket.send_json({"type": "background_job_completed", **item})

    async def send_client_audio(session: _LiveSession, initial: dict | None = None) -> None:
        nonlocal \
            session_workdir, \
            session_project_id, \
            session_chat_id, \
            session_conversation_context, \
            current_task_cancel_token
        pending = initial
        while True:
            payload = pending if pending is not None else await websocket.receive_json()
            pending = None
            event_type = payload.get("type")
            if event_type == "config":
                config = _live_client_config_from_payload(
                    payload,
                    current_project_id=session_project_id,
                    current_chat_id=session_chat_id,
                    current_workdir=session_workdir,
                )
                session_project_id = config["project_id"]
                session_chat_id = config["chat_id"]
                session_workdir = config["workdir"]
                session_conversation_context = config["conversation_context"]
                live_log.write(
                    "client.config",
                    chat_id=session_chat_id,
                    project_id=session_project_id,
                    workdir=session_workdir,
                    context_chars=len(session_conversation_context),
                )
                await websocket.send_json(
                    {"type": "debug", "message": f"Active workdir: {session_workdir}"}
                )
            elif event_type == "audio":
                audio_base64 = str(payload.get("data") or "")
                if not audio_base64:
                    continue
                audio_bytes = base64.b64decode(audio_base64)
                if len(audio_bytes) > settings.max_audio_bytes:
                    live_log.write(
                        "client.audio_rejected", chat_id=session_chat_id, bytes=len(audio_bytes)
                    )
                    await websocket.send_json(
                        {"type": "error", "message": "Audio frame is too large."}
                    )
                    continue
                turn_state.input_audio_bytes += len(audio_bytes)
                mime_type = str(payload.get("mime_type") or "audio/pcm;rate=16000")
                await session.send_realtime_input(
                    audio=types.Blob(data=audio_bytes, mime_type=mime_type)
                )
            elif event_type == "stop":
                live_log.write("client.audio_stop", chat_id=session_chat_id)
                await session.send_realtime_input(audio_stream_end=True)
                await websocket.send_json(
                    {"type": "debug", "message": "Sent audio stream end to Gemini."}
                )
            elif event_type == "speak_text":
                text = _compact_spoken_text(payload.get("text"))
                if not text:
                    continue
                live_log.write(
                    "client.speak_text",
                    chat_id=session_chat_id,
                    text_chars=len(text),
                    text_preview=clip_text(text),
                )
                await session.send_client_content(
                    turns=types.Content(
                        role="user",
                        parts=[
                            types.Part(text=_background_result_speech_prompt(text))
                        ],
                    ),
                    turn_complete=True,
                )
                await websocket.send_json(
                    {"type": "debug", "message": "Queued completed Codex result for speech."}
                )
            elif event_type == "background_completion_received":
                handoff_id = str(payload.get("handoff_id") or "")
                if _acknowledge_background_completion(session_chat_id, handoff_id):
                    live_log.write(
                        "client.background_completion_received",
                        chat_id=session_chat_id,
                        handoff_id=handoff_id,
                    )
                elif handoff_id:
                    live_log.write(
                        "client.background_completion_rejected",
                        chat_id=session_chat_id,
                        handoff_id=handoff_id,
                    )
            elif event_type == "cancel_task":
                if current_task_cancel_token:
                    current_task_cancel_token.cancel()
                    await interrupt_codex_thread_session(session_chat_id)
                    live_log.write("client.cancel_task", chat_id=session_chat_id)
                    await websocket.send_json({"type": "debug", "message": "Codex task cancelled."})
            elif event_type == "close":
                live_log.write("client.close", chat_id=session_chat_id)
                return

    async def receive_gemini(session: _LiveSession) -> None:
        nonlocal session_conversation_context, current_task_cancel_token
        nonlocal active_turn_gen, session_ended_by_tool

        # One Langfuse generation per voice turn. Created lazily when the turn
        # produces its first signal (user transcript or tool call) and closed at
        # turn_complete. Only transcribed text is recorded, never raw audio.
        turn_gen = None

        def ensure_turn_gen():
            nonlocal active_turn_gen, turn_gen
            if turn_gen is None:
                turn_gen = tracing.start_observation(
                    "generation", "gemini-voice-turn", model=settings.gemini_model
                )
                active_turn_gen = turn_gen
            return turn_gen

        while True:
            received_message = False
            async for server_message in session.receive():
                received_message = True
                if server_message.setup_complete:
                    live_log.write("gemini.setup_complete", chat_id=session_chat_id)
                    await websocket.send_json(
                        {"type": "ready", "message": "Gemini Live session ready."}
                    )
                if server_message.session_resumption_update:
                    update = server_message.session_resumption_update
                    handle = str(update.new_handle or "")
                    if session_chat_id and handle:
                        _live_resumption_handles[session_chat_id] = handle
                    live_log.write(
                        "gemini.session_resumption_update",
                        chat_id=session_chat_id,
                        resumable=update.resumable,
                        has_handle=bool(handle),
                        last_consumed_client_message_index=update.last_consumed_client_message_index,
                    )
                if server_message.go_away:
                    time_left = str(server_message.go_away.time_left)
                    live_log.write(
                        "gemini.go_away",
                        chat_id=session_chat_id,
                        time_left=time_left,
                    )
                    # Gemini gives us a short warning before it retires a Live
                    # connection. Let the browser rotate while the current turn
                    # is idle instead of waiting for the next microphone frame to
                    # discover that the connection has already expired.
                    await websocket.send_json(
                        {
                            "type": "session_refresh_requested",
                            "reason": "gemini_go_away",
                            "time_left": time_left,
                        }
                    )

                if server_message.tool_call and server_message.tool_call.function_calls:
                    responses = []
                    response_handoff_ids: list[str] = []
                    user_text = turn_state.user_text
                    ensure_turn_gen()
                    for call in server_message.tool_call.function_calls:
                        request = _live_tool_call_request(
                            name=call.name,
                            args=dict(call.args or {}),
                            user_text=user_text,
                            project_id=session_project_id,
                            fallback_workdir=session_workdir,
                        )
                        if request.is_end_conversation:
                            session_ended_by_tool = True
                            live_log.write("gemini.end_conversation_tool", chat_id=session_chat_id)
                            responses.append(
                                _function_response(
                                    call_id=call.id,
                                    name=call.name,
                                    response={"result": "Session ended successfully."},
                                )
                            )
                            continue
                        if request.name == "get_codex_status":
                            status_text = _codex_status_for_chat(session_chat_id)
                            live_log.write(
                                "gemini.codex_status_tool",
                                chat_id=session_chat_id,
                                result=clip_text(status_text),
                            )
                            responses.append(
                                _function_response(
                                    call_id=call.id,
                                    name=call.name,
                                    response={"result": status_text},
                                )
                            )
                            continue
                        live_log.write(
                            "gemini.tool_call_started",
                            chat_id=session_chat_id,
                            name=call.name,
                            task=clip_text(request.enhanced_task),
                            original_task=clip_text(request.task),
                            workdir=request.workdir,
                        )
                        await websocket.send_json(
                            {
                                "type": "tool_call_started",
                                "name": call.name,
                                "task": request.enhanced_task,
                                "original_task": request.task,
                                "workdir": request.workdir,
                            }
                        )

                        result = await _start_live_codex_background_job(
                            request=request,
                            project_id=session_project_id,
                            chat_id=session_chat_id,
                            call_name=call.name,
                            send_json=websocket.send_json,
                            live_log=live_log,
                        )
                        turn_state.add_codex_result(
                            events=result.events,
                            turn_id=result.turn_id,
                            thread_id=result.thread_id,
                            status=result.status,
                            artifacts_for_result=[],
                        )

                        responses.append(
                            _function_response(
                                call_id=call.id,
                                name=call.name,
                                response={
                                    "result": result.response,
                                    "workdir": result.workdir,
                                    "job_id": result.job_id,
                                    "status": result.background_status or result.status,
                                },
                            )
                        )
                        live_log.write(
                            "client.tool_result_sent",
                            chat_id=session_chat_id,
                            name=call.name,
                            result_chars=len(str(result.response or "")),
                            codex_status=result.status,
                        )
                    live_log.write(
                        "gemini.tool_response_send_start",
                        chat_id=session_chat_id,
                        response_count=len(responses),
                    )
                    try:
                        await session.send_tool_response(function_responses=responses)
                    except Exception as e:
                        for handoff_id in response_handoff_ids:
                            codex_handoffs.mark_delivery(
                                handoff_id,
                                "tool_response_failed_to_gemini",
                                acknowledged=False,
                            )
                        live_log.write(
                            "gemini.tool_response_send_error",
                            chat_id=session_chat_id,
                            error=str(e),
                            handoff_ids=response_handoff_ids,
                        )
                        await websocket.send_json(
                            {
                                "type": "tool_result_gemini_delivery_failed",
                                "message": (
                                    "Codex completed, but Gemini Live reconnected before reading "
                                    "the result. The next session will include the completed result."
                                ),
                                "handoff_ids": response_handoff_ids,
                            }
                        )
                        return
                    for handoff_id in response_handoff_ids:
                        codex_handoffs.mark_delivery(
                            handoff_id,
                            "tool_response_sent_to_gemini",
                            acknowledged=False,
                        )
                    live_log.write(
                        "gemini.tool_response_send_done",
                        chat_id=session_chat_id,
                        response_count=len(responses),
                    )
                    if session_ended_by_tool:
                        user_text = turn_state.user_text
                        assistant_text = turn_state.assistant_text or "Done."
                        if turn_gen:
                            tracing.end_observation(
                                turn_gen,
                                input={
                                    "user_message": user_text,
                                    "conversation_so_far": session_conversation_context
                                    or "(start of conversation)",
                                },
                                output=assistant_text,
                                metadata={
                                    "workdir": session_workdir,
                                    "project_id": session_project_id,
                                },
                            )
                            turn_gen = None
                            active_turn_gen = None
                        turn_state.persist(
                            history_store=history,
                            workdir=session_workdir,
                            project_id=session_project_id,
                            chat_id=session_chat_id,
                            fallback_assistant_text="Done.",
                        )
                        session_conversation_context = _chat_context(
                            session_chat_id, session_workdir
                        )
                        live_log.write(
                            "session.auto_disconnect",
                            chat_id=session_chat_id,
                            user_text=user_text,
                            assistant_text=assistant_text,
                        )
                        await websocket.send_json(
                            {
                                "type": "turn_complete",
                                "user_text": user_text,
                                "assistant_text": assistant_text,
                                "workdir": session_workdir,
                                "audio_data_url": turn_state.audio_data_url() or None,
                                "session_ended": True,
                            }
                        )
                        session_ended_by_tool = False
                        turn_state.reset()
                        return

                content = server_message.server_content
                if not content:
                    continue

                if content.interrupted:
                    live_log.write("gemini.interrupted", chat_id=session_chat_id)
                    if current_task_cancel_token:
                        current_task_cancel_token.cancel()
                        await interrupt_codex_thread_session(session_chat_id)
                    tracing.end_observation(
                        turn_gen,
                        output=turn_state.assistant_text or None,
                        level="WARNING",
                        status_message="interrupted",
                    )
                    turn_gen = None
                    active_turn_gen = None
                    turn_state.reset()
                    await websocket.send_json({"type": "interrupted"})

                if content.input_transcription and content.input_transcription.text:
                    text = content.input_transcription.text
                    turn_state.input_text_chunks.append(text)
                    ensure_turn_gen()
                    live_log.write(
                        "gemini.input_transcript", chat_id=session_chat_id, text=clip_text(text)
                    )
                    await websocket.send_json({"type": "user_transcript", "text": text})

                if content.output_transcription and content.output_transcription.text:
                    text = content.output_transcription.text
                    turn_state.output_text_chunks.append(text)
                    live_log.write(
                        "gemini.output_transcript", chat_id=session_chat_id, text=clip_text(text)
                    )
                    await websocket.send_json({"type": "assistant_delta", "text": text})

                if content.model_turn:
                    for part in content.model_turn.parts or []:
                        if part.inline_data and part.inline_data.data:
                            turn_state.audio_chunks.append(part.inline_data.data)
                            turn_state.streamed_audio = True
                            audio_b64 = base64.b64encode(part.inline_data.data).decode("ascii")
                            await websocket.send_json(
                                {
                                    "type": "assistant_audio_delta",
                                    "data": audio_b64,
                                }
                            )
                        if part.text:
                            turn_state.output_text_chunks.append(part.text)
                            live_log.write(
                                "gemini.text_part",
                                chat_id=session_chat_id,
                                text=clip_text(part.text),
                            )
                            await websocket.send_json(
                                {"type": "assistant_delta", "text": part.text}
                            )

                if content.turn_complete:
                    user_text = turn_state.user_text
                    assistant_text = turn_state.assistant_text
                    used_codex = bool(turn_state.codex_status or turn_state.codex_events)
                    false_tool_claim = _is_false_tool_claim(assistant_text, used_codex)
                    live_log.write(
                        "gemini.turn_complete",
                        chat_id=session_chat_id,
                        user_chars=len(user_text),
                        assistant_chars=len(assistant_text),
                        used_codex=used_codex,
                        false_tool_claim=false_tool_claim,
                    )
                    if false_tool_claim:
                        live_log.write("gemini.false_tool_claim_corrected", chat_id=session_chat_id)
                        await session.send_client_content(
                            turns=types.Content(
                                role="user",
                                parts=[
                                    types.Part(
                                        text=(
                                            "System correction: you claimed or implied a local tool call, "
                                            "but no tool was actually called. If the user's request requires "
                                            "local files, commands, git state, tests, builds, or code changes, "
                                            "call run_codex_task now. Otherwise answer directly without claiming tool use.\n\n"
                                            f"Original user request: {user_text or '(no transcript)'}"
                                        )
                                    )
                                ],
                            ),
                            turn_complete=True,
                        )
                        turn_state.audio_chunks.clear()
                        turn_state.output_text_chunks.clear()
                        turn_state.streamed_audio = False
                        continue
                    tracing.end_observation(
                        turn_gen,
                        input={
                            "user_message": user_text,
                            # Context from prior turns; cross-turn flow is in the
                            # Langfuse Sessions tab (grouped by chat_id).
                            "conversation_so_far": session_conversation_context
                            or "(start of conversation)",
                        },
                        output=assistant_text,
                        metadata={"workdir": session_workdir, "project_id": session_project_id},
                    )
                    turn_gen = None
                    active_turn_gen = None
                    if not turn_state.has_persistable_content():
                        turn_state.reset()
                        continue
                    if used_codex:
                        codex_handoffs.acknowledge(turn_state.handoff_ids)
                    turn_state.persist(
                        history_store=history,
                        workdir=session_workdir,
                        project_id=session_project_id,
                        chat_id=session_chat_id,
                        fallback_assistant_text="Done.",
                    )
                    session_conversation_context = _chat_context(session_chat_id, session_workdir)
                    if session_ended_by_tool:
                        live_log.write(
                            "session.auto_disconnect",
                            chat_id=session_chat_id,
                            user_text=user_text,
                            assistant_text=assistant_text,
                        )
                    await websocket.send_json(
                        {
                            "type": "turn_complete",
                            "user_text": user_text,
                            "assistant_text": assistant_text,
                            "workdir": session_workdir,
                            "audio_data_url": turn_state.audio_data_url() or None,
                            "gemini_live_usage": turn_state.usage_estimate(),
                            "session_ended": session_ended_by_tool,
                        }
                    )
                    session_ended_by_tool = False
                    turn_state.reset()
            if received_message:
                live_log.write("gemini.receive_waiting", chat_id=session_chat_id)
                await websocket.send_json(
                    {
                        "type": "debug",
                        "message": "Gemini receive loop is waiting for the next turn.",
                    }
                )
            await asyncio.sleep(0.05)

    try:
        # Read the opening frame first: the client sends {type:"config", workdir}
        # on connect, so we can bake the working directory into the system prompt.
        first_payload = cast(dict[str, Any], await websocket.receive_json())
        if first_payload.get("type") == "config":
            config = _live_client_config_from_payload(
                first_payload,
                current_project_id=session_project_id,
                current_chat_id=session_chat_id,
                current_workdir=session_workdir,
            )
            session_project_id = config["project_id"]
            session_chat_id = config["chat_id"]
            session_workdir = config["workdir"]
            session_conversation_context = config["conversation_context"]
            live_log.write(
                "client.initial_config",
                chat_id=session_chat_id,
                project_id=session_project_id,
                workdir=session_workdir,
                context_chars=len(session_conversation_context),
            )
            _write_model_context_packet(
                surface="live",
                chat_id=session_chat_id,
                project_id=session_project_id,
                workdir=session_workdir,
                model=settings.gemini_model,
                user_text=None,
                conversation_context=session_conversation_context,
                extra={
                    "compression_trigger_tokens": settings.gemini_live_compression_trigger_tokens,
                    "compression_target_tokens": settings.gemini_live_compression_target_tokens,
                    "has_resumption_handle": bool(
                        session_chat_id and _live_resumption_handles.get(session_chat_id)
                    ),
                },
            )
            await websocket.send_json(
                {"type": "debug", "message": f"Active workdir: {session_workdir}"}
            )
            first_payload = None

        session_resumption_handle = (
            _live_resumption_handles.get(session_chat_id) if session_chat_id else None
        )
        async with client.aio.live.connect(
            model=settings.gemini_model,
            config=live_connect_config(
                settings,
                session_workdir,
                session_conversation_context,
                session_resumption_handle=session_resumption_handle,
            ),
        ) as raw_session:
            session = cast(_LiveSession, raw_session)
            if session_chat_id:
                _live_completion_subscribers.setdefault(session_chat_id, set()).add(completion_queue)
                for handoff in codex_handoffs.pending_completion_for_chat(session_chat_id):
                    completion_queue.put_nowait({"handoff": handoff, "result": _latest_artifact_replay(session_chat_id, "what was the result") or str(handoff["result_summary"]), "artifacts": []})
            live_log.write(
                "gemini.connected",
                chat_id=session_chat_id,
                model=settings.gemini_model,
                has_resumption_handle=bool(session_resumption_handle),
            )
            await websocket.send_json({"type": "debug", "message": "Connected to Gemini Live."})
            # Group every observation from this live connection under one session.
            # create_task copies the current context, so the spawned tasks inherit it.
            with tracing.session_context(
                session_id=session_chat_id,
                metadata={"project_id": session_project_id, "workdir": session_workdir},
                tags=["voice-live"],
            ):
                send_task = asyncio.create_task(send_client_audio(session, first_payload))
                receive_task = asyncio.create_task(receive_gemini(session))
                completion_task = asyncio.create_task(deliver_completions())
                done, pending = await asyncio.wait(
                    {send_task, receive_task, completion_task}, return_when=asyncio.FIRST_COMPLETED
                )
                live_log.write(
                    "websocket.task_completed",
                    chat_id=session_chat_id,
                    done=len(done),
                    pending=len(pending),
                )
                for task in pending:
                    task.cancel()
                for task in done:
                    task.result()
            await websocket.close()
    except WebSocketDisconnect:
        live_log.write("websocket.disconnect", chat_id=session_chat_id)
        return
    except Exception as exc:
        if _is_gemini_disconnect_cleanup_exception(exc):
            live_log.write(
                "websocket.disconnect_cleanup", chat_id=session_chat_id, message=clip_text(exc)
            )
            return
        live_log.write("websocket.exception", chat_id=session_chat_id, message=clip_text(exc))
        try:
            await websocket.send_json({"type": "error", "message": str(exc)})
        except Exception:
            return
    finally:
        if session_chat_id:
            _live_completion_subscribers.get(session_chat_id, set()).discard(completion_queue)
        live_log.write(
            "websocket.finally",
            chat_id=session_chat_id,
            active_user_chars=len(turn_state.user_text),
            active_assistant_chars=len(turn_state.assistant_text),
            had_active_cancel_token=bool(current_task_cancel_token),
        )
        if current_task_cancel_token:
            current_task_cancel_token.cancel()
            await interrupt_codex_thread_session(session_chat_id)
        tracing.end_observation(
            active_turn_gen,
            input={
                "user_message": turn_state.user_text,
                "conversation_so_far": session_conversation_context or "(start of conversation)",
            },
            output=turn_state.assistant_text or None,
            level="WARNING",
            status_message="voice connection ended before turn_complete",
            metadata={"workdir": session_workdir, "project_id": session_project_id},
        )


def _git_branch(root: Path) -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            timeout=2,
        )
        branch = out.stdout.strip()
        return branch or None
    except Exception:
        return None


def _file_count(root: Path) -> int | None:
    """Count tracked files when it's a git repo, else a shallow file count."""
    try:
        tracked = subprocess.run(
            ["git", "-C", str(root), "ls-files"],
            capture_output=True,
            text=True,
            timeout=3,
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
            "try\n"
            '  POSIX path of (choose folder with prompt "Select a project folder")\n'
            "on error number -128\n"
            '  return ""\n'
            "end try"
        )
        proc = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
        return (proc.stdout.strip() or None) if proc.returncode == 0 else None
    if shutil.which("zenity"):
        proc = subprocess.run(
            ["zenity", "--file-selection", "--directory", "--title=Select a project folder"],
            capture_output=True,
            text=True,
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
    workdir = _resolve_scoped_workdir(req.workdir, project_id=req.project_id)
    enhanced_task = improve_codex_task_prompt(task)
    history.append(
        "user",
        task,
        {
            "direct_codex": True,
            "workdir": workdir,
            "project_id": req.project_id,
            "chat_id": req.chat_id,
        },
    )
    app_log.write(
        "codex_stream.start",
        chat_id=req.chat_id,
        project_id=req.project_id,
        workdir=workdir,
        task_chars=len(task),
    )

    cancel_token = CancellationToken()

    async def event_source():
        final_text = ""
        final_workdir = workdir
        codex_events = []
        final_artifacts = []
        codex_turn_id = None
        codex_thread_id = None
        codex_status = None
        try:
            with tracing.session_context(
                session_id=req.chat_id,
                metadata={"workdir": workdir, "project_id": req.project_id},
                tags=["direct-codex", "stream"],
            ):
                async for event in run_codex_stream_with_timer(
                    enhanced_task, workdir, settings, cancel_token, req.chat_id
                ):
                    if event.get("type") == "codex_event":
                        codex_events.append(event)
                    elif event.get("type") == "done":
                        final_text = str(event.get("text") or "")
                        final_workdir = str(event.get("workdir") or workdir)
                        codex_events = list(event.get("events") or codex_events)
                        codex_turn_id = event.get("turn_id")
                        codex_thread_id = event.get("thread_id")
                        codex_status = event.get("status")
                        artifact = _create_tool_artifact(
                            chat_id=req.chat_id,
                            message_id=None,
                            title="Codex output",
                            content=final_text,
                            source="direct_codex",
                            workdir=final_workdir,
                        )
                        if artifact:
                            final_artifacts.append(artifact)
                            event["artifact"] = artifact
                        change_artifact = _create_change_review_artifact(
                            chat_id=req.chat_id,
                            workdir=final_workdir,
                            codex_events=codex_events,
                        )
                        if change_artifact:
                            final_artifacts.append(change_artifact)
                            event["change_artifact"] = change_artifact
                            event["changed_files"] = change_artifact.get("changed_files", [])
                        app_log.write(
                            "codex_stream.done_event",
                            chat_id=req.chat_id,
                            reply_chars=len(final_text),
                            codex_status=codex_status,
                            codex_turn_id=codex_turn_id,
                            codex_thread_id=codex_thread_id,
                        )
                    elif event.get("type") == "error":
                        app_log.write(
                            "codex_stream.error_event",
                            chat_id=req.chat_id,
                            message=clip_text(event.get("message")),
                        )
                    yield f"data: {json.dumps(event)}\n\n"
        except Exception as exc:
            app_log.write("codex_stream.exception", chat_id=req.chat_id, message=clip_text(exc))
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
        finally:
            cancel_token.cancel()
            app_log.write(
                "codex_stream.finally",
                chat_id=req.chat_id,
                final_text_chars=len(final_text),
                codex_status=codex_status,
                persisted=bool(final_text),
            )
            if final_text:
                history.append(
                    "assistant",
                    final_text,
                    {
                        "direct_codex": True,
                        "artifacts": final_artifacts,
                        "workdir": final_workdir,
                        "project_id": req.project_id,
                        "chat_id": req.chat_id,
                        "codex_events": codex_events[-200:],
                        "codex_turn_id": codex_turn_id,
                        "codex_thread_id": codex_thread_id,
                        "codex_status": codex_status,
                    },
                )

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
