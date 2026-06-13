import re
from typing import Any


_TOOL_CALL_PATTERNS = [
    # Multiline: "run_codex_task\ntask: ...\nworkdir: ..."
    re.compile(
        r"run_codex_task\s*\n\s*task:\s*[^\n]+(?:\n\s*workdir:\s*[^\n]+)?",
        re.IGNORECASE,
    ),
    # Claimed inline call: "Calling run_codex_task task: ..."
    re.compile(r"calling\s+run_codex_task\s+task:\s*[^\n]+", re.IGNORECASE),
    # Inline: "run_codex_task task: ..."
    re.compile(r"run_codex_task\s+task:\s*[^\n]+", re.IGNORECASE),
    # Dangling: "calling run_codex_task" / "calling run_codex_"
    re.compile(r"calling\s+run_codex_\w*\.?", re.IGNORECASE),
]


def _sanitize_assistant_text(text: str) -> str:
    """Strip hallucinated tool-call text from assistant messages.

    The Gemini Live model sometimes outputs the tool name and parameters as
    spoken text instead of emitting a real API tool call.  When that text is
    fed back into the conversation context it reinforces the bad pattern.
    """
    for pattern in _TOOL_CALL_PATTERNS:
        text = pattern.sub("", text)
    return re.sub(r"\s+", " ", text).strip()


def build_recent_conversation_context(
    rows: list[dict[str, Any]], limit: int = 5
) -> str:
    relevant = []
    for row in rows[-limit:]:
        role = str(row.get("role") or "").strip()
        text = str(row.get("text") or "")
        # Sanitize assistant messages to prevent hallucinated tool-call
        # text from contaminating future prompts. Do this before the empty
        # check so messages that were *only* a hallucinated call are dropped.
        if role == "assistant":
            text = _sanitize_assistant_text(text)
        else:
            text = _compact_text(text)
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
