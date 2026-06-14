import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app import codex_runner
from backend.app.settings import Settings


class FakeThread:
    def __init__(self, thread_id: str) -> None:
        self.id = thread_id

    async def turn(self, input: object, **kwargs: object) -> object:
        raise AssertionError("turn should not run in these tests")


class FakeAsyncCodex:
    starts: list[dict[str, object]] = []
    resumes: list[tuple[str, dict[str, object]]] = []
    fail_resume = False

    def __init__(self, config: object) -> None:
        self.config = config
        self.closed = False

    async def __aenter__(self) -> "FakeAsyncCodex":
        return self

    async def close(self) -> None:
        self.closed = True

    async def thread_start(self, **kwargs: object) -> FakeThread:
        self.starts.append(kwargs)
        return FakeThread(f"started-{len(self.starts)}")

    async def thread_resume(self, thread_id: str, **kwargs: object) -> FakeThread:
        self.resumes.append((thread_id, kwargs))
        if self.fail_resume:
            raise RuntimeError("cannot resume")
        return FakeThread(thread_id)


class FakeCodexConfig:
    def __init__(self, **kwargs: object) -> None:
        self.kwargs = kwargs


class CodexThreadPersistenceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        FakeAsyncCodex.starts = []
        FakeAsyncCodex.resumes = []
        FakeAsyncCodex.fail_resume = False

    async def asyncTearDown(self) -> None:
        await codex_runner.close_codex_thread_sessions()

    def _settings(self, root: Path) -> Settings:
        return Settings(
            DATA_DIR=root,
            HISTORY_FILE="history.json",
            CODEX_DEFAULT_WORKDIR=str(root),
            CODEX_APPROVAL_MODE="auto-review",
            CODEX_SANDBOX_MODE="workspace-write",
        )

    def _fake_module(self) -> types.SimpleNamespace:
        return types.SimpleNamespace(
            AsyncCodex=FakeAsyncCodex,
            CodexConfig=FakeCodexConfig,
            ApprovalMode=types.SimpleNamespace(deny_all="deny_all", auto_review="auto_review"),
            Sandbox=types.SimpleNamespace(full_access="full_access", workspace_write="workspace_write"),
        )

    async def test_resumes_saved_thread_after_session_cache_is_empty(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            settings = self._settings(root)
            fake_module = self._fake_module()

            with patch.dict(sys.modules, {"openai_codex": fake_module}):
                first = await codex_runner._get_thread_session(str(root), settings, "chat-1")
                self.assertEqual(first.thread.id, "started-1")
                await codex_runner.close_codex_thread_sessions()

                second = await codex_runner._get_thread_session(str(root), settings, "chat-1")

            self.assertEqual(second.thread.id, "started-1")
            self.assertEqual(FakeAsyncCodex.resumes[0][0], "started-1")
            self.assertEqual(len(FakeAsyncCodex.starts), 1)

    async def test_starts_new_thread_when_resume_fails_and_updates_mapping(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            settings = self._settings(root)
            fake_module = self._fake_module()

            with patch.dict(sys.modules, {"openai_codex": fake_module}):
                first = await codex_runner._get_thread_session(str(root), settings, "chat-1")
                self.assertEqual(first.thread.id, "started-1")
                await codex_runner.close_codex_thread_sessions()
                FakeAsyncCodex.fail_resume = True

                second = await codex_runner._get_thread_session(str(root), settings, "chat-1")

            self.assertEqual(second.thread.id, "started-2")
            mapping = codex_runner._read_thread_mapping(settings, "chat-1")
            self.assertEqual(mapping["thread_id"] if mapping else None, "started-2")


if __name__ == "__main__":
    unittest.main()
