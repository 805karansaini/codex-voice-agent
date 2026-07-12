from __future__ import annotations

import asyncio
import shutil
import subprocess
import sys
from contextlib import AbstractAsyncContextManager
from pathlib import Path
from typing import Awaitable, Callable, ParamSpec, Protocol, TypeVar

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.foreground_activity import ForegroundActivityUnavailable


class ProjectStore(Protocol):
    def list(self) -> list[dict[str, object]]: ...

    def upsert(self, project: dict[str, object]) -> dict[str, object]: ...

    def delete(self, project_id: str) -> None: ...


class ChatStore(Protocol):
    def list(self, project_id: str | None = None) -> list[dict[str, object]]: ...

    def delete_for_project(self, project_id: str) -> None: ...


class HistoryStore(Protocol):
    def chat_ids(
        self,
        project_id: str | None = None,
        workdir: str | None = None,
        chat_id: str | None = None,
    ) -> list[str]: ...

    def clear(
        self,
        project_id: str | None = None,
        workdir: str | None = None,
        chat_id: str | None = None,
    ) -> None: ...


class ChatScopedStore(Protocol):
    def clear(self, chat_id: str | None = None) -> None: ...


class ConsoleStore(Protocol):
    def clear_for_project(self, chat_ids: list[str]) -> None: ...


ResolveWorkdir = Callable[[str], Path]
ProjectRoot = Callable[[str | None], Path | None]
CloseSessions = Callable[[list[str]], Awaitable[None]]
ClearLiveChatState = Callable[[list[str]], None]
P = ParamSpec("P")
R = TypeVar("R")


class ForegroundLease(Protocol):
    async def run_sync(self, function: Callable[P, R], *args: P.args, **kwargs: P.kwargs) -> R: ...


class ForegroundActivity(Protocol):
    def __call__(
        self,
        *,
        chat_id: str | None = None,
        project_id: str | None = None,
        workdir: str | None = None,
    ) -> AbstractAsyncContextManager[ForegroundLease]: ...


class ForegroundCleanup(Protocol):
    def __call__(
        self,
        *,
        chat_ids: list[str] | tuple[str, ...] = (),
        project_id: str | None = None,
        workdir: str | None = None,
    ) -> AbstractAsyncContextManager[list[str]]: ...


class CancelBackgroundJobs(Protocol):
    def __call__(
        self,
        *,
        chat_id: str | None = None,
        project_id: str | None = None,
        workdir: str | None = None,
    ) -> Awaitable[list[str]]: ...


class ProjectRequest(BaseModel):
    id: str
    name: str
    path: str
    color: str
    createdAt: int


_IGNORED_DIRECTORIES = {
    ".git",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "__pycache__",
    "build",
    "dist",
    "node_modules",
}
_MAX_PREVIEW_BYTES = 512 * 1024


def is_file_browser_hidden(relative_path: Path) -> bool:
    normalized_parts = (part.casefold() for part in relative_path.parts)
    return any(
        part in _IGNORED_DIRECTORIES
        or part == ".ds_store"
        or part == ".env"
        or part.startswith(".env.")
        for part in normalized_parts
    )


def file_browser_path(root: Path, relative_path: str) -> Path:
    requested = Path(relative_path)
    if not relative_path or requested.is_absolute() or ".." in requested.parts:
        raise HTTPException(status_code=400, detail="Invalid file path")
    if is_file_browser_hidden(requested):
        raise HTTPException(status_code=404, detail="Path not found")
    resolved_root = root.resolve()
    candidate = (resolved_root / requested).resolve()
    if not candidate.is_relative_to(resolved_root):
        raise HTTPException(status_code=400, detail="File must be inside the selected project")
    if is_file_browser_hidden(candidate.relative_to(resolved_root)):
        raise HTTPException(status_code=404, detail="Path not found")
    return candidate


def _list_project_files(root: Path, path: str) -> dict[str, object]:
    directory = root if not path else file_browser_path(root, path)
    if not directory.exists() or not directory.is_dir():
        raise HTTPException(status_code=404, detail="Folder not found")
    entries: list[dict[str, object]] = []
    for child in sorted(
        directory.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower())
    ):
        relative = child.relative_to(root)
        if is_file_browser_hidden(relative):
            continue
        entries.append({"path": relative.as_posix(), "is_directory": child.is_dir()})
        if len(entries) >= 500:
            break
    return {"root": str(root), "entries": entries, "truncated": len(entries) >= 500}


def _read_project_file(root: Path, path: str) -> dict[str, object]:
    file_path = file_browser_path(root, path)
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    size = file_path.stat().st_size
    if size > _MAX_PREVIEW_BYTES:
        raise HTTPException(status_code=413, detail="This file is too large to preview")
    try:
        content = file_path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=415, detail="Binary files cannot be previewed") from exc
    return {"path": path, "content": content, "size": size}


def _git_branch(root: Path) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            timeout=2,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    branch = result.stdout.strip()
    return branch or None


