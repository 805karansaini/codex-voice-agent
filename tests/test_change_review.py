import subprocess
import tempfile
import unittest
from pathlib import Path

from backend.app.main import _revert_changed_files


def _git(root: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=root, check=True, capture_output=True, text=True)


class ChangeReviewTests(unittest.TestCase):
    def test_revert_changed_files_restores_tracked_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _git(root, "init", "-b", "main")
            _git(root, "config", "user.email", "test@example.com")
            _git(root, "config", "user.name", "Test User")
            target = root / "app.py"
            target.write_text("print('original')\n", encoding="utf-8")
            _git(root, "add", "app.py")
            _git(root, "commit", "-m", "Initial")

            target.write_text("print('changed')\n", encoding="utf-8")

            result = _revert_changed_files(str(root), ["app.py"])

            self.assertEqual(result["reverted_files"], ["app.py"])
            self.assertEqual(target.read_text(encoding="utf-8"), "print('original')\n")

    def test_revert_changed_files_removes_untracked_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _git(root, "init", "-b", "main")
            target = root / "scratch.txt"
            target.write_text("temporary\n", encoding="utf-8")

            result = _revert_changed_files(str(root), ["scratch.txt"])

            self.assertEqual(result["reverted_files"], ["scratch.txt"])
            self.assertFalse(target.exists())

    def test_revert_changed_files_rejects_path_escape(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _git(root, "init", "-b", "main")

            with self.assertRaises(ValueError):
                _revert_changed_files(str(root), ["../outside.txt"])


if __name__ == "__main__":
    unittest.main()
