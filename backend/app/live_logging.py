import json
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any


class JsonlEventLogger:
    def __init__(self, path: Path, session_id: str | None = None) -> None:
        self.path = path
        self.session_id = session_id
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
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(row, ensure_ascii=True, default=str) + "\n")


class LiveSessionLogger(JsonlEventLogger):
    pass


def clip_text(text: object, limit: int = 500) -> str:
    value = str(text or "")
    if len(value) <= limit:
        return value
    return value[:limit] + "...[truncated]"
