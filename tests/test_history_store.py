import tempfile
import unittest
from pathlib import Path

from backend.app.history import HistoryStore, ProjectStore


class HistoryStoreTests(unittest.TestCase):
    def test_append_uses_unique_ids_when_timestamps_match(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = HistoryStore(Path(tmp) / "history.json")

            first = store.append("user", "hello", {"chat_id": "chat-1"})
            second = store.append("assistant", "hi", {"chat_id": "chat-1"})

            self.assertNotEqual(first["id"], second["id"])
            self.assertEqual([item["id"] for item in store.list(chat_id="chat-1")], [first["id"], second["id"]])


class ProjectStoreTests(unittest.TestCase):
    def test_upsert_rejects_second_project_for_same_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = ProjectStore(Path(tmp) / "projects.json")
            store.upsert({"id": "one", "path": "/tmp/example", "name": "One"})

            with self.assertRaises(ValueError):
                store.upsert({"id": "two", "path": "/tmp/example", "name": "Two"})


if __name__ == "__main__":
    unittest.main()
