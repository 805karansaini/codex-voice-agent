from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Callable, Protocol, cast

from ..history import HistoryStore
from ..live_logging import clip_text
from ..settings import Settings


class EventLogger(Protocol):
    def write(self, event: str, **payload: object) -> None: ...


CreateToolArtifact = Callable[
    [str | None, str | None, str, object, str, str | None], dict[str, object] | None
]
CreateChangeArtifact = Callable[[str | None, str | None, list[object]], dict[str, object] | None]
CodexStreamRunner = Callable[[str, str, Settings, Any | None, str | None], AsyncIterator[dict[str, Any]]]


@dataclass
class CodexBackgroundJob:
    id: str
    task: str
    enhanced_task: str
    workdir: str
    project_id: str | None
    chat_id: str | None
    status: str = "queued"
    result: str = ""
    error: str = ""
    latest_status: str = "Codex is queued."
    progress_updates: list[str] = field(default_factory=list)
    codex_events: list[dict[str, Any]] = field(default_factory=list)
    codex_turn_id: str | None = None
    codex_thread_id: str | None = None
    codex_status: str | None = None
    artifacts: list[dict[str, object]] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "task": self.task,
            "workdir": self.workdir,
            "project_id": self.project_id,
            "chat_id": self.chat_id,
            "status": self.status,
            "result": self.result,
            "error": self.error,
            "latest_status": self.latest_status,
            "progress_updates": self.progress_updates[-20:],
            "codex_events": self.codex_events[-200:],
            "codex_turn_id": self.codex_turn_id,
            "codex_thread_id": self.codex_thread_id,
            "codex_status": self.codex_status,
            "artifacts": self.artifacts,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


CreateHandoff = Callable[[CodexBackgroundJob], dict[str, object] | None]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class BackgroundJobService:
    def __init__(
        self,
        *,
        settings: Settings,
        history: HistoryStore,
        app_log: EventLogger,
        create_tool_artifact: CreateToolArtifact,
        create_change_review_artifact: CreateChangeArtifact,
        run_codex_stream: CodexStreamRunner,
        create_handoff: CreateHandoff | None = None,
    ) -> None:
        self.settings = settings
        self.history = history
        self.app_log = app_log
        self.create_tool_artifact = create_tool_artifact
        self.create_change_review_artifact = create_change_review_artifact
        self.run_codex_stream = run_codex_stream
        self.create_handoff = create_handoff
        self.jobs: dict[str, CodexBackgroundJob] = {}
        self.lock = asyncio.Lock()

    def configure(
        self,
        *,
        history: HistoryStore | None = None,
        app_log: EventLogger | None = None,
        run_codex_stream: CodexStreamRunner | None = None,
        create_handoff: CreateHandoff | None = None,
    ) -> None:
        if history is not None:
            self.history = history
        if app_log is not None:
            self.app_log = app_log
        if run_codex_stream is not None:
            self.run_codex_stream = run_codex_stream
        if create_handoff is not None:
            self.create_handoff = create_handoff

    def clear(self) -> None:
        self.jobs.clear()

    def touch(self, job: CodexBackgroundJob, status: str | None = None) -> None:
        if status:
            job.status = status
        job.updated_at = utc_now_iso()

    def record_progress(self, job: CodexBackgroundJob, message: object) -> None:
        text = " ".join(str(message or "").split())
        if not text:
            return
        job.latest_status = text
        if not job.progress_updates or job.progress_updates[-1] != text:
            job.progress_updates.append(text)
            job.progress_updates = job.progress_updates[-20:]
        self.touch(job)

    async def store(self, job: CodexBackgroundJob) -> None:
        async with self.lock:
            self.jobs[job.id] = job

    async def get(self, job_id: str) -> CodexBackgroundJob | None:
        async with self.lock:
            return self.jobs.get(job_id)

    async def list(self, chat_id: str | None = None) -> list[dict[str, object]]:
        async with self.lock:
            rows = list(self.jobs.values())
        if chat_id is not None:
            rows = [job for job in rows if job.chat_id == chat_id]
        rows.sort(key=lambda job: job.created_at, reverse=True)
        return [job.to_dict() for job in rows[:50]]

    async def run(self, job_id: str) -> None:
        job = await self.get(job_id)
        if job is None:
            return
        self.touch(job, "running")
        self.record_progress(job, "Codex started working.")
        self.app_log.write("codex_job.start", job_id=job.id, chat_id=job.chat_id, workdir=job.workdir)
        try:
            async for event in self.run_codex_stream(
                job.enhanced_task,
                job.workdir,
                self.settings,
                None,
                job.chat_id,
            ):
                if event.get("type") == "codex_event":
                    job.codex_events.append(dict(event))
                    self.record_progress(job, event.get("summary"))
                    self.touch(job)
                elif event.get("type") == "status":
                    self.record_progress(job, event.get("message"))
                elif event.get("type") == "delta":
                    self.record_progress(job, "Codex is writing its response.")
                elif event.get("type") == "done":
                    job.result = str(event.get("text") or "")
                    job.workdir = str(event.get("workdir") or job.workdir)
                    job.codex_events = list(event.get("events") or job.codex_events)
                    job.codex_turn_id = event.get("turn_id")
                    job.codex_thread_id = event.get("thread_id")
                    job.codex_status = event.get("status")
                    self.record_progress(job, "Codex completed the task.")
                    artifact = self.create_tool_artifact(
                        job.chat_id,
                        None,
                        "Codex output",
                        job.result,
                        "background_codex",
                        job.workdir,
                    )
                    if artifact:
                        job.artifacts.append(artifact)
                    change_artifact = self.create_change_review_artifact(
                        job.chat_id,
                        job.workdir,
                        cast(list[object], job.codex_events),
                    )
                    if change_artifact:
                        job.artifacts.append(change_artifact)
                    self.history.append(
                        "assistant",
                        job.result or "Codex background task completed.",
                        {
                            "direct_codex": True,
                            "background_job_id": job.id,
                            "artifacts": job.artifacts,
                            "workdir": job.workdir,
                            "project_id": job.project_id,
                            "chat_id": job.chat_id,
                            "codex_events": job.codex_events[-200:],
                            "codex_turn_id": job.codex_turn_id,
                            "codex_thread_id": job.codex_thread_id,
                            "codex_status": job.codex_status,
                        },
                    )
                    handoff = self.create_handoff(job) if self.create_handoff else None
                    self.touch(job, "done")
                    self.app_log.write(
                        "codex_job.done",
                        job_id=job.id,
                        chat_id=job.chat_id,
                        codex_status=job.codex_status,
                        result_chars=len(job.result),
                        handoff_id=handoff.get("id") if handoff else None,
                    )
                elif event.get("type") == "error":
                    job.error = str(event.get("message") or "Codex failed")
                    self.record_progress(job, job.error)
                    self.touch(job, "failed")
                    self.app_log.write("codex_job.error", job_id=job.id, message=clip_text(job.error))
        except Exception as exc:
            job.error = str(exc)
            self.record_progress(job, job.error)
            self.touch(job, "failed")
            self.app_log.write("codex_job.exception", job_id=job.id, message=clip_text(exc))
        finally:
            if job.status == "running":
                self.touch(job, "failed")
                job.error = job.error or "Codex task ended before completion"
