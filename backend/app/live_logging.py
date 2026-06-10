import json
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any


class JsonlEventLogger:
    def __init__(
        self,
        path: Path,
        session_id: str | None = None,
        max_bytes: int = 5_000_000,
        backup_count: int = 3,
    ) -> None:
        self.path = path
        self.session_id = session_id
        self.max_bytes = max_bytes
        self.backup_count = backup_count
        self.lock = Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def write(self, event: str, **fields: Any) -> None:
        row = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "event": event,
            **fields,
        }
        if self.session_id:
            row["session_id"] = self.session_id
        with self.lock:
            self._rotate_if_needed()
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(row, ensure_ascii=True, default=str) + "\n")

    def _rotate_if_needed(self) -> None:
        if self.max_bytes <= 0 or self.backup_count <= 0 or not self.path.exists():
            return
        try:
            if self.path.stat().st_size < self.max_bytes:
                return
        except OSError:
            return
        oldest = self.path.with_name(f"{self.path.name}.{self.backup_count}")
        if oldest.exists():
            oldest.unlink()
        for index in range(self.backup_count - 1, 0, -1):
            src = self.path.with_name(f"{self.path.name}.{index}")
            if src.exists():
                src.rename(self.path.with_name(f"{self.path.name}.{index + 1}"))
        self.path.rename(self.path.with_name(f"{self.path.name}.1"))


class LiveSessionLogger(JsonlEventLogger):
    pass


def clip_text(text: object, limit: int = 500) -> str:
    value = str(text or "")
    if len(value) <= limit:
        return value
    return value[:limit] + "...[truncated]"
