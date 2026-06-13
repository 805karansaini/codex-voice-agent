import tempfile
import unittest
from pathlib import Path

from backend.app.main import _is_gemini_disconnect_cleanup_exception
from backend.app.live_logging import JsonlEventLogger


class JsonlEventLoggerTests(unittest.TestCase):
    def test_log_rotation_keeps_configured_backups(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "events.jsonl"
            logger = JsonlEventLogger(path, max_bytes=1, backup_count=2)

            logger.write("first", value="a")
            logger.write("second", value="b")
            logger.write("third", value="c")

            self.assertTrue(path.exists())
            self.assertTrue(path.with_name("events.jsonl.1").exists())
            self.assertTrue(path.with_name("events.jsonl.2").exists())
            self.assertFalse(path.with_name("events.jsonl.3").exists())


class GeminiDisconnectCleanupTests(unittest.TestCase):
    def test_matches_known_google_genai_cleanup_runtime_error(self) -> None:
        exc = RuntimeError("generator didn't stop after throw()")

        self.assertTrue(_is_gemini_disconnect_cleanup_exception(exc))

    def test_rejects_other_runtime_errors(self) -> None:
        exc = RuntimeError("live session failed")

        self.assertFalse(_is_gemini_disconnect_cleanup_exception(exc))

    def test_rejects_non_runtime_errors_with_same_message(self) -> None:
        exc = ValueError("generator didn't stop after throw()")

        self.assertFalse(_is_gemini_disconnect_cleanup_exception(exc))


if __name__ == "__main__":
    unittest.main()
