import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from backend.app.history import (
    ArtifactStore,
    ChatStore,
    CodexHandoffStore,
    ConsoleStore,
    HistoryStore,
    ProjectStore,
    SQLiteDatabase,
)


class HistoryStoreTests(unittest.TestCase):
    def test_append_uses_unique_ids_when_timestamps_match(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = HistoryStore(Path(tmp) / "history.json")

            first = store.append("user", "hello", {"chat_id": "chat-1"})
            second = store.append("assistant", "hi", {"chat_id": "chat-1"})

            self.assertNotEqual(first["id"], second["id"])
            self.assertEqual(
                [item["id"] for item in store.list(chat_id="chat-1")], [first["id"], second["id"]]
            )

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

    def test_list_combines_all_provided_scope_filters(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = HistoryStore(Path(tmp) / "history.json")
            matching = store.append(
                "user",
                "matching",
                {
                    "chat_id": "chat-1",
                    "project_id": "project-1",
                    "workdir": "/tmp/project-1",
                },
            )
            store.append(
                "user",
                "different chat",
                {
                    "chat_id": "chat-2",
                    "project_id": "project-1",
                    "workdir": "/tmp/project-1",
                },
            )
            store.append(
                "user",
                "different project",
                {
                    "chat_id": "chat-1",
                    "project_id": "project-2",
                    "workdir": "/tmp/project-1",
                },
            )
            store.append(
                "user",
                "different workdir",
                {
                    "chat_id": "chat-1",
                    "project_id": "project-1",
                    "workdir": "/tmp/project-other",
                },
            )

            rows = store.list(
                project_id="project-1",
                workdir="/tmp/project-1",
                chat_id="chat-1",
            )

            self.assertEqual([item["id"] for item in rows], [matching["id"]])

    def test_chat_ids_returns_distinct_chats_for_combined_scope(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = HistoryStore(Path(tmp) / "history.json")
            matching_scope = {
                "project_id": "project-1",
                "workdir": "/tmp/project-1",
            }
            store.append("user", "first", {**matching_scope, "chat_id": "chat-2"})
            store.append("assistant", "duplicate", {**matching_scope, "chat_id": "chat-2"})
            store.append("user", "second", {**matching_scope, "chat_id": "chat-1"})
            store.append(
                "user",
                "different project",
                {
                    "project_id": "project-2",
                    "workdir": "/tmp/project-1",
                    "chat_id": "chat-other-project",
                },
            )
            store.append(
                "user",
                "different workdir",
                {
                    "project_id": "project-1",
                    "workdir": "/tmp/project-other",
                    "chat_id": "chat-other-workdir",
                },
            )
            store.append("user", "unscoped chat", matching_scope)
            store.append("user", "blank chat", {**matching_scope, "chat_id": ""})

            self.assertEqual(
                store.chat_ids(project_id="project-1", workdir="/tmp/project-1"),
                ["chat-1", "chat-2"],
            )
            self.assertEqual(
                store.chat_ids(project_id="project-1", chat_id="chat-2"),
                ["chat-2"],
            )

    def test_clear_combines_scope_filters_without_removing_nearby_history(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = HistoryStore(Path(tmp) / "history.json")
            matching = store.append(
                "user",
                "remove me",
                {
                    "chat_id": "chat-1",
                    "project_id": "project-1",
                    "workdir": "/tmp/project-1",
                },
            )
            retained = [
                store.append(
                    "user",
                    "keep different chat",
                    {
                        "chat_id": "chat-2",
                        "project_id": "project-1",
                        "workdir": "/tmp/project-1",
                    },
                ),
                store.append(
                    "user",
                    "keep different project",
                    {
                        "chat_id": "chat-1",
                        "project_id": "project-2",
                        "workdir": "/tmp/project-1",
                    },
                ),
                store.append(
                    "user",
                    "keep different workdir",
                    {
                        "chat_id": "chat-1",
                        "project_id": "project-1",
                        "workdir": "/tmp/project-other",
                    },
                ),
            ]

            store.clear(
                project_id="project-1",
                workdir="/tmp/project-1",
                chat_id="chat-1",
            )

            remaining_ids = {item["id"] for item in store.list()}
            self.assertNotIn(matching["id"], remaining_ids)
            self.assertEqual(remaining_ids, {item["id"] for item in retained})

    def test_clear_preserves_single_scope_behavior(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = HistoryStore(Path(tmp) / "history.json")
            removed = store.append("user", "remove", {"project_id": "project-1"})
            retained = store.append("user", "keep", {"project_id": "project-2"})

            store.clear(project_id="project-1")

            remaining_ids = {item["id"] for item in store.list()}
            self.assertNotIn(removed["id"], remaining_ids)
            self.assertEqual(remaining_ids, {retained["id"]})

    def test_chat_summary_uses_first_user_message_by_time(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = HistoryStore(Path(tmp) / "history.json")
            assistant = store.append(
                "assistant",
                "How can I help?",
                {"chat_id": "chat-1", "project_id": "project-1"},
            )
            first_user = store.append(
                "user",
                "Zulu request came first",
                {"chat_id": "chat-1", "project_id": "project-1"},
            )
            later_user = store.append(
                "user",
                "Alpha request came later",
                {"chat_id": "chat-1", "project_id": "project-1"},
            )
            timestamps = {
                assistant["id"]: "2026-01-01T00:00:00+00:00",
                first_user["id"]: "2026-01-01T00:01:00+00:00",
                later_user["id"]: "2026-01-01T00:02:00+00:00",
            }
            with sqlite3.connect(store.path) as conn:
                conn.executemany(
                    "UPDATE history SET created_at = ? WHERE id = ?",
                    [(created_at, item_id) for item_id, created_at in timestamps.items()],
                )

            summaries = store.chat_summaries(project_id="project-1")

            self.assertEqual(len(summaries), 1)
            self.assertEqual(summaries[0]["created_at"], timestamps[assistant["id"]])
            self.assertEqual(summaries[0]["first_user_text"], first_user["text"])

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
                        json.dumps(
                            {
                                "chat_id": "chat-1",
                                "project_id": "project-1",
                                "workdir": "/tmp/project-1",
                            }
                        ),
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

    def test_shared_database_preserves_legacy_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            history_path = root / "history.json"
            legacy_store = ArtifactStore(history_path)
            artifact = legacy_store.create(
                chat_id="chat-1",
                message_id=None,
                title="Existing diff",
                summary="Created before database consolidation",
                content="diff --git a/app.py b/app.py",
                content_type="diff",
                source="git_diff",
                workdir="/tmp/project-1",
            )

            database = SQLiteDatabase(root / "history.sqlite3")
            stores = [
                HistoryStore(history_path, database),
                ArtifactStore(history_path, database),
                ProjectStore(root / "projects.json", database=database),
                ChatStore(root / "chats.json", database=database),
                ConsoleStore(root / "console.json", database=database),
                CodexHandoffStore(history_path, database),
            ]

            self.assertTrue(all(store.path == database.path for store in stores))
            self.assertTrue(all(store.lock is database.lock for store in stores))
            self.assertEqual(stores[1].list(chat_id="chat-1"), [artifact])

            stores[1].clear()
            restarted = ArtifactStore(history_path, SQLiteDatabase(root / "history.sqlite3"))
            self.assertEqual(restarted.list(), [])

    def test_legacy_artifact_migration_merges_into_a_partially_populated_table(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            history_path = root / "history.json"
            database = SQLiteDatabase(root / "history.sqlite3")
            shared = ArtifactStore(history_path, database)
            current = shared.create(
                chat_id="chat-current",
                message_id=None,
                title="Current artifact",
                summary="Already stored in the shared database",
                content="current",
                content_type="text",
                source="test",
                workdir="/tmp/project-1",
            )
            legacy = ArtifactStore(history_path)
            old = legacy.create(
                chat_id="chat-old",
                message_id=None,
                title="Legacy artifact",
                summary="Waiting to be migrated",
                content="legacy",
                content_type="text",
                source="test",
                workdir="/tmp/project-1",
            )
            with database.connect() as conn:
                conn.execute(
                    "DELETE FROM schema_migrations WHERE name = ?",
                    (ArtifactStore._LEGACY_MIGRATION,),
                )

            restarted = ArtifactStore(history_path, SQLiteDatabase(root / "history.sqlite3"))

            self.assertEqual({item["id"] for item in restarted.list()}, {current["id"], old["id"]})


class CodexHandoffStoreTests(unittest.TestCase):
    def test_pending_handoff_survives_failed_gemini_delivery(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = CodexHandoffStore(Path(tmp) / "history.json")
            handoff = store.create(
                chat_id="chat-1",
                project_id="project-1",
                workdir="/tmp/project-1",
                user_text="Fix reconnect handling",
                tool_name="run_codex_task",
                codex_status="completed",
                result_summary="Changed reconnect context handling.",
                result_artifact_id="artifact-1",
                codex_turn_id="turn-1",
                codex_thread_id="thread-1",
                artifact_ids=["artifact-1", "artifact-2"],
            )

            store.mark_delivery(handoff["id"], "tool_response_failed_to_gemini", acknowledged=False)

            pending = store.pending_for_chat("chat-1")
            self.assertEqual(len(pending), 1)
            self.assertEqual(pending[0]["delivery_state"], "tool_response_failed_to_gemini")
            self.assertFalse(pending[0]["gemini_acknowledged"])
            self.assertEqual(pending[0]["artifact_ids"], ["artifact-1", "artifact-2"])

    def test_acknowledge_only_stops_reinjecting_selected_handoff(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = CodexHandoffStore(Path(tmp) / "history.json")
            first = store.create(
                chat_id="chat-1",
                project_id="project-1",
                workdir="/tmp/project-1",
                user_text="Request A",
                tool_name="run_codex_task",
                codex_status="completed",
                result_summary="Result A",
                result_artifact_id="artifact-1",
                codex_turn_id="turn-1",
                codex_thread_id="thread-1",
                artifact_ids=["artifact-1"],
            )
            second = store.create(
                chat_id="chat-1",
                project_id="project-1",
                workdir="/tmp/project-1",
                user_text="Request B",
                tool_name="run_codex_task",
                codex_status="completed",
                result_summary="Result B",
                result_artifact_id="artifact-2",
                codex_turn_id="turn-2",
                codex_thread_id="thread-1",
                artifact_ids=["artifact-2"],
            )

            store.acknowledge([second["id"]])

            pending = store.pending_for_chat("chat-1")
            self.assertEqual([item["id"] for item in pending], [first["id"]])
            self.assertEqual(pending[0]["user_text"], "Request A")

    def test_acknowledge_empty_list_is_noop(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = CodexHandoffStore(Path(tmp) / "history.json")
            handoff = store.create(
                chat_id="chat-1",
                project_id="project-1",
                workdir="/tmp/project-1",
                user_text="Request A",
                tool_name="run_codex_task",
                codex_status="completed",
                result_summary="Result A",
                result_artifact_id="artifact-1",
                codex_turn_id="turn-1",
                codex_thread_id="thread-1",
                artifact_ids=["artifact-1"],
            )

            store.acknowledge([])

            self.assertEqual(
                [item["id"] for item in store.pending_for_chat("chat-1")], [handoff["id"]]
            )


class ProjectStoreTests(unittest.TestCase):
    def test_upsert_rejects_second_project_for_same_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = ProjectStore(Path(tmp) / "projects.json")
            store.upsert({"id": "one", "path": "/tmp/example", "name": "One"})

            with self.assertRaises(ValueError):
                store.upsert({"id": "two", "path": "/tmp/example", "name": "Two"})

    def test_migrates_legacy_projects_into_shared_sqlite(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "projects.json").write_text(
                '[{"id":"one","name":"One","path":"/tmp/one","color":"#fff","createdAt":10}]',
                encoding="utf-8",
            )
            store = ProjectStore(root / "projects.json", db_path=root / "history.json")

            self.assertEqual(store.path, root / "history.sqlite3")
            self.assertEqual(store.list()[0]["id"], "one")


class ChatStoreTests(unittest.TestCase):
    def test_migrates_legacy_chats_and_filters_by_project(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "chats.json").write_text(
                """
                [
                  {"id":"chat-1","projectId":"project-1","title":"One","createdAt":10},
                  {"id":"chat-2","projectId":"project-2","title":"Two","createdAt":20}
                ]
                """,
                encoding="utf-8",
            )
            store = ChatStore(root / "chats.json", db_path=root / "history.json")

            rows = store.list(project_id="project-1")

            self.assertEqual(store.path, root / "history.sqlite3")
            self.assertEqual([row["id"] for row in rows], ["chat-1"])


class ConsoleStoreTests(unittest.TestCase):
    def test_migrates_legacy_console_state_and_marks_running_actions_failed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "console.json").write_text(
                """
                {
                  "chat-1": {
                    "actions": [{"id":"action-1","status":"running","detail":"Build"}],
                    "handoffs": [],
                    "debugEntries": []
                  }
                }
                """,
                encoding="utf-8",
            )
            store = ConsoleStore(root / "console.json", db_path=root / "history.json")

            state = store.get("chat-1")

            self.assertEqual(store.path, root / "history.sqlite3")
            self.assertEqual(state["actions"][0]["status"], "failed")

    def test_put_get_and_clear_console_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = ConsoleStore(Path(tmp) / "console.json", db_path=Path(tmp) / "history.json")

            saved = store.put("chat-1", {"actions": [{"id": "done", "status": "done"}]})
            loaded = store.get("chat-1")
            store.clear("chat-1")

            self.assertEqual(saved["actions"][0]["id"], "done")
            self.assertEqual(loaded["actions"][0]["id"], "done")
            self.assertEqual(
                store.get("chat-1"), {"actions": [], "handoffs": [], "debugEntries": []}
            )


if __name__ == "__main__":
    unittest.main()
