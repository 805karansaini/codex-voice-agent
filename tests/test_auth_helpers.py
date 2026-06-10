import unittest
import subprocess
import tempfile
from pathlib import Path

from backend.app.main import (
    _artifact_content_type,
    _bearer_token,
    _changed_files_from_status,
    _has_history_filter,
    _has_file_changes,
    _is_local_host,
    _project_briefing,
)


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


if __name__ == "__main__":
    unittest.main()
