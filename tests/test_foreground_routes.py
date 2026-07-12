import asyncio
import threading
from collections.abc import AsyncIterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from backend.app import main
from backend.app.services.foreground_activity import ForegroundActivityRegistry


class RecordingRegistry(ForegroundActivityRegistry):
    def __init__(self) -> None:
        super().__init__()
        self.scopes: list[tuple[str | None, str | None, str | None]] = []
        self.activity_started = asyncio.Event()

    def activity(
        self,
        *,
        chat_id: str | None = None,
        project_id: str | None = None,
        workdir: str | None = None,
        owner: asyncio.Task[Any] | None = None,
    ):
        self.scopes.append((chat_id, project_id, workdir))
        self.activity_started.set()
        return super().activity(
            chat_id=chat_id,
            project_id=project_id,
            workdir=workdir,
            owner=owner,
        )


class FakeBackgroundJobs:
    async def cancel_and_remove(self, **_scope: str | None) -> list[str]:
        return []


class FakeHistory:
    def __init__(self, stream_cancelled: asyncio.Event | None = None) -> None:
        self.rows: list[tuple[str, str, dict[str, object]]] = []
        self.stream_cancelled = stream_cancelled

    def append(self, role: str, text: str, meta: dict[str, object]) -> None:
        self.rows.append((role, text, meta))

    def chat_ids(self, **_scope: str | None) -> list[str]:
        return ["chat-1"]

    def clear(self, **_scope: str | None) -> None:
        if self.stream_cancelled is not None:
            assert self.stream_cancelled.is_set()
        self.rows.clear()


class FakeScopedStore:
    def clear(self, _chat_id: str) -> None:
        pass

    def pending_completion_for_chat(self, _chat_id: str) -> list[dict[str, object]]:
        return []

    def acknowledge(self, _handoff_ids: list[str]) -> None:
        pass


class FakeConsole:
    def clear(self, _chat_id: str) -> None:
        pass

    def clear_for_project(self, _chat_ids: list[str]) -> None:
        pass


class FakeChats:
    def delete(self, _chat_id: str) -> None:
        pass


class FakeWebSocket:
    def __init__(self, payloads: list[dict[str, object]]) -> None:
        self.payloads = list(payloads)
        self.sent: list[dict[str, object]] = []
        self.accepted = False
        self.closed = False

    async def accept(self) -> None:
        self.accepted = True

    async def receive_json(self) -> dict[str, object]:
        if self.payloads:
            return self.payloads.pop(0)
        await asyncio.Future()
        raise AssertionError("unreachable")

    async def send_json(self, payload: dict[str, object]) -> None:
        self.sent.append(payload)

    async def close(self, **_kwargs: object) -> None:
        self.closed = True


class FakeLiveSession:
    async def send_realtime_input(self, **_kwargs: object) -> None:
        pass

    async def send_tool_response(self, **_kwargs: object) -> None:
        pass

    async def send_client_content(self, **_kwargs: object) -> None:
        pass

    async def receive(self) -> AsyncIterator[Any]:
        await asyncio.Future()
        if False:
            yield None


class FakeLiveConnection:
    async def __aenter__(self) -> FakeLiveSession:
        return FakeLiveSession()

    async def __aexit__(self, *_args: object) -> None:
        pass


class FakeLiveClient:
    def __init__(self) -> None:
        self.aio = SimpleNamespace(
            live=SimpleNamespace(connect=lambda **_kwargs: FakeLiveConnection())
        )


