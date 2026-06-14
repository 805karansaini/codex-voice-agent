import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app import main
from backend.app.history import ArtifactStore, HistoryStore


class FakeAppLog:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, object]]] = []

    def write(self, event: str, **payload: object) -> None:
        self.events.append((event, payload))


class BackgroundJobTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        main._codex_jobs.clear()

    async def asyncTearDown(self) -> None:
        main._codex_jobs.clear()

    async def test_background_job_persists_result_and_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            old_history = main.history
            old_artifacts = main.artifacts
            old_app_log = main.app_log
            main.history = HistoryStore(root / "history.json")
            main.artifacts = ArtifactStore(root / "history.json")
            main.app_log = FakeAppLog()
            job = main._CodexBackgroundJob(
                id="job-1",
                task="run tests",
                enhanced_task="run tests",
                workdir=str(root),
                project_id="project-1",
                chat_id="chat-1",
            )
            await main._store_job(job)

            async def fake_stream(*_args: object, **_kwargs: object):
                yield {"type": "codex_event", "method": "turn/started", "summary": "Started"}
                yield {
                    "type": "done",
                    "text": "Tests passed.",
                    "workdir": str(root),
                    "events": [{"type": "codex_event", "method": "turn/completed"}],
                    "turn_id": "turn-1",
                    "thread_id": "thread-1",
                    "status": "completed",
                }

            try:
                with patch.object(main, "run_codex_stream_with_timer", fake_stream):
                    await main._run_codex_background_job("job-1")

                saved = await main._get_job("job-1")
                rows = main.history.list(chat_id="chat-1")

                assert saved is not None
                self.assertEqual(saved.status, "done")
                self.assertEqual(saved.result, "Tests passed.")
                self.assertEqual(saved.codex_thread_id, "thread-1")
                self.assertEqual(rows[-1]["role"], "assistant")
                self.assertEqual(rows[-1]["text"], "Tests passed.")
                self.assertEqual(rows[-1]["meta"]["background_job_id"], "job-1")
                self.assertEqual(rows[-1]["meta"]["codex_thread_id"], "thread-1")
                self.assertEqual(len(saved.artifacts), 1)
            finally:
                main.history = old_history
                main.artifacts = old_artifacts
                main.app_log = old_app_log


if __name__ == "__main__":
    unittest.main()
