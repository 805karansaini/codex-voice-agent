import asyncio
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator, Awaitable, Callable, Coroutine, cast

import pytest
from fastapi.routing import APIRoute

from backend.app.routes.workspace import ProjectRequest, create_router
from backend.app.services.foreground_activity import ForegroundActivityRegistry


class FakeProjects:
    def __init__(self, calls: list[str]) -> None:
        self.calls = calls

    def list(self) -> list[dict[str, object]]:
        return []

    def upsert(self, project: dict[str, object]) -> dict[str, object]:
        return project

    def delete(self, project_id: str) -> None:
        self.calls.append(f"projects.delete:{project_id}")


class FakeChats:
    def __init__(self, calls: list[str]) -> None:
        self.calls = calls

    def list(self, project_id: str | None = None) -> list[dict[str, object]]:
        self.calls.append(f"chats.list:{project_id}")
        return [
            {"id": "stored-chat"},
            {"id": "shared-chat"},
        ]

    def delete_for_project(self, project_id: str) -> None:
        self.calls.append(f"chats.delete:{project_id}")


class FakeHistory:
    def __init__(self, calls: list[str]) -> None:
        self.calls = calls

    def chat_ids(
        self,
        project_id: str | None = None,
        workdir: str | None = None,
        chat_id: str | None = None,
    ) -> list[str]:
        self.calls.append(f"history.chat_ids:{project_id}:{workdir}:{chat_id}")
        return ["recovered-chat", "shared-chat"]

    def clear(
        self,
        project_id: str | None = None,
        workdir: str | None = None,
        chat_id: str | None = None,
    ) -> None:
        self.calls.append(f"history.clear:{project_id}:{workdir}:{chat_id}")


class FakeChatScopedStore:
    def __init__(self, name: str, calls: list[str]) -> None:
        self.name = name
        self.calls = calls

    def clear(self, chat_id: str | None = None) -> None:
        self.calls.append(f"{self.name}.clear:{chat_id}")


class FakeConsole:
    def __init__(self, calls: list[str]) -> None:
        self.calls = calls

    def clear_for_project(self, chat_ids: list[str]) -> None:
        self.calls.append(f"console.clear:{','.join(chat_ids)}")


@pytest.mark.asyncio
async def test_delete_project_cleans_stored_and_history_recovered_chats_in_order() -> None:
    calls: list[str] = []

    async def close_sessions(chat_ids: list[str]) -> None:
        calls.append(f"sessions.close:{','.join(chat_ids)}")

    async def cancel_background_jobs(
        *,
        chat_id: str | None = None,
        project_id: str | None = None,
        workdir: str | None = None,
    ) -> list[str]:
        calls.append(f"jobs.cancel:{chat_id}:{project_id}:{workdir}")
        return []

    @asynccontextmanager
    async def cleanup_foreground_work(
        *,
        chat_ids: list[str] | tuple[str, ...] = (),
        project_id: str | None = None,
        workdir: str | None = None,
    ) -> AsyncIterator[list[str]]:
        calls.append(f"foreground.begin:{','.join(chat_ids)}:{project_id}:{workdir}")
        try:
            yield [*chat_ids, "active-chat"]
        finally:
            calls.append("foreground.end")

    def clear_live_chat_state(chat_ids: list[str]) -> None:
        calls.append(f"live.clear:{','.join(chat_ids)}")

    router = create_router(
        projects=FakeProjects(calls),
        chats=FakeChats(calls),
        history=FakeHistory(calls),
        artifacts=FakeChatScopedStore("artifacts", calls),
        handoffs=FakeChatScopedStore("handoffs", calls),
        console=FakeConsole(calls),
        project_root=lambda _project_id: Path("/tmp/project"),
        resolve_workdir=lambda workdir: Path(workdir),
        close_sessions=close_sessions,
        cancel_background_jobs=cancel_background_jobs,
        foreground_activity=ForegroundActivityRegistry().activity,
        cleanup_foreground_work=cleanup_foreground_work,
        clear_live_chat_state=clear_live_chat_state,
    )
    delete_route = next(
        route
        for route in router.routes
        if isinstance(route, APIRoute)
        and route.path == "/api/projects/{project_id}"
        and "DELETE" in route.methods
    )
    delete_project = cast(
        Callable[[str], Awaitable[dict[str, object]]],
        delete_route.endpoint,
    )

    result = await delete_project("project-1")

    assert result == {"ok": True}
    assert calls == [
        "chats.list:project-1",
        "history.chat_ids:project-1:None:None",
        "foreground.begin:stored-chat,shared-chat,recovered-chat:project-1:None",
        "jobs.cancel:None:project-1:None",
        "jobs.cancel:stored-chat:None:None",
        "jobs.cancel:shared-chat:None:None",
        "jobs.cancel:recovered-chat:None:None",
        "jobs.cancel:active-chat:None:None",
        "sessions.close:stored-chat,shared-chat,recovered-chat,active-chat",
        "live.clear:stored-chat,shared-chat,recovered-chat,active-chat",
        "projects.delete:project-1",
        "chats.delete:project-1",
        "history.clear:project-1:None:None",
        "artifacts.clear:stored-chat",
        "handoffs.clear:stored-chat",
        "artifacts.clear:shared-chat",
        "handoffs.clear:shared-chat",
        "artifacts.clear:recovered-chat",
        "handoffs.clear:recovered-chat",
        "artifacts.clear:active-chat",
        "handoffs.clear:active-chat",
        "console.clear:stored-chat,shared-chat,recovered-chat,active-chat",
        "foreground.end",
    ]


