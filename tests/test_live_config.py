import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import cast
from unittest.mock import patch

from google.genai import types

from backend.app.gemini_agent import SYSTEM_INSTRUCTION, live_connect_config
from backend.app.history import HistoryStore
from backend.app.settings import Settings
from backend.app import main


class FakeLiveLog:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, object]]] = []

    def write(self, event: str, **payload: object) -> None:
        self.events.append((event, payload))


class LiveClientConfigTests(unittest.TestCase):
    def test_resolves_payload_and_builds_context(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            root.mkdir()
            with patch.object(main, "_chat_context", return_value="recent context"):
                config = main._live_client_config_from_payload(
                    {"project_id": "project-1", "chat_id": "chat-1", "workdir": str(root)},
                    current_project_id=None,
                    current_chat_id=None,
                    current_workdir=str(root),
                )

            self.assertEqual(config["project_id"], "project-1")
            self.assertEqual(config["chat_id"], "chat-1")
            self.assertEqual(config["workdir"], str(root.resolve()))
            self.assertEqual(config["conversation_context"], "recent context")

    def test_preserves_existing_ids_when_payload_omits_them(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            root.mkdir()
            with patch.object(main, "_chat_context", return_value="existing context"):
                config = main._live_client_config_from_payload(
                    {"type": "config"},
                    current_project_id="project-1",
                    current_chat_id="chat-1",
                    current_workdir=str(root),
                )

            self.assertEqual(config["project_id"], "project-1")
            self.assertEqual(config["chat_id"], "chat-1")
            self.assertEqual(config["workdir"], str(root.resolve()))
            self.assertEqual(config["conversation_context"], "existing context")


class LiveModelConfigTests(unittest.TestCase):
    def test_routine_local_work_is_authorized_without_confirmation(self) -> None:
        self.assertIn("Treat ordinary local-work instructions as authorization to proceed.", SYSTEM_INSTRUCTION)
        self.assertIn("for confirmation before routine inspection, edits, tests, builds, or commits.", SYSTEM_INSTRUCTION)

    def test_default_31_model_remains_sync_tool_model(self) -> None:
        settings = Settings(GEMINI_MODEL="gemini-3.1-flash-live-preview")

        config = live_connect_config(settings, "/tmp/project", "recent context")

        tools = cast(list[types.Tool], config.tools)
        declarations = cast(list[types.FunctionDeclaration], tools[0].function_declarations)
        declaration = declarations[0]
        self.assertEqual(declaration.name, "run_codex_task")
        self.assertIsNone(declaration.behavior)
        compression = config.context_window_compression
        self.assertIsNotNone(compression)
        assert compression is not None
        self.assertEqual(compression.trigger_tokens, 25000)
        self.assertIsNotNone(compression.sliding_window)
        assert compression.sliding_window is not None
        self.assertEqual(compression.sliding_window.target_tokens, 10000)
        resumption = config.session_resumption
        self.assertIsNotNone(resumption)
        assert resumption is not None
        self.assertIsNone(resumption.transparent)

    def test_session_resumption_passes_handle_without_transparent_flag(self) -> None:
        settings = Settings(GEMINI_MODEL="gemini-3.1-flash-live-preview")

        config = live_connect_config(settings, "/tmp/project", "recent context", "handle-1")

        resumption = config.session_resumption
        self.assertIsNotNone(resumption)
        assert resumption is not None
        self.assertEqual(resumption.handle, "handle-1")
        self.assertIsNone(resumption.transparent)


class LiveTurnStateTests(unittest.TestCase):
    def test_persists_turn_with_codex_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = HistoryStore(Path(tmp) / "history.json")
            turn_state = main._LiveTurnState()
            turn_state.input_text_chunks.append("Please check this")
            turn_state.output_text_chunks.append("Done.")
            turn_state.input_audio_bytes = 3200
            turn_state.audio_chunks.append(b"audio")
            turn_state.add_codex_result(
                events=[{"type": "codex_event", "turn_id": "turn-1"}],
                turn_id="turn-1",
                thread_id="thread-1",
                status="completed",
                artifacts_for_result=[{"id": "artifact-1"}],
            )

            turn_state.persist(
                history_store=store,
                workdir="/tmp/project",
                project_id="project-1",
                chat_id="chat-1",
                fallback_assistant_text="Done.",
            )

            rows = store.list(chat_id="chat-1")
            self.assertEqual([row["role"] for row in rows], ["user", "assistant"])
            self.assertEqual(rows[0]["text"], "Please check this")
            self.assertEqual(rows[1]["text"], "Done.")
            self.assertEqual(rows[1]["meta"]["codex_turn_id"], "turn-1")
            self.assertEqual(rows[1]["meta"]["codex_thread_id"], "thread-1")
            self.assertEqual(rows[1]["meta"]["codex_status"], "completed")
            self.assertEqual(rows[1]["meta"]["artifacts"], [{"id": "artifact-1"}])
            self.assertEqual(rows[1]["meta"]["gemini_live_usage"]["input_audio_bytes"], 3200)
            self.assertEqual(rows[1]["meta"]["gemini_live_usage"]["output_audio_bytes"], 5)
            self.assertTrue(rows[1]["meta"]["gemini_live_usage"]["estimated"])

    def test_reset_clears_per_turn_state(self) -> None:
        turn_state = main._LiveTurnState()
        turn_state.audio_chunks.append(b"audio")
        turn_state.input_audio_bytes = 3200
        turn_state.input_text_chunks.append("user")
        turn_state.output_text_chunks.append("assistant")
        turn_state.streamed_audio = True
        turn_state.add_codex_result(
            events=[{"type": "codex_event"}],
            turn_id="turn-1",
            thread_id="thread-1",
            status="completed",
            artifacts_for_result=[{"id": "artifact-1"}],
        )

        turn_state.reset()

        self.assertFalse(turn_state.audio_chunks)
        self.assertEqual(turn_state.input_audio_bytes, 0)
        self.assertFalse(turn_state.input_text_chunks)
        self.assertFalse(turn_state.output_text_chunks)
        self.assertFalse(turn_state.streamed_audio)
        self.assertFalse(turn_state.codex_events)
        self.assertIsNone(turn_state.codex_turn_id)
        self.assertIsNone(turn_state.codex_thread_id)
        self.assertIsNone(turn_state.codex_status)
        self.assertFalse(turn_state.artifacts)


class LiveToolCallRequestTests(unittest.TestCase):
    def test_builds_codex_request_from_tool_args(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            root.mkdir()
            request = main._live_tool_call_request(
                name="run_codex_task",
                args={"task": "check git status", "workdir": str(root)},
                user_text="ignored transcript",
                project_id=None,
                fallback_workdir=str(root),
            )

            self.assertEqual(request.name, "run_codex_task")
            self.assertFalse(request.is_end_conversation)
            self.assertEqual(request.task, "check git status")
            self.assertIn("check git status", request.enhanced_task)
            self.assertEqual(request.workdir, str(root.resolve()))

    def test_falls_back_to_user_text_for_missing_task(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            root.mkdir()
            request = main._live_tool_call_request(
                name="run_codex_task",
                args={},
                user_text="summarize this project",
                project_id=None,
                fallback_workdir=str(root),
            )

            self.assertEqual(request.task, "summarize this project")
            self.assertEqual(request.workdir, str(root.resolve()))

    def test_marks_end_conversation_without_codex_task(self) -> None:
        request = main._live_tool_call_request(
            name="end_conversation",
            args={"task": "should not run"},
            user_text="bye",
            project_id=None,
            fallback_workdir="/tmp/project",
        )

        self.assertTrue(request.is_end_conversation)
        self.assertEqual(request.task, "")
        self.assertEqual(request.enhanced_task, "")
        self.assertEqual(request.workdir, "/tmp/project")

    def test_marks_status_request_without_codex_task(self) -> None:
        request = main._live_tool_call_request(
            name="get_codex_status",
            args={"task": "run something"},
            user_text="is codex still running?",
            project_id=None,
            fallback_workdir="/tmp/project",
        )

        self.assertFalse(request.is_end_conversation)
        self.assertEqual(request.name, "get_codex_status")
        self.assertEqual(request.task, "")
        self.assertEqual(request.enhanced_task, "")
        self.assertEqual(request.workdir, "/tmp/project")


class LiveCodexToolTests(unittest.IsolatedAsyncioTestCase):
    def test_background_result_speech_prompt_preserves_result_detail(self) -> None:
        prompt = main._background_result_speech_prompt("Day one: inspect. Day two: fix.")

        self.assertIn("Read the following result aloud", prompt)
        self.assertIn("Do not say only that it is done", prompt)
        self.assertIn("Day one: inspect. Day two: fix.", prompt)

    def test_codex_status_returns_completed_result_detail(self) -> None:
        old_jobs = dict(main._codex_jobs)
        try:
            main._codex_jobs.clear()
            main._codex_jobs["job-1"] = main._CodexBackgroundJob(
                id="job-1",
                task="read plan",
                enhanced_task="read plan",
                workdir="/tmp/project",
                project_id="project-1",
                chat_id="chat-1",
                status="done",
                result=(
                    "Days 1-2 are a fast revision block. "
                    "Day 1: OOP basics. Day 2: SOLID. Day 3: LLD diagrams."
                ),
                codex_status="completed",
            )

            status = main._codex_status_for_chat("chat-1")

            self.assertIn("Use this exact completed Codex result", status)
            self.assertIn("Day 1: OOP basics", status)
            self.assertIn("Day 3: LLD diagrams", status)
        finally:
            main._codex_jobs.clear()
            main._codex_jobs.update(old_jobs)

    def test_codex_status_does_not_truncate_completed_result(self) -> None:
        old_jobs = dict(main._codex_jobs)
        try:
            main._codex_jobs.clear()
            full_result = "first detail\n" + ("important detail\n" * 800) + "final detail"
            main._codex_jobs["job-1"] = main._CodexBackgroundJob(
                id="job-1",
                task="read plan",
                enhanced_task="read plan",
                workdir="/tmp/project",
                project_id="project-1",
                chat_id="chat-1",
                status="done",
                result=full_result,
                codex_status="completed",
            )

            status = main._codex_status_for_chat("chat-1")

            self.assertIn("first detail", status)
            self.assertIn("final detail", status)
        finally:
            main._codex_jobs.clear()
            main._codex_jobs.update(old_jobs)

    async def test_live_codex_background_start_returns_running_job(self) -> None:
        sent: list[dict[str, object]] = []
        live_log = FakeLiveLog()
        request = main._LiveToolCallRequest(
            name="run_codex_task",
            is_end_conversation=False,
            task="run tests",
            enhanced_task="run tests",
            workdir="/tmp/project",
        )
        job = main._CodexBackgroundJob(
            id="job-1",
            task="run tests",
            enhanced_task="run tests",
            workdir="/tmp/project",
            project_id="project-1",
            chat_id="chat-1",
            status="running",
        )

        async def fake_enqueue(**_kwargs: object) -> object:
            return job

        async def send_json(payload: dict[str, object]) -> None:
            sent.append(payload)

        with patch.object(main, "_enqueue_codex_background_job", fake_enqueue):
            result = await main._start_live_codex_background_job(
                request=request,
                project_id="project-1",
                chat_id="chat-1",
                call_name="run_codex_task",
                send_json=send_json,
                live_log=live_log,  # type: ignore[arg-type]
            )

        self.assertEqual(result.status, "running")
        self.assertEqual(result.job_id, "job-1")
        self.assertEqual(result.background_status, "running")
        self.assertEqual(sent[0]["type"], "tool_result")
        self.assertEqual(sent[0]["background_job_id"], "job-1")
        self.assertEqual(sent[0]["codex_status"], "running")

    def test_codex_status_for_chat_reports_latest_running_job(self) -> None:
        old_jobs = dict(main._codex_jobs)
        try:
            main._codex_jobs.clear()
            job = main._CodexBackgroundJob(
                id="job-1",
                task="run tests",
                enhanced_task="run tests",
                workdir="/tmp/project",
                project_id="project-1",
                chat_id="chat-1",
                status="running",
                latest_status="Codex is running tests.",
            )
            main._codex_jobs[job.id] = job

            self.assertIn("Codex is still running", main._codex_status_for_chat("chat-1"))
            self.assertIn("Codex is running tests", main._codex_status_for_chat("chat-1"))
        finally:
            main._codex_jobs.clear()
            main._codex_jobs.update(old_jobs)

    async def test_streams_codex_events_and_returns_done_result(self) -> None:
        sent: list[dict[str, object]] = []
        live_log = FakeLiveLog()
        request = main._LiveToolCallRequest(
            name="run_codex_task",
            is_end_conversation=False,
            task="check status",
            enhanced_task="check status",
            workdir="/tmp/project",
        )

        async def fake_stream(*args: object, **kwargs: object):
            yield {"type": "codex_event", "turn_id": "turn-1", "thread_id": "thread-1"}
            yield {"type": "delta", "text": "partial"}
            yield {"type": "status", "message": "still running", "elapsed": 1.2}
            yield {
                "type": "done",
                "text": "final",
                "workdir": "/tmp/project/sub",
                "events": [{"type": "codex_event", "turn_id": "turn-2"}],
                "turn_id": "turn-2",
                "thread_id": "thread-2",
                "status": "completed",
            }

        async def send_json(payload: dict[str, object]) -> None:
            sent.append(payload)

        with patch.object(main, "run_codex_stream_with_timer", fake_stream):
            result = await main._run_live_codex_tool(
                request=request,
                settings_value=SimpleNamespace(),
                cancel_token=main.CancellationToken(),
                chat_id="chat-1",
                call_name="run_codex_task",
                send_json=send_json,
                live_log=live_log,  # type: ignore[arg-type]
                turn_gen=None,
            )

        self.assertEqual(result.response, "final")
        self.assertEqual(result.workdir, "/tmp/project/sub")
        self.assertEqual(result.events, [{"type": "codex_event", "turn_id": "turn-2"}])
        self.assertEqual(result.turn_id, "turn-2")
        self.assertEqual(result.thread_id, "thread-2")
        self.assertEqual(result.status, "completed")
        self.assertEqual(
            sent,
            [
                {
                    "type": "codex_event",
                    "event": {"type": "codex_event", "turn_id": "turn-1", "thread_id": "thread-1"},
                },
                {"type": "tool_progress", "name": "run_codex_task", "text": "partial"},
                {"type": "status", "message": "still running", "elapsed": 1.2},
            ],
        )
        self.assertEqual(live_log.events[0][0], "codex.done")

    async def test_streams_error_event_and_returns_error_result(self) -> None:
        sent: list[dict[str, object]] = []
        live_log = FakeLiveLog()
        request = main._LiveToolCallRequest(
            name="run_codex_task",
            is_end_conversation=False,
            task="fail",
            enhanced_task="fail",
            workdir="/tmp/project",
        )

        async def fake_stream(*args: object, **kwargs: object):
            yield {"type": "error", "message": "boom"}

        async def send_json(payload: dict[str, object]) -> None:
            sent.append(payload)

        with patch.object(main, "run_codex_stream_with_timer", fake_stream):
            result = await main._run_live_codex_tool(
                request=request,
                settings_value=SimpleNamespace(),
                cancel_token=main.CancellationToken(),
                chat_id="chat-1",
                call_name="run_codex_task",
                send_json=send_json,
                live_log=live_log,  # type: ignore[arg-type]
                turn_gen=None,
            )

        self.assertEqual(result.response, "Error: boom")
        self.assertEqual(
            sent, [{"type": "tool_call_failed", "name": "run_codex_task", "message": "boom"}]
        )
        self.assertEqual(live_log.events[0][0], "codex.error")


if __name__ == "__main__":
    unittest.main()
