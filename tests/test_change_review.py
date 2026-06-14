import subprocess
import tempfile
import unittest
from pathlib import Path

from backend.app.codex_runner import create_pre_codex_checkpoint
from backend.app.main import _commit_changed_files, _revert_changed_files


def _git(root: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=root, check=True, capture_output=True, text=True)


class ChangeReviewTests(unittest.TestCase):
    def test_pre_codex_checkpoint_commits_dirty_repo(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _git(root, "init", "-b", "main")
            _git(root, "config", "user.email", "test@example.com")
            _git(root, "config", "user.name", "Test User")
            (root / "app.py").write_text("print('original')\n", encoding="utf-8")
            _git(root, "add", "app.py")
            _git(root, "commit", "-m", "Initial")

            (root / "app.py").write_text("print('changed')\n", encoding="utf-8")
            (root / "notes.md").write_text("new note\n", encoding="utf-8")

            result = create_pre_codex_checkpoint(str(root), "Checkpoint before test")

            self.assertTrue(result.created)
            self.assertTrue(result.commit)
            self.assertEqual(result.message, "Checkpoint before test")
            status = subprocess.run(
                ["git", "status", "--short"],
                cwd=root,
                check=True,
                capture_output=True,
                text=True,
            ).stdout
            self.assertEqual(status, "")
            log = subprocess.run(
                ["git", "log", "-1", "--pretty=%s"],
                cwd=root,
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
            self.assertEqual(log, "Checkpoint before test")

    def test_pre_codex_checkpoint_skips_clean_repo(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _git(root, "init", "-b", "main")
            _git(root, "config", "user.email", "test@example.com")
            _git(root, "config", "user.name", "Test User")
            (root / "app.py").write_text("print('original')\n", encoding="utf-8")
            _git(root, "add", "app.py")
            _git(root, "commit", "-m", "Initial")

            result = create_pre_codex_checkpoint(str(root))

            self.assertFalse(result.created)
            self.assertIsNone(result.commit)
            self.assertEqual(result.skipped_reason, "clean")

    def test_commit_changed_files_commits_only_selected_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _git(root, "init", "-b", "main")
            _git(root, "config", "user.email", "test@example.com")
            _git(root, "config", "user.name", "Test User")
            (root / "app.py").write_text("print('original')\n", encoding="utf-8")
            (root / "notes.md").write_text("original\n", encoding="utf-8")
            _git(root, "add", "app.py", "notes.md")
            _git(root, "commit", "-m", "Initial")

            (root / "app.py").write_text("print('changed')\n", encoding="utf-8")
            (root / "notes.md").write_text("changed\n", encoding="utf-8")

            result = _commit_changed_files(str(root), ["app.py"], "Apply Codex changes")

            self.assertEqual(result["committed_files"], ["app.py"])
            self.assertTrue(result["commit"])
            status = subprocess.run(
                ["git", "status", "--short"],
                cwd=root,
                check=True,
                capture_output=True,
                text=True,
            ).stdout
            self.assertIn(" M notes.md", status)
            self.assertNotIn("app.py", status)

    def test_commit_changed_files_rejects_empty_commit(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _git(root, "init", "-b", "main")
            _git(root, "config", "user.email", "test@example.com")
            _git(root, "config", "user.name", "Test User")
            (root / "app.py").write_text("print('original')\n", encoding="utf-8")
            _git(root, "add", "app.py")
            _git(root, "commit", "-m", "Initial")

            with self.assertRaises(ValueError):
                _commit_changed_files(str(root), ["app.py"], "No changes")

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
