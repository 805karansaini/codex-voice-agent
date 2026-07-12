import asyncio
import tempfile
import threading
import unittest
from pathlib import Path
from typing import Any, AsyncIterator

from backend.app.history import CodexHandoffStore, HistoryStore
from backend.app.services.background_jobs import (
    BackgroundJobService,
    CodexBackgroundJob,
    CodexStreamRunner,
    CreateHandoff,
)
from backend.app.settings import Settings


class FakeAppLog:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, object]]] = []

    def write(self, event: str, **payload: object) -> None:
        self.events.append((event, payload))


class BlockingHistoryStore(HistoryStore):
    def __init__(self, path: Path) -> None:
        super().__init__(path)
        self.append_started = threading.Event()
        self.append_release = threading.Event()

    def append(
        self,
        role: str,
        text: str,
        meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        self.append_started.set()
        if not self.append_release.wait(timeout=5):
            raise TimeoutError("History append was not released by the test")
        return super().append(role, text, meta)


def _create_tool_artifact(
    _chat_id: str | None,
    _message_id: str | None,
    title: str,
    content: object,
    source: str,
    workdir: str | None,
) -> dict[str, object] | None:
    if not content:
        return None
    return {
        "id": "artifact-1",
        "title": title,
        "content": str(content),
        "source": source,
        "workdir": workdir,
    }


def _create_change_artifact(
    _chat_id: str | None,
    _workdir: str | None,
    _events: list[object],
) -> dict[str, object] | None:
    return None


def _job(root: Path, job_id: str = "job-1", **overrides: Any) -> CodexBackgroundJob:
    values: dict[str, Any] = {
        "id": job_id,
        "task": "run tests",
        "enhanced_task": "run tests",
        "workdir": str(root),
        "project_id": "project-1",
        "chat_id": "chat-1",
    }
    values.update(overrides)
    return CodexBackgroundJob(**values)


def _service(
    root: Path,
    runner: CodexStreamRunner,
    *,
    create_handoff: CreateHandoff | None = None,
    max_terminal_jobs: int = 100,
    history: HistoryStore | None = None,
) -> tuple[BackgroundJobService, HistoryStore, FakeAppLog]:
    history_store = history or HistoryStore(root / "history.json")
    app_log = FakeAppLog()
    service = BackgroundJobService(
        settings=Settings(DATA_DIR=root),
        history=history_store,
        app_log=app_log,
        create_tool_artifact=_create_tool_artifact,
        create_change_review_artifact=_create_change_artifact,
        run_codex_stream=runner,
        create_handoff=create_handoff,
        max_terminal_jobs=max_terminal_jobs,
    )
    return service, history_store, app_log


class BackgroundJobTests(unittest.IsolatedAsyncioTestCase):
    async def test_background_job_persists_result_and_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            async def fake_stream(
                *_args: object, **_kwargs: object
            ) -> AsyncIterator[dict[str, Any]]:
                yield {
                    "type": "codex_event",
                    "method": "turn/started",
                    "summary": "Started",
                    "payload": {"live_only": True},
                }
                yield {
                    "type": "done",
                    "text": "Tests passed.",
                    "workdir": str(root),
                    "events": [
                        {
                            "type": "codex_event",
                            "method": "turn/completed",
                            "summary": "Finished",
                            "payload": {"live_only": True},
                        }
                    ],
                    "turn_id": "turn-1",
                    "thread_id": "thread-1",
                    "status": "completed",
                }

            service, history, _app_log = _service(root, fake_stream)
            job = _job(root)
            await service.store(job)

            await service.run(job.id)

            saved = await service.get(job.id)
            rows = history.list(chat_id="chat-1")

            assert saved is not None
            self.assertEqual(saved.status, "done")
            self.assertEqual(saved.result, "Tests passed.")
            self.assertEqual(saved.latest_status, "Codex completed the task.")
            self.assertIn("Started", saved.progress_updates)
            self.assertIn("Codex completed the task.", saved.progress_updates)
            self.assertEqual(saved.codex_thread_id, "thread-1")
            self.assertEqual(
                saved.codex_events,
                [{"method": "turn/completed", "summary": "Finished"}],
            )
            self.assertEqual(rows[-1]["role"], "assistant")
            self.assertEqual(rows[-1]["text"], "Tests passed.")
            self.assertEqual(rows[-1]["meta"]["background_job_id"], "job-1")
            self.assertEqual(rows[-1]["meta"]["codex_thread_id"], "thread-1")
            self.assertEqual(rows[0]["role"], "user")
            self.assertEqual(rows[0]["meta"]["source"], "direct")
            self.assertIs(rows[0]["meta"]["user_visible"], True)
            self.assertEqual(len(saved.artifacts), 1)

    async def test_background_request_visibility_tracks_its_source(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            async def completed_stream(
                *_args: object, **_kwargs: object
            ) -> AsyncIterator[dict[str, Any]]:
                yield {"type": "done", "text": "Finished.", "workdir": str(root)}

            service, history, _app_log = _service(root, completed_stream)
            direct_job = _job(root, "direct", chat_id="direct-chat", source="direct")
            voice_job = _job(root, "voice", chat_id="voice-chat", source="voice")

            await service.store(direct_job)
            await service.run(direct_job.id)
            await service.store(voice_job)
            await service.run(voice_job.id)

            direct_request = history.list(chat_id="direct-chat")[0]
            voice_request = history.list(chat_id="voice-chat")[0]
            self.assertIs(direct_request["meta"]["user_visible"], True)
            self.assertIs(voice_request["meta"]["user_visible"], False)

    async def test_missing_provider_status_uses_done_status_for_handoff(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            observed_statuses: list[tuple[str, str | None, str]] = []

            async def fake_stream(
                *_args: object, **_kwargs: object
            ) -> AsyncIterator[dict[str, Any]]:
                yield {
                    "type": "done",
                    "text": "Finished without a provider status.",
                    "workdir": str(root),
                }

            def create_handoff(job: CodexBackgroundJob) -> dict[str, object]:
                observed_statuses.append(
                    (job.status, job.codex_status, job.codex_status or job.status)
                )
                return {"id": "handoff-1"}

            service, _history, _app_log = _service(
                root,
                fake_stream,
                create_handoff=create_handoff,
            )
            job = _job(root)
            await service.store(job)

            await service.run(job.id)

            self.assertEqual(observed_statuses, [("done", None, "done")])
            self.assertEqual(job.status, "done")
            self.assertIsNone(job.codex_status)

    async def test_in_progress_events_are_compact(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            event_consumed = asyncio.Event()
            release = asyncio.Event()

            async def fake_stream(
                *_args: object, **_kwargs: object
            ) -> AsyncIterator[dict[str, Any]]:
                yield {
                    "type": "codex_event",
                    "method": "item/started",
                    "summary": "Running tests",
                    "item_type": "commandExecution",
                    "command": "pytest",
                    "payload": {"large": "live-only details"},
                }
                event_consumed.set()
                await release.wait()
                yield {"type": "error", "message": "Stopped for test"}

            service, _history, _app_log = _service(root, fake_stream)
            job = _job(root)
            await service.store(job)
            task = service.start(job.id)

            await event_consumed.wait()

            self.assertFalse(task.done())
            self.assertEqual(
                job.codex_events,
                [
                    {
                        "method": "item/started",
                        "summary": "Running tests",
                        "item_type": "commandExecution",
                        "command": "pytest",
                    }
                ],
            )
            release.set()
            await task
            self.assertEqual(job.status, "failed")

    async def test_close_cancels_owned_tasks_and_marks_jobs_failed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            started = asyncio.Event()
            stopped = asyncio.Event()
            wait_forever = asyncio.Event()

            async def blocked_stream(
                *_args: object, **_kwargs: object
            ) -> AsyncIterator[dict[str, Any]]:
                started.set()
                try:
                    await wait_forever.wait()
                finally:
                    stopped.set()
                if False:
                    yield {}

            service, _history, app_log = _service(root, blocked_stream)
            job = _job(root)
            queued_job = _job(root, "queued")
            await service.store(job)
            await service.store(queued_job)
            task = service.start(job.id)
            await started.wait()

            await service.close()

            self.assertTrue(stopped.is_set())
            self.assertTrue(task.cancelled())
            self.assertEqual(job.status, "failed")
            self.assertEqual(job.error, "Codex task was cancelled.")
            self.assertEqual(queued_job.status, "failed")
            self.assertEqual(queued_job.error, "Codex task was cancelled.")
            self.assertIn("codex_job.cancelled", [event for event, _payload in app_log.events])
            with self.assertRaises(RuntimeError):
                service.start(job.id)

    async def test_service_can_open_for_a_new_application_lifespan(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            async def completed_stream(
                *_args: object, **_kwargs: object
            ) -> AsyncIterator[dict[str, Any]]:
                yield {"type": "done", "text": "Ready again.", "workdir": str(root)}

            service, _history, _app_log = _service(root, completed_stream)
            await service.close()
            service.open()

            job = _job(root, "reopened")
            task = await service.store_and_start(job)
            await task

            self.assertEqual(job.status, "done")
            await service.close()

    async def test_chat_cleanup_waits_for_completion_write_then_removes_scoped_jobs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            history = BlockingHistoryStore(root / "history.json")

            async def completed_stream(
                *_args: object, **_kwargs: object
            ) -> AsyncIterator[dict[str, Any]]:
                yield {
                    "type": "done",
                    "text": "This result must not reappear after deletion.",
                    "workdir": str(root),
                    "status": "completed",
                }

            service, _history, _app_log = _service(
                root,
                completed_stream,
                history=history,
            )
            running_job = _job(root, chat_id="chat-a")
            retained_job = _job(root, "retained", chat_id="chat-a", status="done")
            unrelated_job = _job(root, "unrelated", chat_id="chat-b", status="done")
            for job in (retained_job, unrelated_job):
                await service.store(job)
            task = await service.store_and_start(running_job)
            self.assertTrue(await asyncio.to_thread(history.append_started.wait, 1))

            cleanup = asyncio.create_task(service.cancel_and_remove(chat_id="chat-a"))
            await asyncio.sleep(0)

            self.assertFalse(cleanup.done())
            task.cancel()
            await asyncio.sleep(0)
            self.assertFalse(cleanup.done())
            history.append_release.set()
            removed = await cleanup

            self.assertEqual(set(removed), {"job-1", "retained"})
            self.assertTrue(task.cancelled())
            self.assertEqual(running_job.status, "failed")
            self.assertEqual(running_job.error, "Codex task was cancelled.")
            self.assertIsNone(await service.get(running_job.id))
            self.assertIsNone(await service.get(retained_job.id))
            self.assertIsNotNone(await service.get(unrelated_job.id))
            self.assertTrue(history.list(chat_id="chat-a"))

            await asyncio.to_thread(history.clear, chat_id="chat-a")
            await asyncio.sleep(0.05)

            self.assertFalse(history.list(chat_id="chat-a"))

    async def test_project_cleanup_cancels_active_jobs_and_removes_project_records(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            started = asyncio.Event()
            stopped = asyncio.Event()
            wait_forever = asyncio.Event()

            async def blocked_stream(
                *_args: object, **_kwargs: object
            ) -> AsyncIterator[dict[str, Any]]:
                started.set()
                try:
                    await wait_forever.wait()
                finally:
                    stopped.set()
                if False:
                    yield {}

            service, _history, _app_log = _service(root, blocked_stream)
            active_job = _job(root, project_id="project-a")
            retained_job = _job(
                root,
                "retained",
                chat_id="chat-2",
                project_id="project-a",
                status="failed",
            )
            unrelated_job = _job(
                root,
                "unrelated",
                chat_id="chat-3",
                project_id="project-b",
            )
            for job in (active_job, retained_job, unrelated_job):
                await service.store(job)
            task = service.start(active_job.id)
            await started.wait()

            removed = await service.cancel_and_remove(project_id="project-a")

            self.assertEqual(set(removed), {"job-1", "retained"})
            self.assertTrue(stopped.is_set())
            self.assertTrue(task.cancelled())
            self.assertEqual(active_job.status, "failed")
            self.assertEqual(active_job.error, "Codex task was cancelled.")
            self.assertIsNone(await service.get(active_job.id))
            self.assertIsNone(await service.get(retained_job.id))
            self.assertIsNotNone(await service.get(unrelated_job.id))
            with self.assertRaises(ValueError):
                await service.cancel_and_remove()

    async def test_workdir_cleanup_waits_for_write_before_history_can_be_cleared(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "target"
            other = root / "other"
            target.mkdir()
            other.mkdir()
            history = BlockingHistoryStore(root / "history.json")

            async def completed_stream(
                *_args: object, **_kwargs: object
            ) -> AsyncIterator[dict[str, Any]]:
                yield {"type": "done", "text": "Finished.", "workdir": str(target)}

            service, _history, _app_log = _service(
                root,
                completed_stream,
                history=history,
            )
            target_job = _job(root, workdir=str(target))
            unrelated_job = _job(root, "unrelated", workdir=str(other), status="done")
            await service.store(target_job)
            await service.store(unrelated_job)
            task = service.start(target_job.id)
            self.assertTrue(await asyncio.to_thread(history.append_started.wait, 1))

            cleanup = asyncio.create_task(service.cancel_and_remove(workdir=str(target)))
            await asyncio.sleep(0)
            self.assertFalse(cleanup.done())
            history.append_release.set()
            self.assertEqual(await cleanup, [target_job.id])

            self.assertTrue(task.cancelled())
            self.assertIsNone(await service.get(target_job.id))
            self.assertIsNotNone(await service.get(unrelated_job.id))
            await asyncio.to_thread(history.clear, workdir=str(target))
            self.assertFalse(history.list(workdir=str(target)))

    async def test_terminal_job_retention_is_bounded_without_pruning_active_jobs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            async def unused_stream(
                *_args: object, **_kwargs: object
            ) -> AsyncIterator[dict[str, Any]]:
                if False:
                    yield {}

            service, _history, _app_log = _service(
                root,
                unused_stream,
                max_terminal_jobs=2,
            )
            for index in range(1, 4):
                timestamp = f"2026-01-01T00:00:0{index}+00:00"
                await service.store(
                    _job(
                        root,
                        f"done-{index}",
                        status="done",
                        created_at=timestamp,
                        updated_at=timestamp,
                    )
                )
            await service.store(_job(root, "active", status="running"))

            self.assertIsNone(await service.get("done-1"))
            self.assertIsNotNone(await service.get("done-2"))
            self.assertIsNotNone(await service.get("done-3"))
            self.assertIsNotNone(await service.get("active"))

            removed = await service.prune_terminal_jobs(limit=1)

            self.assertEqual(removed, ["done-2"])
            self.assertIsNotNone(await service.get("done-3"))
            self.assertIsNotNone(await service.get("active"))


class CompletionReceiptTests(unittest.TestCase):
    def test_completion_receipt_must_match_live_chat(self) -> None:
        from backend.app import main

        with tempfile.TemporaryDirectory() as tmp:
            old_handoffs = main.codex_handoffs
            main.codex_handoffs = CodexHandoffStore(Path(tmp) / "history.json")
            handoff = main.codex_handoffs.create(
                chat_id="chat-a",
                project_id="project-1",
                workdir=tmp,
                user_text="run tests",
                tool_name="run_codex_task",
                codex_status="completed",
                result_summary="Tests passed.",
                result_artifact_id=None,
                codex_turn_id=None,
                codex_thread_id=None,
                artifact_ids=[],
            )
            main.codex_handoffs.mark_delivery(
                handoff["id"], "background_completion_pending", acknowledged=False
            )
            try:
                self.assertFalse(main._acknowledge_background_completion("chat-b", handoff["id"]))
                rejected = main.codex_handoffs.get(handoff["id"])
                self.assertIsNotNone(rejected)
                assert rejected is not None
                self.assertEqual(rejected["delivery_state"], "background_completion_pending")
                self.assertTrue(main._acknowledge_background_completion("chat-a", handoff["id"]))
                received = main.codex_handoffs.get(handoff["id"])
                self.assertIsNotNone(received)
                assert received is not None
                self.assertEqual(received["delivery_state"], "background_completion_received")
            finally:
                main.codex_handoffs = old_handoffs


if __name__ == "__main__":
    unittest.main()
