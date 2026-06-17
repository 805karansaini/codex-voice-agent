from __future__ import annotations

import asyncio
import uuid
from collections.abc import Awaitable, Callable, Coroutine
from typing import Any, Protocol

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..history import HistoryStore
from ..prompting import improve_codex_task_prompt
from ..services.background_jobs import CodexBackgroundJob


class EventLogger(Protocol):
    def __call__(self, event: str, **payload: object) -> None: ...


class CodexJobRequest(BaseModel):
    task: str = ""
    message: str = ""
    workdir: str | None = None
    project_id: str | None = None
    chat_id: str | None = None


def create_router(
    *,
    resolve_workdir: Callable[[str | None, str | None], str],
    history: HistoryStore,
    store_job: Callable[[CodexBackgroundJob], Awaitable[None]],
    get_job: Callable[[str], Awaitable[CodexBackgroundJob | None]],
    list_jobs: Callable[[str | None], Awaitable[list[dict[str, object]]]],
    run_job: Callable[[str], Coroutine[Any, Any, None]],
    write_log: EventLogger,
) -> APIRouter:
    router = APIRouter()

    @router.post("/api/codex/jobs")
    async def enqueue_codex_job(req: CodexJobRequest) -> dict[str, object]:
        task = req.task.strip()
        if not task:
            raise HTTPException(status_code=400, detail="Task is required")
        workdir = resolve_workdir(req.workdir, req.project_id)
        job = CodexBackgroundJob(
            id=str(uuid.uuid4()),
            task=task,
            enhanced_task=improve_codex_task_prompt(task),
            workdir=workdir,
            project_id=req.project_id,
            chat_id=req.chat_id,
        )
        await store_job(job)
        history.append(
            "user",
            task,
            {
                "direct_codex": True,
                "background_job_id": job.id,
                "workdir": workdir,
                "project_id": req.project_id,
                "chat_id": req.chat_id,
            },
        )
        asyncio.create_task(run_job(job.id))
        write_log(
            "codex_job.queued",
            job_id=job.id,
            chat_id=req.chat_id,
            project_id=req.project_id,
            workdir=workdir,
            task_chars=len(task),
        )
        return job.to_dict()

    @router.get("/api/codex/jobs")
    async def list_codex_jobs(chat_id: str | None = None) -> list[dict[str, object]]:
        return await list_jobs(chat_id)

    @router.get("/api/codex/jobs/{job_id}")
    async def get_codex_job(job_id: str) -> dict[str, object]:
        job = await get_job(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Codex job not found")
        return job.to_dict()

    return router