def _file_count(root: Path) -> int | None:
    try:
        tracked = subprocess.run(
            ["git", "-C", str(root), "ls-files"],
            capture_output=True,
            text=True,
            timeout=3,
        )
        if tracked.returncode == 0 and tracked.stdout.strip():
            return sum(1 for line in tracked.stdout.splitlines() if line.strip())
        return sum(1 for entry in root.iterdir() if entry.is_file())
    except (OSError, subprocess.SubprocessError):
        return None


def _pick_directory_sync() -> str | None:
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
            ["kdialog", "--getexistingdirectory", str(Path.home())],
            capture_output=True,
            text=True,
        )
        return proc.stdout.strip() or None
    raise RuntimeError("No native folder picker is available on this host. Paste the path instead.")


def create_router(
    *,
    projects: ProjectStore,
    chats: ChatStore,
    history: HistoryStore,
    artifacts: ChatScopedStore,
    handoffs: ChatScopedStore,
    console: ConsoleStore,
    project_root: ProjectRoot,
    resolve_workdir: ResolveWorkdir,
    close_sessions: CloseSessions,
    cancel_background_jobs: CancelBackgroundJobs,
    foreground_activity: ForegroundActivity,
    cleanup_foreground_work: ForegroundCleanup,
    clear_live_chat_state: ClearLiveChatState,
) -> APIRouter:
    router = APIRouter()

    def require_project_root(project_id: str) -> Path:
        root = project_root(project_id)
        if root is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return root

    @router.get("/api/projects")
    def list_projects() -> list[dict[str, object]]:
        return projects.list()

    @router.get("/api/projects/{project_id}/files")
    async def list_project_files(project_id: str, path: str = "") -> dict[str, object]:
        return await asyncio.to_thread(_list_project_files, require_project_root(project_id), path)

    @router.get("/api/projects/{project_id}/files/content")
    async def read_project_file(project_id: str, path: str) -> dict[str, object]:
        return await asyncio.to_thread(_read_project_file, require_project_root(project_id), path)

    @router.post("/api/projects")
    async def save_project(req: ProjectRequest) -> dict[str, object]:
        project_id = req.id.strip()
        project_name = req.name.strip()
        if not project_id or not project_name:
            raise HTTPException(status_code=400, detail="Project id and name are required")
        try:
            async with foreground_activity(project_id=project_id) as lease:
                root = await asyncio.to_thread(resolve_workdir, req.path)
                return await lease.run_sync(
                    projects.upsert,
                    {
                        "id": project_id,
                        "name": project_name,
                        "path": str(root),
                        "color": req.color,
                        "createdAt": req.createdAt,
                    },
                )
        except ForegroundActivityUnavailable as exc:
            raise HTTPException(status_code=409, detail="This project is being cleared") from exc
        except (FileNotFoundError, NotADirectoryError) as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @router.delete("/api/projects/{project_id}")
    async def delete_project(project_id: str) -> dict[str, object]:
        project_chats = await asyncio.to_thread(chats.list, project_id=project_id)
        recovered_chat_ids = await asyncio.to_thread(history.chat_ids, project_id=project_id)
        chat_ids = list(
            dict.fromkeys(
                [str(chat["id"]) for chat in project_chats if chat.get("id")] + recovered_chat_ids
            )
        )
        async with cleanup_foreground_work(
            chat_ids=chat_ids, project_id=project_id
        ) as active_chat_ids:
            chat_ids = list(dict.fromkeys([*chat_ids, *active_chat_ids]))
            await cancel_background_jobs(project_id=project_id)
            for chat_id in chat_ids:
                # Some older jobs have only a chat id. Cancel those too before
                # clearing the project so they cannot repopulate its stores.
                await cancel_background_jobs(chat_id=chat_id)
            await close_sessions(chat_ids)
            clear_live_chat_state(chat_ids)

            def delete_project_data() -> None:
                projects.delete(project_id)
                chats.delete_for_project(project_id)
                history.clear(project_id=project_id)
                for chat_id in chat_ids:
                    artifacts.clear(chat_id)
                    handoffs.clear(chat_id)
                console.clear_for_project(chat_ids)

            await asyncio.to_thread(delete_project_data)
        return {"ok": True}

    @router.post("/api/fs/pick")
    async def pick_directory() -> dict[str, object]:
        try:
            path = await asyncio.to_thread(_pick_directory_sync)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return {
            "path": (path.rstrip("/") or "/") if path else None,
            "cancelled": not bool(path),
        }

    @router.get("/api/project/info")
    async def project_info(path: str) -> dict[str, object]:
        try:
            root = await asyncio.to_thread(resolve_workdir, path)
        except (FileNotFoundError, NotADirectoryError) as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        is_git = (root / ".git").exists()
        branch, file_count = await asyncio.gather(
            asyncio.to_thread(_git_branch, root) if is_git else asyncio.sleep(0, result=None),
            asyncio.to_thread(_file_count, root),
        )
        return {
            "path": str(root),
            "name": root.name,
            "exists": True,
            "is_git": is_git,
            "branch": branch,
            "file_count": file_count,
        }

    return router
