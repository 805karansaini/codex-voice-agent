import tempfile
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
