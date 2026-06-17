from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..prompting import improve_codex_task_prompt
from ..services.background_jobs import CodexBackgroundJob


class CodexJobRequest(BaseModel):
    task: str = ""
    message: str = ""
    workdir: str | None = None
    project_id: str | None = None
    chat_id: str | None = None


def create_router(
    *,
    resolve_workdir: Callable[[str | None, str | None], str],
    enqueue_job: Callable[..., Awaitable[CodexBackgroundJob]],
    get_job: Callable[[str], Awaitable[CodexBackgroundJob | None]],
    list_jobs: Callable[[str | None], Awaitable[list[dict[str, object]]]],
) -> APIRouter:
    router = APIRouter()

    @router.post("/api/codex/jobs")
    async def enqueue_codex_job(req: CodexJobRequest) -> dict[str, object]:
        task = req.task.strip()
        if not task:
            raise HTTPException(status_code=400, detail="Task is required")
        workdir = resolve_workdir(req.workdir, req.project_id)
        job = await enqueue_job(
            task=task,
            enhanced_task=improve_codex_task_prompt(task),
            workdir=workdir,
            project_id=req.project_id,
            chat_id=req.chat_id,
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
