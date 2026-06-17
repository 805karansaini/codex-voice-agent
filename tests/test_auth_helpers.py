import unittest
import subprocess
import tempfile
from pathlib import Path

from fastapi import HTTPException

from backend.app.main import (
    _artifact_content_type,
    _bearer_token,
    _chat_context,
    _chat_export_markdown,
    _changed_files_from_status,
    _doctor_checks,
    _has_history_filter,
    _has_file_changes,
    _is_false_tool_claim,
    _is_local_host,
    _markdown_filename,
    _project_briefing,
    _resolve_scoped_workdir,
)
import backend.app.main as main
from backend.app.history import ArtifactStore, CodexHandoffStore, HistoryStore, ProjectStore


class AuthHelperTests(unittest.TestCase):
    def test_bearer_token_parses_valid_header(self) -> None:
        self.assertEqual(_bearer_token("Bearer secret-token"), "secret-token")

    def test_bearer_token_rejects_other_schemes(self) -> None:
        self.assertIsNone(_bearer_token("Basic abc"))
        self.assertIsNone(_bearer_token(None))

    def test_local_host_detection_is_narrow(self) -> None:
        self.assertTrue(_is_local_host("127.0.0.1"))
        self.assertTrue(_is_local_host("::1"))
        self.assertFalse(_is_local_host("192.168.1.4"))

    def test_artifact_content_type_keeps_command_output_as_text(self) -> None:
        self.assertEqual(_artifact_content_type("- item\n| pipe in shell output\n`literal`"), "text")

    def test_artifact_content_type_detects_markdown_and_diff(self) -> None:
        self.assertEqual(_artifact_content_type("## Summary\n\n- [x] Done"), "markdown")
        self.assertEqual(_artifact_content_type("diff --git a/a.txt b/a.txt\n@@ -1 +1 @@"), "diff")

    def test_file_change_detection_handles_stream_event_shapes(self) -> None:
        self.assertTrue(_has_file_changes([{"item_type": "fileChange"}]))
        self.assertTrue(_has_file_changes([{"event": {"item_type": "fileChange"}}]))
        self.assertFalse(_has_file_changes([{"item_type": "commandExecution"}]))

    def test_changed_files_from_git_status(self) -> None:
        status = " M backend/app/main.py\nR  old.txt -> new.txt\n?? notes.md\n"
        self.assertEqual(
            _changed_files_from_status(status),
            ["backend/app/main.py", "new.txt", "notes.md"],
        )

    def test_history_filter_requires_specific_scope(self) -> None:
        self.assertFalse(_has_history_filter(None, None, None))
        self.assertFalse(_has_history_filter("", "  ", None))
        self.assertTrue(_has_history_filter(None, None, "chat-1"))

    def test_false_tool_claim_detector_requires_no_codex_use(self) -> None:
        self.assertTrue(_is_false_tool_claim("I'll check the files now.", used_codex=False))
        self.assertTrue(_is_false_tool_claim("Calling run_codex_task.", used_codex=False))
        self.assertFalse(_is_false_tool_claim("I checked the files.", used_codex=True))
        self.assertFalse(_is_false_tool_claim("This is a general answer.", used_codex=False))

    def test_chat_export_markdown_includes_messages_and_artifacts(self) -> None:
        markdown = _chat_export_markdown(
            chat={"id": "chat-1", "projectId": "project-1", "title": "Fix login"},
            rows=[
                {"role": "user", "text": "Please fix login", "meta": {}},
                {
                    "role": "assistant",
                    "text": "Done.",
                    "meta": {
                        "artifacts": [
                            {"title": "Patch", "summary": "Changed auth handling"},
                        ]
                    },
                },
            ],
            artifact_rows=[
                {
                    "title": "Diff",
                    "summary": "One file changed",
                    "content": "diff --git a/app.py b/app.py\n@@ -1 +1 @@",
                    "content_type": "diff",
                }
            ],
        )

        self.assertIn("# Fix login", markdown)
        self.assertIn("### User\n\nPlease fix login", markdown)
        self.assertIn("### Assistant\n\nDone.", markdown)
        self.assertIn("- Artifact: **Patch**", markdown)
        self.assertIn("```diff\ndiff --git", markdown)

    def test_markdown_filename_is_safe(self) -> None:
        self.assertEqual(_markdown_filename("Fix login: auth/session?"), "fix-login-auth-session.md")

    def test_doctor_checks_include_required_setup_items(self) -> None:
        checks = _doctor_checks()
        names = {str(check["name"]) for check in checks}

        self.assertTrue(
            {"Google API key", "API token", "Git", "Codex login", "Default work folder", "Codex SDK"}.issubset(names)
        )
        self.assertTrue(all("ok" in check and "message" in check and "fix" in check for check in checks))

    def test_scoped_workdir_allows_project_subdirectories(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            subdir = root / "packages" / "api"
            subdir.mkdir(parents=True)
            old_projects = main.projects
            try:
                main.projects = ProjectStore(Path(tmp) / "projects.json")
                main.projects.upsert(
                    {"id": "project-1", "name": "Repo", "path": str(root), "color": "blue", "createdAt": 1}
                )

                self.assertEqual(
                    _resolve_scoped_workdir(str(subdir), project_id="project-1"),
                    str(subdir.resolve()),
                )
            finally:
                main.projects = old_projects

    def test_scoped_workdir_rejects_paths_outside_project(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            outside = Path(tmp) / "other"
            root.mkdir()
            outside.mkdir()
            old_projects = main.projects
            try:
                main.projects = ProjectStore(Path(tmp) / "projects.json")
                main.projects.upsert(
                    {"id": "project-1", "name": "Repo", "path": str(root), "color": "blue", "createdAt": 1}
                )

                with self.assertRaises(HTTPException):
                    _resolve_scoped_workdir(str(outside), project_id="project-1")
            finally:
                main.projects = old_projects

    def test_project_briefing_summarizes_git_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(["git", "init", "-b", "main"], cwd=root, check=True, capture_output=True)
            subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True)
            subprocess.run(["git", "config", "user.name", "Test User"], cwd=root, check=True)
            (root / "README.md").write_text("hello\n", encoding="utf-8")
            subprocess.run(["git", "add", "README.md"], cwd=root, check=True)
            subprocess.run(["git", "commit", "-m", "Initial commit"], cwd=root, check=True, capture_output=True)
            (root / "README.md").write_text("hello\nchanged\n", encoding="utf-8")

            briefing = _project_briefing(str(root))

            self.assertIn("Current git branch: main", briefing)
            self.assertIn("M README.md", briefing)
            self.assertIn("Initial commit", briefing)

    def test_chat_context_includes_pending_codex_handoff(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            old_history = main.history
            old_artifacts = main.artifacts
            old_handoffs = main.codex_handoffs
            try:
                main.history = HistoryStore(Path(tmp) / "history.json")
                main.artifacts = ArtifactStore(Path(tmp) / "history.json")
                main.codex_handoffs = CodexHandoffStore(Path(tmp) / "history.json")
                main.codex_handoffs.create(
                    chat_id="chat-1",
                    project_id="project-1",
                    workdir=str(Path(tmp)),
                    user_text="Fix reconnect handling",
                    tool_name="run_codex_task",
                    codex_status="completed",
                    result_summary="Codex changed the reconnect handling.",
                    result_artifact_id="artifact-1",
                    codex_turn_id="turn-1",
                    codex_thread_id="thread-1",
                    artifact_ids=["artifact-1"],
                )

                context = _chat_context("chat-1", str(Path(tmp)))

                self.assertIn("Important recent Codex handoffs", context)
                self.assertIn("Fix reconnect handling", context)
                self.assertIn("Codex status: completed", context)
                self.assertIn("Artifact reference: artifact-1", context)
                self.assertIn("instead of saying no work was done", context)
            finally:
                main.history = old_history
                main.artifacts = old_artifacts
                main.codex_handoffs = old_handoffs


if __name__ == "__main__":
    unittest.main()