def install_live_fakes(
    monkeypatch: pytest.MonkeyPatch,
    registry: RecordingRegistry,
    workdir: str,
) -> None:
    async def authorize(_websocket: object) -> bool:
        return True

    def client_config(
        payload: dict[str, object],
        *,
        current_project_id: str | None,
        current_chat_id: str | None,
        current_workdir: str,
    ) -> dict[str, str | None]:
        return {
            "project_id": str(payload.get("project_id") or "") or current_project_id,
            "chat_id": str(payload.get("chat_id") or "") or current_chat_id,
            "workdir": str(payload.get("workdir") or "") or current_workdir,
            "conversation_context": "context",
        }

    monkeypatch.setattr(main, "_foreground_activity", registry)
    monkeypatch.setattr(main, "_authorize_live_websocket", authorize)
    monkeypatch.setattr(main, "_live_client_config_from_payload", client_config)
    monkeypatch.setattr(main, "live_connect_config", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(main, "_write_model_context_packet", lambda **_kwargs: None)
    monkeypatch.setattr(main.genai, "Client", lambda **_kwargs: FakeLiveClient())
    monkeypatch.setattr(main.settings, "google_api_key", "test-key")
    monkeypatch.setattr(main.settings, "codex_default_workdir", workdir)
    monkeypatch.setattr(
        main,
        "codex_handoffs",
        SimpleNamespace(
            pending_completion_for_chat=lambda _chat_id: [],
            acknowledge=lambda _ids: None,
        ),
    )


@pytest.mark.asyncio
async def test_history_cleanup_cancels_stream_before_clearing_persistence(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    registry = ForegroundActivityRegistry()
    stream_started = asyncio.Event()
    stream_cancelled = asyncio.Event()
    fake_history = FakeHistory(stream_cancelled)

    async def stream(*_args: object, **_kwargs: object) -> AsyncIterator[dict[str, object]]:
        stream_started.set()
        try:
            await asyncio.Future()
        finally:
            stream_cancelled.set()
        if False:
            yield {}

    async def close_sessions(_chat_ids: list[str]) -> None:
        pass

    monkeypatch.setattr(main, "_foreground_activity", registry)
    monkeypatch.setattr(main, "_background_jobs", FakeBackgroundJobs())
    monkeypatch.setattr(main, "history", fake_history)
    monkeypatch.setattr(main, "artifacts", FakeScopedStore())
    monkeypatch.setattr(main, "codex_handoffs", FakeScopedStore())
    monkeypatch.setattr(main, "console", FakeConsole())
    monkeypatch.setattr(main, "close_codex_thread_sessions_for", close_sessions)
    monkeypatch.setattr(main, "_chat_context", lambda *_args: "context")
    monkeypatch.setattr(main, "_latest_artifact_replay", lambda *_args: None)
    monkeypatch.setattr(main, "_write_model_context_packet", lambda **_kwargs: None)
    monkeypatch.setattr(main, "ask_gemini_stream", stream)

    response = await main.chat_stream(
        main.ChatRequest(message="hello", workdir=str(tmp_path), chat_id="chat-1")
    )

    async def consume() -> None:
        async for _chunk in response.body_iterator:
            pass

    consumer = asyncio.create_task(consume())
    await stream_started.wait()
    assert fake_history.rows and fake_history.rows[0][0] == "user"

    assert await main.clear_history(chat_id="chat-1") == {"ok": True}

    assert consumer.cancelled()
    assert stream_cancelled.is_set()
    assert fake_history.rows == []
    assert registry._states == {}


@pytest.mark.asyncio
async def test_chat_delete_stops_active_live_websocket(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    registry = RecordingRegistry()
    websocket = FakeWebSocket([{"type": "config", "chat_id": "chat-1", "workdir": str(tmp_path)}])
    install_live_fakes(monkeypatch, registry, str(tmp_path))
    monkeypatch.setattr(main, "_background_jobs", FakeBackgroundJobs())
    monkeypatch.setattr(main, "history", FakeHistory())
    monkeypatch.setattr(main, "artifacts", FakeScopedStore())
    monkeypatch.setattr(main, "codex_handoffs", FakeScopedStore())
    monkeypatch.setattr(main, "console", FakeConsole())
    monkeypatch.setattr(main, "chats", FakeChats())

    async def close_session(_chat_id: str) -> None:
        pass

    monkeypatch.setattr(main, "close_codex_thread_session", close_session)
    live_task = asyncio.create_task(main.live_voice(websocket))  # type: ignore[arg-type]
    await asyncio.sleep(0)
    if live_task.done():
        live_task.result()
    await asyncio.wait_for(registry.activity_started.wait(), timeout=1)
    await asyncio.sleep(0)

    assert await asyncio.wait_for(main.delete_chat("chat-1"), timeout=1) == {"ok": True}

    assert live_task.cancelled()
    assert websocket.closed
    assert registry._states == {}


@pytest.mark.asyncio
async def test_chat_save_cannot_recreate_chat_during_deletion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    registry = ForegroundActivityRegistry()
    upsert_started = threading.Event()
    release_upsert = threading.Event()

    class BlockingChats(FakeChats):
        def __init__(self) -> None:
            self.items: dict[str, dict[str, object]] = {}

        def upsert(self, chat: dict[str, object]) -> dict[str, object]:
            upsert_started.set()
            assert release_upsert.wait(timeout=2)
            self.items[str(chat["id"])] = chat
            return chat

        def delete(self, chat_id: str) -> None:
            self.items.pop(chat_id, None)

    async def close_session(_chat_id: str) -> None:
        pass

    chat_store = BlockingChats()
    monkeypatch.setattr(main, "_foreground_activity", registry)
    monkeypatch.setattr(main, "_background_jobs", FakeBackgroundJobs())
    monkeypatch.setattr(main, "history", FakeHistory())
    monkeypatch.setattr(main, "artifacts", FakeScopedStore())
    monkeypatch.setattr(main, "codex_handoffs", FakeScopedStore())
    monkeypatch.setattr(main, "console", FakeConsole())
    monkeypatch.setattr(main, "chats", chat_store)
    monkeypatch.setattr(main, "close_codex_thread_session", close_session)

    save_task = asyncio.create_task(
        main.save_chat(
            main.ChatMetaRequest(
                id="chat-1",
                projectId="project-1",
                title="Renamed chat",
                createdAt=1,
            )
        )
    )
    assert await asyncio.to_thread(upsert_started.wait, 1)
    delete_task = asyncio.create_task(main.delete_chat("chat-1"))
    async with asyncio.timeout(1):
        while save_task.cancelling() == 0:
            await asyncio.sleep(0)
    assert not delete_task.done()

    release_upsert.set()
    await asyncio.gather(save_task, return_exceptions=True)
    assert save_task.cancelled()
    assert await delete_task == {"ok": True}
    assert "chat-1" not in chat_store.items
    assert registry._states == {}


@pytest.mark.asyncio
async def test_live_config_change_rebinds_activity_and_completion_scope(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    registry = RecordingRegistry()
    websocket = FakeWebSocket(
        [
            {"type": "config", "chat_id": "chat-1", "workdir": str(tmp_path)},
            {"type": "config", "chat_id": "chat-2", "workdir": str(tmp_path)},
            {"type": "close"},
        ]
    )
    install_live_fakes(monkeypatch, registry, str(tmp_path))

    await main.live_voice(websocket)  # type: ignore[arg-type]

    assert [scope[0] for scope in registry.scopes] == ["chat-1", "chat-2"]
    assert "chat-1" not in main._live_completion_subscribers
    assert "chat-2" not in main._live_completion_subscribers
    assert registry._states == {}
