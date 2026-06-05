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

    def list(self) -> list[dict[str, Any]]:
        with self.lock:
            return json.loads(self.path.read_text(encoding="utf-8"))

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
