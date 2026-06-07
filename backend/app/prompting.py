import re
from typing import Any


def build_recent_conversation_context(rows: list[dict[str, Any]], limit: int = 10) -> str:
    relevant = []
    for row in rows[-limit:]:
        role = str(row.get("role") or "").strip()
        text = _compact_text(str(row.get("text") or ""))
        if role and text:
            relevant.append(f"{role}: {text}")
    return "\n".join(relevant)


def improve_codex_task_prompt(task: str) -> str:
    """Lightly clean a Codex task without adding chat history or new intent."""
    return _clean_voice_text(task)


def _clean_voice_text(text: str) -> str:
    text = _compact_text(text)
    replacements = {
        "gemini": "Gemini",
        "codak agent": "Codex agent",
        "kodak agent": "Codex agent",
        "code code up": "Codex",
        "codex thread/turn": "Codex thread/turn",
        "converstaioon": "conversation",
    }
    for phrase, replacement in replacements.items():
        text = re.sub(re.escape(phrase), replacement, text, flags=re.IGNORECASE)
    return text


def _compact_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()
