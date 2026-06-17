from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Iterator, List


def _snippet(text: object, query: str, radius: int = 80) -> str:
    value = " ".join(str(text or "").split())
    if not value:
        return ""
    needle = query.lower()
    idx = value.lower().find(needle)
    if idx < 0:
        return value[: radius * 2].rstrip()
    start = max(0, idx - radius)
    end = min(len(value), idx + len(query) + radius)
    prefix = "..." if start > 0 else ""
    suffix = "..." if end < len(value) else ""
    return f"{prefix}{value[start:end].strip()}{suffix}"


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
                    chat_id TEXT,
                    project_id TEXT,
                    workdir TEXT,
                    created_at TEXT NOT NULL
                )
                """
            )
            self._ensure_history_scope_columns(conn)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_history_chat ON history(chat_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_history_project ON history(project_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_history_workdir ON history(workdir)")

    def _ensure_history_scope_columns(self, conn: sqlite3.Connection) -> None:
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(history)")}
        for column in ("chat_id", "project_id", "workdir"):
            if column not in columns:
                conn.execute(f"ALTER TABLE history ADD COLUMN {column} TEXT")
        conn.execute(
            """
            UPDATE history
            SET
                chat_id = COALESCE(chat_id, json_extract(meta_json, '$.chat_id')),
                project_id = COALESCE(project_id, json_extract(meta_json, '$.project_id')),
                workdir = COALESCE(workdir, json_extract(meta_json, '$.workdir'))
            """
        )

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
                meta = row.get("meta") or {}
                conn.execute(
                    """
                    INSERT OR IGNORE INTO history (
                        id, role, text, meta_json, chat_id, project_id, workdir, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        item_id,
                        str(row.get("role") or ""),
                        str(row.get("text") or ""),
                        json.dumps(meta),
                        meta.get("chat_id"),
                        meta.get("project_id"),
                        meta.get("workdir"),
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
                    query += " WHERE chat_id = ?"
                    params.append(chat_id)
                elif project_id is not None:
                    query += " WHERE project_id = ?"
                    params.append(project_id)
                elif workdir is not None:
                    query += " WHERE workdir = ?"
                    params.append(workdir)
                query += " ORDER BY created_at ASC"
                return [self._row_to_item(row) for row in conn.execute(query, params)]

    def chat_summaries(self, project_id: str | None = None) -> List[dict[str, Any]]:
        with self.lock:
            with self._connect() as conn:
                query = """
                    SELECT
                        chat_id,
                        project_id,
                        MIN(created_at) AS first_created_at,
                        MIN(CASE WHEN role = 'user' THEN text END) AS first_user_text
                    FROM history
                    WHERE chat_id IS NOT NULL
                """
                params: list[Any] = []
                if project_id is not None:
                    query += " AND project_id = ?"
                    params.append(project_id)
                query += " GROUP BY chat_id, project_id ORDER BY first_created_at DESC"
                rows = []
                for row in conn.execute(query, params):
                    if not row["chat_id"] or not row["project_id"]:
                        continue
                    rows.append(
                        {
                            "chat_id": row["chat_id"],
                            "project_id": row["project_id"],
                            "created_at": row["first_created_at"],
                            "first_user_text": row["first_user_text"],
                        }
                    )
                return rows

    def search(self, query: str, limit: int = 20) -> list[dict[str, Any]]:
        value = " ".join(query.split())
        if not value:
            return []
        like = f"%{value}%"
        with self.lock:
            with self._connect() as conn:
                rows = conn.execute(
                    """
                    SELECT id, role, text, chat_id, project_id, workdir, created_at
                    FROM history
                    WHERE text LIKE ? OR meta_json LIKE ?
                    ORDER BY created_at DESC
                    LIMIT ?
                    """,
                    (like, like, limit),
                )
                return [
                    {
                        "type": "message",
                        "id": row["id"],
                        "chat_id": row["chat_id"],
                        "project_id": row["project_id"],
                        "workdir": row["workdir"],
                        "title": row["role"].title(),
                        "snippet": _snippet(row["text"], value),
                        "created_at": row["created_at"],
                    }
                    for row in rows
                ]

    def append(self, role: str, text: str, meta: dict[str, Any] | None = None) -> dict[str, Any]:
        created_at = datetime.now(timezone.utc).isoformat()
        item = {
            "id": str(uuid.uuid4()),
            "role": role,
            "text": text,
            "meta": meta or {},
        }
        with self.lock:
            with self._connect() as conn:
                conn.execute(
                    """
                    INSERT INTO history (
                        id, role, text, meta_json, chat_id, project_id, workdir, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        item["id"],
                        role,
                        text,
                        json.dumps(item["meta"]),
                        item["meta"].get("chat_id"),
                        item["meta"].get("project_id"),
                        item["meta"].get("workdir"),
                        created_at,
                    ),
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
                    clauses.append("chat_id = ?")
                    params.append(chat_id)
                if project_id is not None:
                    clauses.append("project_id = ?")
                    params.append(project_id)
                if workdir is not None:
                    clauses.append("workdir = ?")
                    params.append(workdir)
                conn.execute(f"DELETE FROM history WHERE {' OR '.join(clauses)}", params)


class ArtifactStore:
    def __init__(self, path: Path) -> None:
        self.path = path.with_name("artifacts.sqlite3")
        self.lock = Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

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
                CREATE TABLE IF NOT EXISTS artifacts (
                    id TEXT PRIMARY KEY,
                    chat_id TEXT,
                    message_id TEXT,
                    title TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    content TEXT NOT NULL,
                    content_type TEXT NOT NULL,
                    source TEXT NOT NULL,
                    workdir TEXT,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_artifacts_chat ON artifacts(chat_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_artifacts_message ON artifacts(message_id)")

    def _row_to_item(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "chat_id": row["chat_id"],
            "message_id": row["message_id"],
            "title": row["title"],
            "summary": row["summary"],
            "content": row["content"],
            "content_type": row["content_type"],
            "source": row["source"],
            "workdir": row["workdir"],
            "created_at": row["created_at"],
        }

    def create(
        self,
        *,
        chat_id: str | None,
        message_id: str | None,
        title: str,
        summary: str,
        content: str,
        content_type: str,
        source: str,
        workdir: str | None,
    ) -> dict[str, Any]:
        import uuid

        created_at = datetime.now(timezone.utc).isoformat()
        item = {
            "id": str(uuid.uuid4()),
            "chat_id": chat_id,
            "message_id": message_id,
            "title": title,
            "summary": summary,
            "content": content,
            "content_type": content_type,
            "source": source,
            "workdir": workdir,
            "created_at": created_at,
        }
        with self.lock:
            with self._connect() as conn:
                conn.execute(
                    """
                    INSERT INTO artifacts (
                        id, chat_id, message_id, title, summary, content,
                        content_type, source, workdir, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        item["id"],
                        item["chat_id"],
                        item["message_id"],
                        item["title"],
                        item["summary"],
                        item["content"],
                        item["content_type"],
                        item["source"],
                        item["workdir"],
                        item["created_at"],
                    ),
                )
        return item

    def list(self, chat_id: str | None = None, message_id: str | None = None) -> list[dict[str, Any]]:
        with self.lock:
            with self._connect() as conn:
                query = "SELECT * FROM artifacts"
                params: list[Any] = []
                if message_id is not None:
                    query += " WHERE message_id = ?"
                    params.append(message_id)
                elif chat_id is not None:
                    query += " WHERE chat_id = ?"
                    params.append(chat_id)
                query += " ORDER BY created_at ASC"
                return [self._row_to_item(row) for row in conn.execute(query, params)]

    def search(self, query: str, limit: int = 20) -> list[dict[str, Any]]:
        value = " ".join(query.split())
        if not value:
            return []
        like = f"%{value}%"
        with self.lock:
            with self._connect() as conn:
                rows = conn.execute(
                    """
                    SELECT id, chat_id, message_id, title, summary, content, content_type, source, workdir, created_at
                    FROM artifacts
                    WHERE title LIKE ? OR summary LIKE ? OR content LIKE ?
                    ORDER BY created_at DESC
                    LIMIT ?
                    """,
                    (like, like, like, limit),
                )
                return [
                    {
                        "type": "artifact",
                        "id": row["id"],
                        "chat_id": row["chat_id"],
                        "message_id": row["message_id"],
                        "title": row["title"],
                        "snippet": _snippet(
                            " ".join(
                                part
                                for part in (row["summary"], row["content"])
                                if part
                            ),
                            value,
                        ),
                        "content_type": row["content_type"],
                        "source": row["source"],
                        "workdir": row["workdir"],
                        "created_at": row["created_at"],
                    }
                    for row in rows
                ]

    def clear(self, chat_id: str | None = None) -> None:
        with self.lock:
            with self._connect() as conn:
                if chat_id is None:
                    conn.execute("DELETE FROM artifacts")
                else:
                    conn.execute("DELETE FROM artifacts WHERE chat_id = ?", (chat_id,))


class CodexHandoffStore:
    def __init__(self, path: Path) -> None:
        self.path = path.with_suffix(".sqlite3")
        self.lock = Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

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
                CREATE TABLE IF NOT EXISTS codex_handoffs (
                    id TEXT PRIMARY KEY,
                    chat_id TEXT,
                    project_id TEXT,
                    workdir TEXT,
                    user_text TEXT NOT NULL,
                    tool_name TEXT NOT NULL,
                    codex_status TEXT,
                    result_summary TEXT NOT NULL,
                    result_artifact_id TEXT,
                    codex_turn_id TEXT,
                    codex_thread_id TEXT,
                    artifact_ids_json TEXT NOT NULL,
                    delivery_state TEXT NOT NULL,
                    gemini_acknowledged INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_handoffs_chat ON codex_handoffs(chat_id)")
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_handoffs_pending ON codex_handoffs(chat_id, gemini_acknowledged, delivery_state)"
            )

    def _row_to_item(self, row: sqlite3.Row) -> dict[str, Any]:
        try:
            artifact_ids = json.loads(row["artifact_ids_json"])
        except Exception:
            artifact_ids = []
        return {
            "id": row["id"],
            "chat_id": row["chat_id"],
            "project_id": row["project_id"],
            "workdir": row["workdir"],
            "user_text": row["user_text"],
            "tool_name": row["tool_name"],
            "codex_status": row["codex_status"],
            "result_summary": row["result_summary"],
            "result_artifact_id": row["result_artifact_id"],
            "codex_turn_id": row["codex_turn_id"],
            "codex_thread_id": row["codex_thread_id"],
            "artifact_ids": artifact_ids if isinstance(artifact_ids, list) else [],
            "delivery_state": row["delivery_state"],
            "gemini_acknowledged": bool(row["gemini_acknowledged"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def create(
        self,
        *,
        chat_id: str | None,
        project_id: str | None,
        workdir: str | None,
        user_text: str,
        tool_name: str,
        codex_status: str | None,
        result_summary: str,
        result_artifact_id: str | None,
        codex_turn_id: str | None,
        codex_thread_id: str | None,
        artifact_ids: list[str],
    ) -> dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        item_id = str(uuid.uuid4())
        with self.lock:
            with self._connect() as conn:
                conn.execute(
                    """
                    INSERT INTO codex_handoffs (
                        id, chat_id, project_id, workdir, user_text, tool_name,
                        codex_status, result_summary, result_artifact_id,
                        codex_turn_id, codex_thread_id, artifact_ids_json,
                        delivery_state, gemini_acknowledged, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        item_id,
                        chat_id,
                        project_id,
                        workdir,
                        user_text,
                        tool_name,
                        codex_status,
                        result_summary,
                        result_artifact_id,
                        codex_turn_id,
                        codex_thread_id,
                        json.dumps(artifact_ids),
                        "tool_result_sent_to_client",
                        0,
                        now,
                        now,
                    ),
                )
        return self.get(item_id) or {}

    def get(self, handoff_id: str) -> dict[str, Any] | None:
        with self.lock:
            with self._connect() as conn:
                row = conn.execute(
                    "SELECT * FROM codex_handoffs WHERE id = ?", (handoff_id,)
                ).fetchone()
                return self._row_to_item(row) if row else None

    def mark_delivery(self, handoff_id: str, state: str, *, acknowledged: bool) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with self.lock:
            with self._connect() as conn:
                conn.execute(
                    """
                    UPDATE codex_handoffs
                    SET delivery_state = ?, gemini_acknowledged = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (state, 1 if acknowledged else 0, now, handoff_id),
                )

    def acknowledge_chat(self, chat_id: str | None) -> None:
        if not chat_id:
            return
        now = datetime.now(timezone.utc).isoformat()
        with self.lock:
            with self._connect() as conn:
                conn.execute(
                    """
                    UPDATE codex_handoffs
                    SET gemini_acknowledged = 1,
                        delivery_state = CASE
                            WHEN delivery_state = 'tool_response_failed_to_gemini'
                            THEN 'gemini_final_response_completed'
                            ELSE delivery_state
                        END,
                        updated_at = ?
                    WHERE chat_id = ? AND gemini_acknowledged = 0
                    """,
                    (now, chat_id),
                )

    def pending_for_chat(self, chat_id: str | None, limit: int = 3) -> list[dict[str, Any]]:
        if not chat_id:
            return []
        with self.lock:
            with self._connect() as conn:
                rows = conn.execute(
                    """
                    SELECT * FROM codex_handoffs
                    WHERE chat_id = ? AND gemini_acknowledged = 0
                    ORDER BY created_at DESC
                    LIMIT ?
                    """,
                    (chat_id, limit),
                ).fetchall()
                return [self._row_to_item(row) for row in reversed(rows)]

    def clear(self, chat_id: str | None = None) -> None:
        with self.lock:
            with self._connect() as conn:
                if chat_id is None:
                    conn.execute("DELETE FROM codex_handoffs")
                else:
                    conn.execute("DELETE FROM codex_handoffs WHERE chat_id = ?", (chat_id,))


class ProjectStore:
    def __init__(self, path: Path, db_path: Path | None = None) -> None:
        self.legacy_path = path
        self.path = (db_path or path).with_suffix(".sqlite3")
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
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    path TEXT NOT NULL UNIQUE,
                    color TEXT,
                    created_at INTEGER NOT NULL
                )
                """
            )

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
            count = conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0]
            if count:
                return
            for row in rows:
                if not isinstance(row, dict):
                    continue
                project_id = str(row.get("id") or "").strip()
                name = str(row.get("name") or "").strip()
                project_path = str(row.get("path") or "").strip()
                if not project_id or not name or not project_path:
                    continue
                conn.execute(
                    """
                    INSERT OR IGNORE INTO projects (id, name, path, color, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        project_id,
                        name,
                        project_path,
                        row.get("color"),
                        int(row.get("createdAt") or 0),
                    ),
                )

    def _row_to_item(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "name": row["name"],
            "path": row["path"],
            "color": row["color"],
            "createdAt": row["created_at"],
        }

    def list(self) -> list[dict[str, Any]]:
        with self.lock:
            with self._connect() as conn:
                rows = conn.execute("SELECT * FROM projects ORDER BY created_at DESC").fetchall()
                return [self._row_to_item(row) for row in rows]

    def upsert(self, project: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            with self._connect() as conn:
                conflicting = conn.execute(
                    "SELECT id FROM projects WHERE path = ? AND id != ?",
                    (project.get("path"), project.get("id")),
                ).fetchone()
                if conflicting:
                    raise ValueError("A project already exists for this folder")
                conn.execute(
                    """
                    INSERT INTO projects (id, name, path, color, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        name = excluded.name,
                        path = excluded.path,
                        color = excluded.color,
                        created_at = excluded.created_at
                    """,
                    (
                        project.get("id"),
                        project.get("name"),
                        project.get("path"),
                        project.get("color"),
                        int(project.get("createdAt") or 0),
                    ),
                )
        return project

    def delete(self, project_id: str) -> None:
        with self.lock:
            with self._connect() as conn:
                conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))


class ChatStore:
    """Stores the list of chats (conversations) that live inside each project.

    A project is pinned to one folder (the working directory); a chat is one
    conversation thread inside that project. Multiple chats share the project's
    folder but keep independent message histories (keyed by chat_id in the
    HistoryStore).
    """

    def __init__(self, path: Path, db_path: Path | None = None) -> None:
        self.legacy_path = path
        self.path = (db_path or path).with_suffix(".sqlite3")
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
                CREATE TABLE IF NOT EXISTS chats (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_chats_project ON chats(project_id)")

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
            count = conn.execute("SELECT COUNT(*) FROM chats").fetchone()[0]
            if count:
                return
            for row in rows:
                if not isinstance(row, dict):
                    continue
                chat_id = str(row.get("id") or "").strip()
                project_id = str(row.get("projectId") or "").strip()
                if not chat_id or not project_id:
                    continue
                conn.execute(
                    """
                    INSERT OR IGNORE INTO chats (id, project_id, title, created_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (
                        chat_id,
                        project_id,
                        str(row.get("title") or "New chat"),
                        int(row.get("createdAt") or 0),
                    ),
                )

    def _row_to_item(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "projectId": row["project_id"],
            "title": row["title"],
            "createdAt": row["created_at"],
        }

    def list(self, project_id: str | None = None) -> list[dict[str, Any]]:
        with self.lock:
            with self._connect() as conn:
                if project_id is not None:
                    rows = conn.execute(
                        "SELECT * FROM chats WHERE project_id = ? ORDER BY created_at DESC",
                        (project_id,),
                    ).fetchall()
                else:
                    rows = conn.execute("SELECT * FROM chats ORDER BY created_at DESC").fetchall()
                return [self._row_to_item(row) for row in rows]

    def upsert(self, chat: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            with self._connect() as conn:
                conn.execute(
                    """
                    INSERT INTO chats (id, project_id, title, created_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        project_id = excluded.project_id,
                        title = excluded.title,
                        created_at = excluded.created_at
                    """,
                    (
                        chat.get("id"),
                        chat.get("projectId"),
                        chat.get("title"),
                        int(chat.get("createdAt") or 0),
                    ),
                )
        return chat

    def delete(self, chat_id: str) -> None:
        with self.lock:
            with self._connect() as conn:
                conn.execute("DELETE FROM chats WHERE id = ?", (chat_id,))

    def delete_for_project(self, project_id: str) -> None:
        with self.lock:
            with self._connect() as conn:
                conn.execute("DELETE FROM chats WHERE project_id = ?", (project_id,))


class ConsoleStore:
    """Stores per-chat console state shown in the right panel."""

    def __init__(self, path: Path, db_path: Path | None = None) -> None:
        self.legacy_path = path
        self.path = (db_path or path).with_suffix(".sqlite3")
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
                CREATE TABLE IF NOT EXISTS console_states (
                    chat_id TEXT PRIMARY KEY,
                    state_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )

    def _migrate_legacy_json(self) -> None:
        if not self.legacy_path.exists():
            return
        try:
            rows = json.loads(self.legacy_path.read_text(encoding="utf-8"))
        except Exception:
            return
        if not isinstance(rows, dict):
            return
        with self.lock, self._connect() as conn:
            count = conn.execute("SELECT COUNT(*) FROM console_states").fetchone()[0]
            if count:
                return
            now = datetime.now(timezone.utc).isoformat()
            for chat_id, state in rows.items():
                if not isinstance(state, dict):
                    continue
                clean = self._mark_stale_running_actions(state)
                conn.execute(
                    """
                    INSERT OR IGNORE INTO console_states (chat_id, state_json, updated_at)
                    VALUES (?, ?, ?)
                    """,
                    (str(chat_id), json.dumps(clean), now),
                )

    def get(self, chat_id: str) -> dict[str, Any]:
        with self.lock:
            with self._connect() as conn:
                row = conn.execute(
                    "SELECT state_json FROM console_states WHERE chat_id = ?",
                    (chat_id,),
                ).fetchone()
        state = json.loads(row["state_json"]) if row else {"actions": [], "handoffs": [], "debugEntries": []}
        return self._mark_stale_running_actions(state)

    def put(self, chat_id: str, state: dict[str, Any]) -> dict[str, Any]:
        clean = self._mark_stale_running_actions({
            "actions": list(state.get("actions") or [])[:16],
            "handoffs": list(state.get("handoffs") or [])[:12],
            "debugEntries": list(state.get("debugEntries") or [])[:40],
        })
        with self.lock:
            with self._connect() as conn:
                conn.execute(
                    """
                    INSERT INTO console_states (chat_id, state_json, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(chat_id) DO UPDATE SET
                        state_json = excluded.state_json,
                        updated_at = excluded.updated_at
                    """,
                    (chat_id, json.dumps(clean), datetime.now(timezone.utc).isoformat()),
                )
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
            with self._connect() as conn:
                conn.execute("DELETE FROM console_states WHERE chat_id = ?", (chat_id,))

    def clear_for_project(self, chat_ids: list[str]) -> None:
        with self.lock:
            with self._connect() as conn:
                conn.executemany(
                    "DELETE FROM console_states WHERE chat_id = ?",
                    [(chat_id,) for chat_id in chat_ids],
                )
