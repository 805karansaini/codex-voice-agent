import asyncio
import sys
import tempfile
import threading
import types
import unittest
from collections.abc import AsyncGenerator
from datetime import timedelta
from pathlib import Path
from typing import cast
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
    instances: list["FakeAsyncCodex"] = []
    fail_resume = False
    start_entered: asyncio.Event | None = None
    start_release: asyncio.Event | None = None

    def __init__(self, config: object) -> None:
        self.config = config
        self.closed = False
        self.instances.append(self)

    async def __aenter__(self) -> "FakeAsyncCodex":
        return self

    async def close(self) -> None:
        self.closed = True

    async def thread_start(self, **kwargs: object) -> FakeThread:
        self.starts.append(kwargs)
        start_number = len(self.starts)
        if self.start_entered is not None:
            self.start_entered.set()
        if self.start_release is not None:
            await asyncio.wait_for(self.start_release.wait(), timeout=5)
        return FakeThread(f"started-{start_number}")

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
        FakeAsyncCodex.instances = []
        FakeAsyncCodex.fail_resume = False
        FakeAsyncCodex.start_entered = None
        FakeAsyncCodex.start_release = None

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
            Sandbox=types.SimpleNamespace(
                full_access="full_access", workspace_write="workspace_write"
            ),
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

    async def test_cache_hit_closes_other_evicted_sessions_outside_registry_lock(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            settings = self._settings(root)
            fake_module = self._fake_module()

            with patch.dict(sys.modules, {"openai_codex": fake_module}):
                stale = await codex_runner._get_thread_session(str(root), settings, "stale-chat")
                reusable = await codex_runner._get_thread_session(
                    str(root), settings, "reusable-chat"
                )
                stale.last_used = (
                    codex_runner._now() - codex_runner._SESSION_IDLE_TTL - timedelta(seconds=1)
                )
                close_lock_states: list[bool] = []
                original_close = codex_runner._close_session

                async def close_and_record(session: codex_runner._ThreadSession) -> None:
                    close_lock_states.append(codex_runner._sessions_lock.locked())
                    await original_close(session)

                with patch.object(codex_runner, "_close_session", close_and_record):
                    result = await codex_runner._get_thread_session(
                        str(root), settings, "reusable-chat"
                    )

            self.assertIs(result, reusable)
            self.assertTrue(cast(FakeAsyncCodex, stale.codex).closed)
            self.assertFalse(cast(FakeAsyncCodex, reusable.codex).closed)
            self.assertEqual(close_lock_states, [False])

    async def test_concurrent_cache_fill_creates_one_session(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            settings = self._settings(root)
            fake_module = self._fake_module()

            with patch.dict(sys.modules, {"openai_codex": fake_module}):
                first, second = await asyncio.gather(
                    codex_runner._get_thread_session(str(root), settings, "shared-chat"),
                    codex_runner._get_thread_session(str(root), settings, "shared-chat"),
                )
                mapping = codex_runner._read_thread_mapping(settings, "shared-chat")

            self.assertIs(first, second)
            self.assertEqual(
                mapping["thread_id"] if mapping else None,
                first.thread.id,
            )
            self.assertEqual(len(FakeAsyncCodex.starts), 1)
            self.assertEqual(len(FakeAsyncCodex.instances), 1)
            self.assertFalse(FakeAsyncCodex.instances[0].closed)

    async def test_close_during_session_creation_waits_then_removes_created_session(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            settings = self._settings(root)
            fake_module = self._fake_module()
            FakeAsyncCodex.start_entered = asyncio.Event()
            FakeAsyncCodex.start_release = asyncio.Event()

            with (
                patch.dict(sys.modules, {"openai_codex": fake_module}),
                patch.object(codex_runner, "get_settings", return_value=settings),
            ):
                get_task = asyncio.create_task(
                    codex_runner._get_thread_session(str(root), settings, "closing-chat")
                )
                await asyncio.wait_for(FakeAsyncCodex.start_entered.wait(), timeout=1)

                close_task = asyncio.create_task(
                    codex_runner.close_codex_thread_session("closing-chat")
                )
                await asyncio.sleep(0)
                self.assertFalse(close_task.done())

                FakeAsyncCodex.start_release.set()
                session = await get_task
                await close_task

            self.assertIsNone(codex_runner._sessions.get("chat:closing-chat"))
            self.assertIsNone(codex_runner._read_thread_mapping(settings, "closing-chat"))
            self.assertTrue(session.closed)
            self.assertTrue(cast(FakeAsyncCodex, session.codex).closed)

    async def test_close_waits_for_mapping_publish_then_removes_session_and_mapping(self) -> None:
        class TrackingLifecycleLock:
            def __init__(self) -> None:
                self._lock = asyncio.Lock()
                self.acquire_count = 0
                self.second_acquire_started = asyncio.Event()

            async def __aenter__(self) -> "TrackingLifecycleLock":
                self.acquire_count += 1
                if self.acquire_count == 2:
                    self.second_acquire_started.set()
                await self._lock.acquire()
                return self

            async def __aexit__(
                self,
                _exc_type: object,
                _exc: object,
                _traceback: object,
            ) -> None:
                self._lock.release()

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            settings = self._settings(root)
            fake_module = self._fake_module()
            lifecycle_lock = TrackingLifecycleLock()
            publish_started = threading.Event()
            allow_publish = threading.Event()
            original_save = codex_runner._save_thread_mapping

            def blocking_save(
                save_settings: Settings,
                *,
                conversation_id: str,
                thread_id: str | None,
                workdir: str,
            ) -> None:
                publish_started.set()
                if not allow_publish.wait(timeout=5):
                    raise TimeoutError("test did not release mapping publish")
                original_save(
                    save_settings,
                    conversation_id=conversation_id,
                    thread_id=thread_id,
                    workdir=workdir,
                )

            with (
                patch.dict(sys.modules, {"openai_codex": fake_module}),
                patch.object(codex_runner, "_save_thread_mapping", blocking_save),
                patch.object(
                    codex_runner,
                    "_session_lifecycle_lock",
                    return_value=lifecycle_lock,
                ),
                patch.object(codex_runner, "get_settings", return_value=settings),
            ):
                get_task = asyncio.create_task(
                    codex_runner._get_thread_session(str(root), settings, "closing-chat")
                )
                self.assertTrue(await asyncio.to_thread(publish_started.wait, 5))

                close_task = asyncio.create_task(
                    codex_runner.close_codex_thread_session("closing-chat")
                )
                await asyncio.wait_for(
                    lifecycle_lock.second_acquire_started.wait(),
                    timeout=1,
                )
                self.assertFalse(close_task.done())
                allow_publish.set()

                session = await get_task
                await close_task

            mapping = codex_runner._read_thread_mapping(settings, "closing-chat")
            self.assertIsNone(mapping)
            self.assertTrue(cast(FakeAsyncCodex, session.codex).closed)

    async def test_thread_mapping_io_runs_outside_event_loop(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            settings = self._settings(root)
            fake_module = self._fake_module()
            event_loop_thread = threading.get_ident()
            calls: list[tuple[str, int]] = []

            def read_mapping(_settings: Settings, _conversation_id: str) -> None:
                calls.append(("read", threading.get_ident()))

            def save_mapping(_settings: Settings, **_kwargs: object) -> None:
                calls.append(("save", threading.get_ident()))

            def delete_mapping(_settings: Settings, _conversation_id: str | None) -> None:
                calls.append(("delete", threading.get_ident()))

            with (
                patch.dict(sys.modules, {"openai_codex": fake_module}),
                patch.object(codex_runner, "_read_thread_mapping", read_mapping),
                patch.object(codex_runner, "_save_thread_mapping", save_mapping),
                patch.object(codex_runner, "_delete_thread_mapping", delete_mapping),
                patch.object(codex_runner, "get_settings", return_value=settings),
            ):
                await codex_runner._get_thread_session(str(root), settings, "chat-1")
                await codex_runner.close_codex_thread_session("chat-1")

            self.assertEqual([name for name, _thread_id in calls], ["read", "save", "delete"])
            self.assertTrue(all(thread_id != event_loop_thread for _name, thread_id in calls))

    async def test_mapping_save_cancellation_waits_for_worker_to_finish(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            settings = self._settings(root)
            fake_module = self._fake_module()
            save_started = threading.Event()
            release_save = threading.Event()
            save_finished = threading.Event()
            original_save = codex_runner._save_thread_mapping

            def blocking_save(
                save_settings: Settings,
                *,
                conversation_id: str,
                thread_id: str | None,
                workdir: str,
            ) -> None:
                save_started.set()
                if not release_save.wait(timeout=5):
                    raise TimeoutError("test did not release mapping save")
                original_save(
                    save_settings,
                    conversation_id=conversation_id,
                    thread_id=thread_id,
                    workdir=workdir,
                )
                save_finished.set()

            with (
                patch.dict(sys.modules, {"openai_codex": fake_module}),
                patch.object(codex_runner, "_save_thread_mapping", blocking_save),
            ):
                get_task = asyncio.create_task(
                    codex_runner._get_thread_session(str(root), settings, "cancelled-chat")
                )
                self.assertTrue(await asyncio.to_thread(save_started.wait, 1))

                get_task.cancel()
                await asyncio.sleep(0)
                self.assertFalse(get_task.done())
                self.assertFalse(save_finished.is_set())

                release_save.set()
                with self.assertRaises(asyncio.CancelledError):
                    await get_task

            mapping = codex_runner._read_thread_mapping(settings, "cancelled-chat")
            self.assertTrue(save_finished.is_set())
            self.assertEqual(mapping["thread_id"] if mapping else None, "started-1")
            self.assertIsNone(codex_runner._sessions.get("chat:cancelled-chat"))
            self.assertTrue(FakeAsyncCodex.instances[0].closed)

    async def test_close_cannot_enter_between_session_lookup_and_turn_use(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            settings = self._settings(root)
            fake_module = self._fake_module()
            get_finished = asyncio.Event()
            release_get = asyncio.Event()
            stream_started = asyncio.Event()
            release_stream = asyncio.Event()
            original_get = codex_runner._get_thread_session_locked

            async def get_then_pause(
                workdir: str,
                get_settings: Settings,
                conversation_id: str,
                model: str | None = None,
                reasoning_effort: str | None = None,
            ) -> codex_runner._ThreadSession:
                session = await original_get(
                    workdir,
                    get_settings,
                    conversation_id,
                    model,
                    reasoning_effort,
                )
                get_finished.set()
                await release_get.wait()
                return session

            async def blocking_stream(*_args: object) -> AsyncGenerator[dict[str, object], None]:
                stream_started.set()
                await release_stream.wait()
                yield {"type": "done", "text": "complete"}

            async def consume_stream() -> list[dict[str, object]]:
                return [
                    event
                    async for event in codex_runner.run_codex_stream(
                        "prompt", str(root), settings, conversation_id="active-chat"
                    )
                ]

            with (
                patch.dict(sys.modules, {"openai_codex": fake_module}),
                patch.object(codex_runner, "_get_thread_session_locked", get_then_pause),
                patch.object(codex_runner, "_stream_turn", blocking_stream),
                patch.object(codex_runner, "get_settings", return_value=settings),
            ):
                stream_task = asyncio.create_task(consume_stream())
                await asyncio.wait_for(get_finished.wait(), timeout=1)
                session = codex_runner._sessions["chat:active-chat"]

                close_task = asyncio.create_task(
                    codex_runner.close_codex_thread_session("active-chat")
                )
                await asyncio.sleep(0)
                self.assertFalse(close_task.done())

                release_get.set()
                await asyncio.wait_for(stream_started.wait(), timeout=1)
                self.assertFalse(close_task.done())
                self.assertFalse(session.closed)

                release_stream.set()
                events = await stream_task
                await close_task

            self.assertEqual(events, [{"type": "done", "text": "complete"}])
            self.assertTrue(session.closed)
            self.assertTrue(cast(FakeAsyncCodex, session.codex).closed)

    async def test_closed_session_is_rejected_before_starting_a_turn(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            settings = self._settings(root)
            fake_module = self._fake_module()

            with patch.dict(sys.modules, {"openai_codex": fake_module}):
                session = await codex_runner._get_thread_session(str(root), settings, "closed-chat")
                await codex_runner._close_session(session)

                with patch.object(
                    codex_runner,
                    "_get_thread_session_locked",
                    return_value=session,
                ):
                    stream = codex_runner.run_codex_stream(
                        "prompt", str(root), settings, conversation_id="closed-chat"
                    )
                    with self.assertRaisesRegex(RuntimeError, "closed before the turn"):
                        await anext(stream)

    async def test_auto_checkpoint_runs_outside_event_loop(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            settings = Settings(
                DATA_DIR=root,
                HISTORY_FILE="history.json",
                CODEX_DEFAULT_WORKDIR=str(root),
                CODEX_AUTO_CHECKPOINT=True,
            )
            event_loop_thread = threading.get_ident()
            checkpoint_thread: int | None = None

            def create_checkpoint(_workdir: str) -> codex_runner.CodexCheckpoint:
                nonlocal checkpoint_thread
                checkpoint_thread = threading.get_ident()
                return codex_runner.CodexCheckpoint(False, None, "checkpoint", "clean")

            with patch.object(codex_runner, "create_pre_codex_checkpoint", create_checkpoint):
                stream = cast(
                    AsyncGenerator[dict[str, object], None],
                    codex_runner.run_codex_stream("prompt", str(root), settings),
                )
                event = await anext(stream)
                await stream.aclose()

            self.assertEqual(event["type"], "checkpoint")
            self.assertIsNotNone(checkpoint_thread)
            self.assertNotEqual(checkpoint_thread, event_loop_thread)

    async def test_auto_checkpoint_cancellation_waits_for_worker_to_finish(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            settings = Settings(
                DATA_DIR=root,
                HISTORY_FILE="history.json",
                CODEX_DEFAULT_WORKDIR=str(root),
                CODEX_AUTO_CHECKPOINT=True,
            )
            checkpoint_started = threading.Event()
            release_checkpoint = threading.Event()
            checkpoint_finished = threading.Event()

            def create_checkpoint(_workdir: str) -> codex_runner.CodexCheckpoint:
                checkpoint_started.set()
                if not release_checkpoint.wait(timeout=5):
                    raise TimeoutError("test did not release checkpoint")
                checkpoint_finished.set()
                return codex_runner.CodexCheckpoint(False, None, "checkpoint", "clean")

            with patch.object(codex_runner, "create_pre_codex_checkpoint", create_checkpoint):
                stream = cast(
                    AsyncGenerator[dict[str, object], None],
                    codex_runner.run_codex_stream("prompt", str(root), settings),
                )
                next_event = asyncio.create_task(anext(stream))
                self.assertTrue(await asyncio.to_thread(checkpoint_started.wait, 1))

                next_event.cancel()
                await asyncio.sleep(0)
                self.assertFalse(next_event.done())
                self.assertFalse(checkpoint_finished.is_set())

                release_checkpoint.set()
                with self.assertRaises(asyncio.CancelledError):
                    await next_event
                await stream.aclose()

            self.assertTrue(checkpoint_finished.is_set())


if __name__ == "__main__":
    unittest.main()
