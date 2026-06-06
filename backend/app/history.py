import json
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any


class HistoryStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.lock = Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.write_text("[]", encoding="utf-8")

    def list(
        self,
        project_id: str | None = None,
        workdir: str | None = None,
        chat_id: str | None = None,
    ) -> list[dict[str, Any]]:
        with self.lock:
            rows = json.loads(self.path.read_text(encoding="utf-8"))
        if chat_id is not None:
            return [row for row in rows if row.get("meta", {}).get("chat_id") == chat_id]
        if project_id is not None:
            return [row for row in rows if row.get("meta", {}).get("project_id") == project_id]
        if workdir is not None:
            return [row for row in rows if row.get("meta", {}).get("workdir") == workdir]
        return rows

    def append(self, role: str, text: str, meta: dict[str, Any] | None = None) -> dict[str, Any]:
        item = {
            "id": datetime.now(timezone.utc).isoformat(),
            "role": role,
            "text": text,
            "meta": meta or {},
        }
        with self.lock:
            rows = json.loads(self.path.read_text(encoding="utf-8"))
            rows.append(item)
            self.path.write_text(json.dumps(rows[-200:], indent=2), encoding="utf-8")
        return item

    def clear(
        self,
        project_id: str | None = None,
        workdir: str | None = None,
        chat_id: str | None = None,
    ) -> None:
        with self.lock:
            if project_id is None and workdir is None and chat_id is None:
                self.path.write_text("[]", encoding="utf-8")
                return
            rows = json.loads(self.path.read_text(encoding="utf-8"))
            kept = []
            for row in rows:
                meta = row.get("meta", {})
                if chat_id is not None and meta.get("chat_id") == chat_id:
                    continue
                if project_id is not None and meta.get("project_id") == project_id:
                    continue
                if workdir is not None and meta.get("workdir") == workdir:
                    continue
                kept.append(row)
            self.path.write_text(json.dumps(kept[-200:], indent=2), encoding="utf-8")


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
        return rows.get(chat_id, {"actions": [], "handoffs": [], "debugEntries": []})

    def put(self, chat_id: str, state: dict[str, Any]) -> dict[str, Any]:
        clean = {
            "actions": list(state.get("actions") or [])[:16],
            "handoffs": list(state.get("handoffs") or [])[:12],
            "debugEntries": list(state.get("debugEntries") or [])[:40],
        }
        with self.lock:
            rows = json.loads(self.path.read_text(encoding="utf-8"))
            rows[chat_id] = clean
            self.path.write_text(json.dumps(rows, indent=2), encoding="utf-8")
        return clean

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