@pytest.mark.asyncio
async def test_project_save_cannot_recreate_project_during_deletion() -> None:
    calls: list[str] = []
    upsert_started = threading.Event()
    release_upsert = threading.Event()

    class BlockingProjects(FakeProjects):
        def __init__(self) -> None:
            super().__init__(calls)
            self.items: dict[str, dict[str, object]] = {}

        def upsert(self, project: dict[str, object]) -> dict[str, object]:
            upsert_started.set()
            assert release_upsert.wait(timeout=2)
            self.items[str(project["id"])] = project
            return project

        def delete(self, project_id: str) -> None:
            super().delete(project_id)
            self.items.pop(project_id, None)

    async def close_sessions(_chat_ids: list[str]) -> None:
        pass

    async def cancel_background_jobs(
        *,
        chat_id: str | None = None,
        project_id: str | None = None,
        workdir: str | None = None,
    ) -> list[str]:
        return []

    registry = ForegroundActivityRegistry()
    project_store = BlockingProjects()
    router = create_router(
        projects=project_store,
        chats=FakeChats(calls),
        history=FakeHistory(calls),
        artifacts=FakeChatScopedStore("artifacts", calls),
        handoffs=FakeChatScopedStore("handoffs", calls),
        console=FakeConsole(calls),
        project_root=lambda _project_id: Path("/tmp/project"),
        resolve_workdir=Path,
        close_sessions=close_sessions,
        cancel_background_jobs=cancel_background_jobs,
        foreground_activity=registry.activity,
        cleanup_foreground_work=registry.cleanup,
        clear_live_chat_state=lambda _chat_ids: None,
    )
    save_route = next(
        route
        for route in router.routes
        if isinstance(route, APIRoute) and route.path == "/api/projects" and "POST" in route.methods
    )
    delete_route = next(
        route
        for route in router.routes
        if isinstance(route, APIRoute)
        and route.path == "/api/projects/{project_id}"
        and "DELETE" in route.methods
    )
    save_project = cast(
        Callable[[ProjectRequest], Coroutine[Any, Any, dict[str, object]]], save_route.endpoint
    )
    delete_project = cast(
        Callable[[str], Coroutine[Any, Any, dict[str, object]]], delete_route.endpoint
    )

    save_task = asyncio.create_task(
        save_project(
            ProjectRequest(
                id="project-1",
                name="Project",
                path="/tmp/project",
                color="blue",
                createdAt=1,
            )
        )
    )
    assert await asyncio.to_thread(upsert_started.wait, 1)
    delete_task = asyncio.create_task(delete_project("project-1"))
    async with asyncio.timeout(1):
        while save_task.cancelling() == 0:
            await asyncio.sleep(0)
    assert not delete_task.done()

    release_upsert.set()
    await asyncio.gather(save_task, return_exceptions=True)
    assert save_task.cancelled()
    assert await delete_task == {"ok": True}
    assert "project-1" not in project_store.items
    assert registry._states == {}
