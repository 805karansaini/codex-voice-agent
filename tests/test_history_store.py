import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from backend.app.history import ArtifactStore, HistoryStore, ProjectStore


class HistoryStoreTests(unittest.TestCase):
    def test_append_uses_unique_ids_when_timestamps_match(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = HistoryStore(Path(tmp) / "history.json")

            first = store.append("user", "hello", {"chat_id": "chat-1"})
            second = store.append("assistant", "hi", {"chat_id": "chat-1"})

            self.assertNotEqual(first["id"], second["id"])
            self.assertEqual([item["id"] for item in store.list(chat_id="chat-1")], [first["id"], second["id"]])

    def test_history_scope_columns_are_queryable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = HistoryStore(Path(tmp) / "history.json")

            store.append(
                "user",
                "hello",
                {"chat_id": "chat-1", "project_id": "project-1", "workdir": "/tmp/project-1"},
            )

            with sqlite3.connect(store.path) as conn:
                row = conn.execute("SELECT chat_id, project_id, workdir FROM history").fetchone()
            self.assertEqual(row, ("chat-1", "project-1", "/tmp/project-1"))
            self.assertEqual(len(store.list(project_id="project-1")), 1)
            self.assertEqual(len(store.list(workdir="/tmp/project-1")), 1)

    def test_existing_history_rows_backfill_scope_columns(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "history.sqlite3"
            with sqlite3.connect(path) as conn:
                conn.execute(
                    """
                    CREATE TABLE history (
                        id TEXT PRIMARY KEY,
                        role TEXT NOT NULL,
                        text TEXT NOT NULL,
                        meta_json TEXT NOT NULL,
                        created_at TEXT NOT NULL
                    )
                    """
                )
                conn.execute(
                    "INSERT INTO history (id, role, text, meta_json, created_at) VALUES (?, ?, ?, ?, ?)",
                    (
                        "row-1",
                        "user",
                        "hello",
                        json.dumps({"chat_id": "chat-1", "project_id": "project-1", "workdir": "/tmp/project-1"}),
                        "2026-01-01T00:00:00+00:00",
                    ),
                )

            store = HistoryStore(Path(tmp) / "history.json")

            self.assertEqual([item["id"] for item in store.list(chat_id="chat-1")], ["row-1"])
            with sqlite3.connect(store.path) as conn:
                columns = {row[1] for row in conn.execute("PRAGMA table_info(history)")}
                row = conn.execute("SELECT chat_id, project_id, workdir FROM history").fetchone()
            self.assertTrue({"chat_id", "project_id", "workdir"}.issubset(columns))
            self.assertEqual(row, ("chat-1", "project-1", "/tmp/project-1"))

    def test_search_returns_matching_messages(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = HistoryStore(Path(tmp) / "history.json")
            store.append(
                "user",
                "Please fix the login redirect",
                {"chat_id": "chat-1", "project_id": "project-1", "workdir": "/tmp/project-1"},
            )
            store.append("assistant", "Unrelated", {"chat_id": "chat-2"})

            results = store.search("login")

            self.assertEqual(len(results), 1)
            self.assertEqual(results[0]["type"], "message")
            self.assertEqual(results[0]["chat_id"], "chat-1")
            self.assertIn("login", results[0]["snippet"])


class ArtifactStoreTests(unittest.TestCase):
    def test_search_returns_matching_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = ArtifactStore(Path(tmp) / "history.json")
            item = store.create(
                chat_id="chat-1",
                message_id=None,
                title="Auth diff",
                summary="Changed login redirect",
                content="diff --git a/app.py b/app.py",
                content_type="diff",
                source="git_diff",
                workdir="/tmp/project-1",
            )

            results = store.search("redirect")

            self.assertEqual(len(results), 1)
            self.assertEqual(results[0]["type"], "artifact")
            self.assertEqual(results[0]["id"], item["id"])
            self.assertEqual(results[0]["chat_id"], "chat-1")


class ProjectStoreTests(unittest.TestCase):
    def test_upsert_rejects_second_project_for_same_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = ProjectStore(Path(tmp) / "projects.json")
            store.upsert({"id": "one", "path": "/tmp/example", "name": "One"})

            with self.assertRaises(ValueError):
                store.upsert({"id": "two", "path": "/tmp/example", "name": "Two"})


if __name__ == "__main__":
    unittest.main()
