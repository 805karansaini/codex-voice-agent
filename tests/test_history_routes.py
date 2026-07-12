from typing import Any

import pytest

from backend.app import main


class FakeBackgroundJobs:
    def __init__(self, calls: list[tuple[str, object]]) -> None:
        self.calls = calls

    async def cancel_and_remove(self, **scope: str | None) -> list[str]:
        self.calls.append(("jobs.cancel", scope))
        return []


class FakeHistory:
    def __init__(self, calls: list[tuple[str, object]]) -> None:
        self.calls = calls

    def chat_ids(self, **scope: str | None) -> list[str]:
        self.calls.append(("history.chat_ids", scope))
        return ["history-chat"]

    def clear(self, **scope: str | None) -> None:
        self.calls.append(("history.clear", scope))


class FakeScopedStore:
    def __init__(self, name: str, calls: list[tuple[str, object]]) -> None:
        self.name = name
        self.calls = calls

    def clear(self, chat_id: str) -> None:
        self.calls.append((f"{self.name}.clear", chat_id))


class FakeConsole:
    def __init__(self, calls: list[tuple[str, object]]) -> None:
        self.calls = calls

    def clear_for_project(self, chat_ids: list[str]) -> None:
        self.calls.append(("console.clear", chat_ids))


@pytest.mark.asyncio
async def test_workdir_history_clear_resets_recovered_chat_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, Any]] = []

    async def close_sessions(chat_ids: list[str]) -> None:
        calls.append(("sessions.close", chat_ids))

    monkeypatch.setattr(main, "_background_jobs", FakeBackgroundJobs(calls))
    monkeypatch.setattr(main, "history", FakeHistory(calls))
    monkeypatch.setattr(main, "artifacts", FakeScopedStore("artifacts", calls))
    monkeypatch.setattr(main, "codex_handoffs", FakeScopedStore("handoffs", calls))
    monkeypatch.setattr(main, "console", FakeConsole(calls))
    monkeypatch.setattr(main, "close_codex_thread_sessions_for", close_sessions)
    main._live_resumption_handles["history-chat"] = "resume-token"
    main._live_completion_subscribers["history-chat"] = set()

    try:
        result = await main.clear_history(workdir=" /tmp/project ")

        scope = {"project_id": None, "workdir": "/tmp/project", "chat_id": None}
        assert result == {"ok": True}
        assert calls == [
            ("history.chat_ids", scope),
            ("jobs.cancel", scope),
            (
                "jobs.cancel",
                {"chat_id": "history-chat"},
            ),
            ("sessions.close", ["history-chat"]),
            ("history.clear", scope),
            ("artifacts.clear", "history-chat"),
            ("handoffs.clear", "history-chat"),
            ("console.clear", ["history-chat"]),
        ]
        assert "history-chat" not in main._live_resumption_handles
        assert "history-chat" not in main._live_completion_subscribers
    finally:
        main._live_resumption_handles.pop("history-chat", None)
        main._live_completion_subscribers.pop("history-chat", None)
