import tempfile
import unittest
from pathlib import Path

from backend.app.gemini_agent import _resolve_tool_workdir


class GeminiWorkdirTests(unittest.TestCase):
    def test_tool_workdir_can_target_project_subdirectory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            subdir = root / "services" / "api"
            subdir.mkdir(parents=True)

            self.assertEqual(_resolve_tool_workdir(str(subdir), str(root), str(root)), str(subdir.resolve()))

    def test_tool_workdir_cannot_escape_project_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            outside = Path(tmp) / "outside"
            root.mkdir()
            outside.mkdir()

            with self.assertRaises(ValueError):
                _resolve_tool_workdir(str(outside), str(root), str(root))


if __name__ == "__main__":
    unittest.main()
