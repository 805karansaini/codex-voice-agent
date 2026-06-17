from __future__ import annotations

from collections.abc import Callable
from typing import Protocol

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.change_review import CommitResult, RevertResult


class EventLogger(Protocol):
    def __call__(self, event: str, **payload: object) -> None: ...


class ChangeReviewRevertRequest(BaseModel):
    workdir: str
    files: list[str]


class ChangeReviewCommitRequest(BaseModel):
    workdir: str
    files: list[str]
    message: str


def create_router(
    *,
    revert_changed_files: Callable[[str, list[str]], RevertResult],
    commit_changed_files: Callable[[str, list[str], str], CommitResult],
    write_log: EventLogger,
) -> APIRouter:
    router = APIRouter()

    @router.post("/api/change-review/revert")
    async def revert_change_review(req: ChangeReviewRevertRequest) -> RevertResult:
        try:
            result = revert_changed_files(req.workdir, req.files)
        except (FileNotFoundError, NotADirectoryError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        write_log(
            "change_review.revert",
            workdir=req.workdir,
            file_count=len(result.get("reverted_files") or []),
        )
        return result

    @router.post("/api/change-review/commit")
    async def commit_change_review(req: ChangeReviewCommitRequest) -> CommitResult:
        try:
            result = commit_changed_files(req.workdir, req.files, req.message)
        except (FileNotFoundError, NotADirectoryError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        write_log(
            "change_review.commit",
            workdir=req.workdir,
            file_count=len(result.get("committed_files") or []),
            commit=result.get("commit"),
        )
        return result

    return router
