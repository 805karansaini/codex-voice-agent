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

    def list(self, project_id: str | None = None, workdir: str | None = None) -> list[dict[str, Any]]:
        with self.lock:
            rows = json.loads(self.path.read_text(encoding="utf-8"))
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

    def clear(self, project_id: str | None = None, workdir: str | None = None) -> None:
        with self.lock:
            if project_id is None and workdir is None:
                self.path.write_text("[]", encoding="utf-8")
                return
            rows = json.loads(self.path.read_text(encoding="utf-8"))
            kept = []
            for row in rows:
                meta = row.get("meta", {})
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
