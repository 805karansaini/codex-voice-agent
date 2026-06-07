import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Iterator


class HistoryStore:
    def __init__(self, path: Path) -> None:
        self.legacy_path = path
        self.path = path.with_suffix(".sqlite3")
        self.lock = Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()
        self._migrate_legacy_json()

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS history (
                    id TEXT PRIMARY KEY,
                    role TEXT NOT NULL,
                    text TEXT NOT NULL,
                    meta_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_history_chat ON history(json_extract(meta_json, '$.chat_id'))")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_history_project ON history(json_extract(meta_json, '$.project_id'))")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_history_workdir ON history(json_extract(meta_json, '$.workdir'))")

    def _migrate_legacy_json(self) -> None:
        if not self.legacy_path.exists():
            return
        try:
            rows = json.loads(self.legacy_path.read_text(encoding="utf-8"))
        except Exception:
            return
        if not isinstance(rows, list):
            return
        with self.lock, self._connect() as conn:
            count = conn.execute("SELECT COUNT(*) FROM history").fetchone()[0]
            if count:
                return
            for row in rows:
                if not isinstance(row, dict):
                    continue
                item_id = str(row.get("id") or datetime.now(timezone.utc).isoformat())
                conn.execute(
                    "INSERT OR IGNORE INTO history (id, role, text, meta_json, created_at) VALUES (?, ?, ?, ?, ?)",
                    (
                        item_id,
                        str(row.get("role") or ""),
                        str(row.get("text") or ""),
                        json.dumps(row.get("meta") or {}),
                        item_id,
                    ),
                )

    def _row_to_item(self, row: sqlite3.Row) -> dict[str, Any]:
        try:
            meta = json.loads(row["meta_json"])
        except Exception:
            meta = {}
        return {
            "id": row["id"],
            "role": row["role"],
            "text": row["text"],
            "meta": meta,
        }

    def list(
        self,
        project_id: str | None = None,
        workdir: str | None = None,
        chat_id: str | None = None,
    ) -> list[dict[str, Any]]:
        with self.lock:
            with self._connect() as conn:
                query = "SELECT * FROM history"
                params: list[Any] = []
                if chat_id is not None:
                    query += " WHERE json_extract(meta_json, '$.chat_id') = ?"
                    params.append(chat_id)
                elif project_id is not None:
                    query += " WHERE json_extract(meta_json, '$.project_id') = ?"
                    params.append(project_id)
                elif workdir is not None:
                    query += " WHERE json_extract(meta_json, '$.workdir') = ?"
                    params.append(workdir)
                query += " ORDER BY created_at ASC"
                return [self._row_to_item(row) for row in conn.execute(query, params)]

    def append(self, role: str, text: str, meta: dict[str, Any] | None = None) -> dict[str, Any]:
        created_at = datetime.now(timezone.utc).isoformat()
        item = {
            "id": created_at,
            "role": role,
            "text": text,
            "meta": meta or {},
        }
        with self.lock:
            with self._connect() as conn:
                conn.execute(
                    "INSERT INTO history (id, role, text, meta_json, created_at) VALUES (?, ?, ?, ?, ?)",
                    (item["id"], role, text, json.dumps(item["meta"]), created_at),
                )
        return item

    def clear(
        self,
        project_id: str | None = None,
        workdir: str | None = None,
        chat_id: str | None = None,
    ) -> None:
        with self.lock:
            with self._connect() as conn:
                if project_id is None and workdir is None and chat_id is None:
                    conn.execute("DELETE FROM history")
                    return
                clauses = []
                params: list[Any] = []
                if chat_id is not None:
                    clauses.append("json_extract(meta_json, '$.chat_id') = ?")
                    params.append(chat_id)
                if project_id is not None:
                    clauses.append("json_extract(meta_json, '$.project_id') = ?")
                    params.append(project_id)
                if workdir is not None:
                    clauses.append("json_extract(meta_json, '$.workdir') = ?")
                    params.append(workdir)
                conn.execute(f"DELETE FROM history WHERE {' OR '.join(clauses)}", params)


class ProjectStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.lock = Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.write_text("[]", encoding="utf-8")

    def list(self) -> list[dict[str, Any]]:
        with self.lock:
            return json.loads(self.path.read_text(encoding="utf-8"))

    def upsert(self, project: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            rows = json.loads(self.path.read_text(encoding="utf-8"))
            rows = [row for row in rows if row.get("id") != project.get("id") and row.get("path") != project.get("path")]
            rows.insert(0, project)
            self.path.write_text(json.dumps(rows, indent=2), encoding="utf-8")
        return project

    def delete(self, project_id: str) -> None:
        with self.lock:
            rows = json.loads(self.path.read_text(encoding="utf-8"))
            rows = [row for row in rows if row.get("id") != project_id]
            self.path.write_text(json.dumps(rows, indent=2), encoding="utf-8")


class ChatStore:
    """Stores the list of chats (conversations) that live inside each project.

    A project is pinned to one folder (the working directory); a chat is one
    conversation thread inside that project. Multiple chats share the project's
    folder but keep independent message histories (keyed by chat_id in the
    HistoryStore).
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self.lock = Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.write_text("[]", encoding="utf-8")

    def list(self, project_id: str | None = None) -> list[dict[str, Any]]:
        with self.lock:
            rows = json.loads(self.path.read_text(encoding="utf-8"))
        if project_id is not None:
            return [row for row in rows if row.get("projectId") == project_id]
        return rows

    def upsert(self, chat: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            rows = json.loads(self.path.read_text(encoding="utf-8"))
            rows = [row for row in rows if row.get("id") != chat.get("id")]
            rows.insert(0, chat)
            self.path.write_text(json.dumps(rows, indent=2), encoding="utf-8")
        return chat

    def delete(self, chat_id: str) -> None:
        with self.lock:
            rows = json.loads(self.path.read_text(encoding="utf-8"))
            rows = [row for row in rows if row.get("id") != chat_id]
            self.path.write_text(json.dumps(rows, indent=2), encoding="utf-8")

    def delete_for_project(self, project_id: str) -> None:
        with self.lock:
            rows = json.loads(self.path.read_text(encoding="utf-8"))
            rows = [row for row in rows if row.get("projectId") != project_id]
            self.path.write_text(json.dumps(rows, indent=2), encoding="utf-8")


class ConsoleStore:
    """Stores per-chat console state shown in the right panel."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.lock = Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.write_text("{}", encoding="utf-8")

    def get(self, chat_id: str) -> dict[str, Any]:
        with self.lock:
            rows = json.loads(self.path.read_text(encoding="utf-8"))
        state = rows.get(chat_id, {"actions": [], "handoffs": [], "debugEntries": []})
        return self._mark_stale_running_actions(state)

    def put(self, chat_id: str, state: dict[str, Any]) -> dict[str, Any]:
        clean = self._mark_stale_running_actions({
            "actions": list(state.get("actions") or [])[:16],
            "handoffs": list(state.get("handoffs") or [])[:12],
            "debugEntries": list(state.get("debugEntries") or [])[:40],
        })
        with self.lock:
            rows = json.loads(self.path.read_text(encoding="utf-8"))
            rows[chat_id] = clean
            self.path.write_text(json.dumps(rows, indent=2), encoding="utf-8")
        return clean

    def _mark_stale_running_actions(self, state: dict[str, Any]) -> dict[str, Any]:
        actions = []
        for action in list(state.get("actions") or []):
            if not isinstance(action, dict):
                continue
            if action.get("status") == "running":
                action = {
                    **action,
                    "status": "failed",
                    "detail": f"{action.get('detail') or 'Task'}\n\nStopped before completion.",
                }
            actions.append(action)
        return {
            "actions": actions[:16],
            "handoffs": list(state.get("handoffs") or [])[:12],
            "debugEntries": list(state.get("debugEntries") or [])[:40],
        }

    def clear(self, chat_id: str) -> None:
        with self.lock:
            rows = json.loads(self.path.read_text(encoding="utf-8"))
            rows.pop(chat_id, None)
            self.path.write_text(json.dumps(rows, indent=2), encoding="utf-8")

    def clear_for_project(self, chat_ids: list[str]) -> None:
        with self.lock:
            rows = json.loads(self.path.read_text(encoding="utf-8"))
            for chat_id in chat_ids:
                rows.pop(chat_id, None)
            self.path.write_text(json.dumps(rows, indent=2), encoding="utf-8")
