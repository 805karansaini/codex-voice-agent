from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Callable, Protocol, TypeVar, cast

from ..history import HistoryStore
from ..live_logging import clip_text
from ..settings import Settings


class EventLogger(Protocol):
    def write(self, event: str, **payload: object) -> None: ...


CreateToolArtifact = Callable[
    [str | None, str | None, str, object, str, str | None], dict[str, object] | None
]
CreateChangeArtifact = Callable[[str | None, str | None, list[object]], dict[str, object] | None]
CodexStreamRunner = Callable[..., AsyncIterator[dict[str, Any]]]

TERMINAL_JOB_STATUSES = frozenset({"done", "failed"})
DEFAULT_MAX_TERMINAL_JOBS = 100
JOB_CANCELLED_MESSAGE = "Codex task was cancelled."
BlockingResult = TypeVar("BlockingResult")


@dataclass
class CodexBackgroundJob:
    id: str
    task: str
    enhanced_task: str
    workdir: str
    project_id: str | None
    chat_id: str | None
    source: str = "direct"
    model: str | None = None
    reasoning_effort: str | None = None
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
            "model": self.model,
            "reasoning_effort": self.reasoning_effort,
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
        max_terminal_jobs: int = DEFAULT_MAX_TERMINAL_JOBS,
    ) -> None:
        if max_terminal_jobs < 0:
            raise ValueError("max_terminal_jobs must be zero or greater")
        self.settings = settings
        self.history = history
        self.app_log = app_log
        self.create_tool_artifact = create_tool_artifact
        self.create_change_review_artifact = create_change_review_artifact
        self.run_codex_stream = run_codex_stream
        self.create_handoff = create_handoff
        self.max_terminal_jobs = max_terminal_jobs
        self.jobs: dict[str, CodexBackgroundJob] = {}
        self.lock = asyncio.Lock()
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._closed = False

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

    def open(self) -> None:
        """Allow a new application lifespan after a completed shutdown."""
        if self._tasks:
            raise RuntimeError("Background job service still owns active tasks")
        self._closed = False

    def start(self, job_id: str) -> asyncio.Task[None]:
        """Start a stored job and retain its task until it settles."""
        if self._closed:
            raise RuntimeError("Background job service is closed")
        existing = self._tasks.get(job_id)
        if existing is not None and not existing.done():
            return existing
        job = self.jobs.get(job_id)
        if job is None:
            raise KeyError(f"Unknown background job: {job_id}")
        if job.status != "queued":
            raise RuntimeError(f"Background job {job_id} cannot start from {job.status!r}")
        task = asyncio.create_task(self.run(job_id), name=f"codex-background-job:{job_id}")
        self._tasks[job_id] = task
        task.add_done_callback(lambda completed: self._discard_task(job_id, completed))
        return task

    def _discard_task(self, job_id: str, task: asyncio.Task[None]) -> None:
        if self._tasks.get(job_id) is task:
            self._tasks.pop(job_id, None)

    @staticmethod
    async def _cancel_tasks(tasks: list[asyncio.Task[None]]) -> None:
        for task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def close(self) -> None:
        """Cancel all owned work and wait until every task has stopped."""
        self._closed = True
        tasks = list(self._tasks.items())
        await self._cancel_tasks([task for _job_id, task in tasks])
        self._tasks.clear()
        async with self.lock:
            for job in self.jobs.values():
                if job.status in TERMINAL_JOB_STATUSES:
                    continue
                self._fail_job(
                    job,
                    JOB_CANCELLED_MESSAGE,
                    "codex_job.cancelled",
                )
        await self.prune_terminal_jobs()

    async def cancel_and_remove(
        self,
        *,
        chat_id: str | None = None,
        project_id: str | None = None,
        workdir: str | None = None,
    ) -> list[str]:
        """Stop and forget scoped jobs before their stored data is deleted."""
        if chat_id is None and project_id is None and workdir is None:
            raise ValueError("chat_id, project_id, or workdir is required")

        def matches(job: CodexBackgroundJob) -> bool:
            return (
                (chat_id is None or job.chat_id == chat_id)
                and (project_id is None or job.project_id == project_id)
                and (workdir is None or job.workdir == workdir)
            )

        matched_ids: set[str] = set()
        while True:
            async with self.lock:
                matched_jobs = [job for job in self.jobs.values() if matches(job)]
                matched_ids.update(job.id for job in matched_jobs)
                active_tasks = [
                    task
                    for job in matched_jobs
                    if (task := self._tasks.get(job.id)) is not None and not task.done()
                ]
                if not active_tasks:
                    for job in matched_jobs:
                        if job.status not in TERMINAL_JOB_STATUSES:
                            self._fail_job(
                                job,
                                JOB_CANCELLED_MESSAGE,
                                "codex_job.cancelled",
                            )
                        self.jobs.pop(job.id, None)
                        self._tasks.pop(job.id, None)
                    return sorted(matched_ids)

            await self._cancel_tasks(active_tasks)

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
            if self._closed:
                raise RuntimeError("Background job service is closed")
            self.jobs[job.id] = job
            self._prune_terminal_jobs_locked(self.max_terminal_jobs)

    async def store_and_start(self, job: CodexBackgroundJob) -> asyncio.Task[None]:
        """Publish and start a job without exposing a removable queued gap."""
        async with self.lock:
            if self._closed:
                raise RuntimeError("Background job service is closed")
            self.jobs[job.id] = job
            self._prune_terminal_jobs_locked(self.max_terminal_jobs)
            return self.start(job.id)

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

    async def prune_terminal_jobs(self, limit: int | None = None) -> list[str]:
        """Remove the oldest settled jobs while leaving active work untouched."""
        retained = self.max_terminal_jobs if limit is None else limit
        if retained < 0:
            raise ValueError("terminal job limit must be zero or greater")
        async with self.lock:
            return self._prune_terminal_jobs_locked(retained)

    def _prune_terminal_jobs_locked(self, retained: int) -> list[str]:
        terminal_jobs = sorted(
            (job for job in self.jobs.values() if job.status in TERMINAL_JOB_STATUSES),
            key=lambda job: (job.updated_at, job.created_at, job.id),
            reverse=True,
        )
        removed = [job.id for job in terminal_jobs[retained:]]
        for job_id in removed:
            self.jobs.pop(job_id, None)
        return removed

    @staticmethod
    def _compact_event(event: object) -> dict[str, Any] | None:
        if not isinstance(event, dict):
            return None
        compact = {key: value for key, value in event.items() if key not in {"type", "payload"}}
        return compact or None

    @classmethod
    def _compact_events(cls, events: object) -> list[dict[str, Any]]:
        if not isinstance(events, list):
            return []
        compact_events = [cls._compact_event(event) for event in events]
        return [event for event in compact_events if event is not None][-200:]

    def _fail_job(self, job: CodexBackgroundJob, message: str, log_event: str) -> None:
        job.error = message
        self.record_progress(job, message)
        self.touch(job, "failed")
        self.app_log.write(log_event, job_id=job.id, message=clip_text(message))

    @staticmethod
    async def _run_blocking(
        function: Callable[..., BlockingResult], *args: object
    ) -> BlockingResult:
        """Finish an already-started worker call before propagating cancellation."""

        def invoke() -> BlockingResult:
            return function(*args)

        worker = asyncio.create_task(asyncio.to_thread(invoke))
        try:
            return await asyncio.shield(worker)
        except asyncio.CancelledError:
            while not worker.done():
                try:
                    await asyncio.shield(worker)
                except asyncio.CancelledError:
                    continue
                except BaseException:
                    break
            if worker.done():
                try:
                    worker.result()
                except BaseException:
                    pass
            raise

    async def _complete_job(self, job: CodexBackgroundJob, event: dict[str, Any]) -> None:
        job.result = str(event.get("text") or "")
        job.workdir = str(event.get("workdir") or job.workdir)
        final_events = self._compact_events(event.get("events"))
        if final_events:
            job.codex_events = final_events
        job.codex_turn_id = event.get("turn_id")
        job.codex_thread_id = event.get("thread_id")
        job.codex_status = event.get("status")
        self.record_progress(job, "Codex completed the task.")

        artifact = await self._run_blocking(
            self.create_tool_artifact,
            job.chat_id,
            None,
            "Codex output",
            job.result,
            "background_codex",
            job.workdir,
        )
        if artifact:
            job.artifacts.append(artifact)
        change_artifact = await self._run_blocking(
            self.create_change_review_artifact,
            job.chat_id,
            job.workdir,
            cast(list[object], job.codex_events),
        )
        if change_artifact:
            job.artifacts.append(change_artifact)
        await self._run_blocking(
            self.history.append,
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

        # Handoff persistence falls back to the job status when the provider omits
        # its own status, so publish the terminal state before creating the handoff.
        self.touch(job, "done")
        handoff = self.create_handoff(job) if self.create_handoff else None
        self.app_log.write(
            "codex_job.done",
            job_id=job.id,
            chat_id=job.chat_id,
            codex_status=job.codex_status,
            result_chars=len(job.result),
            handoff_id=handoff.get("id") if handoff else None,
        )

    async def _persist_request(self, job: CodexBackgroundJob) -> None:
        await self._run_blocking(
            self.history.append,
            "user",
            job.task,
            {
                "direct_codex": True,
                "background_job_id": job.id,
                "background_status": "queued",
                "user_visible": job.source == "direct",
                "source": job.source,
                "workdir": job.workdir,
                "project_id": job.project_id,
                "chat_id": job.chat_id,
            },
        )

    async def run(self, job_id: str) -> None:
        job = await self.get(job_id)
        if job is None:
            return
        self.touch(job, "running")
        self.record_progress(job, "Codex started working.")
        self.app_log.write(
            "codex_job.start", job_id=job.id, chat_id=job.chat_id, workdir=job.workdir
        )
        try:
            await self._persist_request(job)
            async for event in self.run_codex_stream(
                job.enhanced_task,
                job.workdir,
                self.settings,
                None,
                job.chat_id,
                job.model,
                job.reasoning_effort,
            ):
                if event.get("type") == "codex_event":
                    compact_event = self._compact_event(event)
                    if compact_event is not None:
                        job.codex_events.append(compact_event)
                        job.codex_events = job.codex_events[-200:]
                    self.record_progress(job, event.get("summary"))
                    self.touch(job)
                elif event.get("type") == "status":
                    self.record_progress(job, event.get("message"))
                elif event.get("type") == "delta":
                    self.record_progress(job, "Codex is writing its response.")
                elif event.get("type") == "done":
                    await self._complete_job(job, event)
                    return
                elif event.get("type") == "error":
                    final_events = self._compact_events(event.get("events"))
                    if final_events:
                        job.codex_events = final_events
                    self._fail_job(
                        job,
                        str(event.get("message") or "Codex failed"),
                        "codex_job.error",
                    )
                    return
        except asyncio.CancelledError:
            self._fail_job(
                job,
                JOB_CANCELLED_MESSAGE,
                "codex_job.cancelled",
            )
            raise
        except Exception as exc:
            self._fail_job(job, str(exc), "codex_job.exception")
        finally:
            if job.status == "running":
                self._fail_job(
                    job,
                    job.error or "Codex task ended before completion",
                    "codex_job.error",
                )
            await self.prune_terminal_jobs()
