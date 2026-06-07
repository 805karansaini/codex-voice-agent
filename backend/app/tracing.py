"""Langfuse tracing setup and null-safe helpers.

All Langfuse usage in this app goes through this module. Every call site is one
or two lines; the SDK details (and the safety net for when tracing is off) live
here so the rest of the code stays readable.

Enabling / disabling
--------------------
Tracing turns on only when Langfuse credentials are present. The
``LANGFUSE_TRACING_ENABLED`` flag overrides that:

- unset / empty -> auto (on if credentials exist, off otherwise)
- ``false`` / ``0`` / ``no`` -> force off, even with credentials
- ``true`` / ``1`` / ``yes`` -> require credentials (warn if missing)

When disabled (or if the SDK is unavailable) every helper is a no-op, so the app
runs unchanged.

Trace hierarchy produced
------------------------
One trace per turn, grouped into a session by ``chat_id``::

    gemini-voice-turn        (generation)  input = user msg + conversation so far
      └─ run_codex_task      (tool)        input = task + workdir
          └─ codex-turn      (generation)  the Codex agent's own run
    transcribe-audio         (span -> auto-instrumented generate_content)

Nesting works because ``tool_call()`` makes the tool observation the *active*
context, so the Codex observation created in ``codex_runner`` attaches under it.

Sensitive data note: only transcribed text is recorded, never raw audio bytes /
base64 payloads, and never API keys.
"""

from __future__ import annotations

import logging
import os
from contextlib import contextmanager
from typing import Any, Iterator

logger = logging.getLogger(__name__)

_enabled = False
_langfuse: Any = None


def _has_credentials() -> bool:
    return bool(os.getenv("LANGFUSE_PUBLIC_KEY") and os.getenv("LANGFUSE_SECRET_KEY"))


def _flag() -> bool | None:
    """Tri-state read of LANGFUSE_TRACING_ENABLED: True / False / None (unset)."""
    raw = os.getenv("LANGFUSE_TRACING_ENABLED")
    if raw is None or not raw.strip():
        return None
    return raw.strip().lower() in ("1", "true", "yes", "on")


def setup_tracing() -> None:
    """Initialise Langfuse once at startup. Safe to call multiple times."""
    global _enabled, _langfuse
    if _enabled:
        return
    flag = _flag()
    if flag is False:
        logger.info("Langfuse tracing disabled via LANGFUSE_TRACING_ENABLED.")
        return
    if not _has_credentials():
        if flag is True:
            logger.warning(
                "LANGFUSE_TRACING_ENABLED is on but LANGFUSE_PUBLIC_KEY/SECRET_KEY "
                "are missing; tracing disabled."
            )
        else:
            logger.info("Langfuse credentials not set; tracing disabled.")
        return
    try:
        from langfuse import get_client

        client = get_client()
        if not client.auth_check():
            logger.warning("Langfuse auth check failed; tracing disabled.")
            return
        _langfuse = client
        _enabled = True
        logger.info("Langfuse tracing enabled.")
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Failed to initialise Langfuse: %s", exc)
        return

    # Auto-instrument plain google-genai calls (transcription). The Live API is
    # instrumented manually, so this is best-effort and optional.
    try:
        from openinference.instrumentation.google_genai import GoogleGenAIInstrumentor

        GoogleGenAIInstrumentor().instrument()
        logger.info("GoogleGenAI auto-instrumentation enabled.")
    except Exception as exc:  # pragma: no cover - optional dependency
        logger.info("GoogleGenAI auto-instrumentation unavailable (%s).", exc)


def is_enabled() -> bool:
    return _enabled


def flush() -> None:
    if _enabled and _langfuse is not None:
        try:
            _langfuse.flush()
        except Exception:  # pragma: no cover - defensive
            pass


def shutdown() -> None:
    if _enabled and _langfuse is not None:
        try:
            _langfuse.shutdown()
        except Exception:  # pragma: no cover - defensive
            pass


@contextmanager
def session_context(
    *,
    session_id: str | None = None,
    user_id: str | None = None,
    metadata: dict[str, Any] | None = None,
    tags: list[str] | None = None,
) -> Iterator[None]:
    """Propagate trace-level attributes (session_id, tags, ...) to observations
    created within the block. No-op when tracing is disabled."""
    if not _enabled or _langfuse is None:
        yield
        return
    try:
        from langfuse import propagate_attributes

        attrs: dict[str, Any] = {}
        if session_id:
            attrs["session_id"] = session_id
        if user_id:
            attrs["user_id"] = user_id
        if metadata:
            attrs["metadata"] = metadata
        if tags:
            attrs["tags"] = tags
        with propagate_attributes(**attrs):
            yield
    except Exception:  # pragma: no cover - defensive
        yield


@contextmanager
def span(name: str, **kwargs: Any) -> Iterator[Any]:
    """Current-context span. Yields the observation (or None when disabled)."""
    if not _enabled or _langfuse is None:
        yield None
        return
    try:
        with _langfuse.start_as_current_observation(as_type="span", name=name, **kwargs) as obs:
            yield obs
    except Exception:  # pragma: no cover - defensive
        yield None


@contextmanager
def generation(name: str, **kwargs: Any) -> Iterator[Any]:
    """Current-context generation. Yields the observation (or None when disabled)."""
    if not _enabled or _langfuse is None:
        yield None
        return
    try:
        with _langfuse.start_as_current_observation(as_type="generation", name=name, **kwargs) as obs:
            yield obs
    except Exception:  # pragma: no cover - defensive
        yield None


@contextmanager
def tool_call(name: str, *, parent: Any, **kwargs: Any) -> Iterator[Any]:
    """Record a model tool call as a child of ``parent`` and make it the active
    context for the duration of the block, so nested work (e.g. a Codex run) is
    captured underneath it. Auto-ends. No-op (yields None) when disabled or when
    ``parent`` is None.

    Pass the tool result via ``update_observation(obs, output=...)`` before the
    block exits.
    """
    if not _enabled or _langfuse is None or parent is None:
        yield None
        return
    try:
        with parent.start_as_current_observation(as_type="tool", name=name, **kwargs) as obs:
            yield obs
    except Exception:  # pragma: no cover - defensive
        yield None


def start_observation(as_type: str, name: str, *, parent: Any = None, **kwargs: Any) -> Any:
    """Start a manual observation (caller must call end_observation). Returns the
    observation object, or None when disabled. Pass ``parent`` to nest under
    another manual observation."""
    if not _enabled or _langfuse is None:
        return None
    try:
        if parent is not None:
            return parent.start_observation(as_type=as_type, name=name, **kwargs)
        return _langfuse.start_observation(as_type=as_type, name=name, **kwargs)
    except Exception:  # pragma: no cover - defensive
        return None


def update_current_generation(**kwargs: Any) -> None:
    """Update the generation that is currently active in the context."""
    if not _enabled or _langfuse is None:
        return
    try:
        _langfuse.update_current_generation(**kwargs)
    except Exception:  # pragma: no cover - defensive
        pass


def update_current_span(**kwargs: Any) -> None:
    """Update the span that is currently active in the context."""
    if not _enabled or _langfuse is None:
        return
    try:
        _langfuse.update_current_span(**kwargs)
    except Exception:  # pragma: no cover - defensive
        pass


def update_observation(obs: Any, **kwargs: Any) -> None:
    if obs is None:
        return
    try:
        obs.update(**kwargs)
    except Exception:  # pragma: no cover - defensive
        pass


def end_observation(obs: Any, **update_kwargs: Any) -> None:
    if obs is None:
        return
    try:
        if update_kwargs:
            obs.update(**update_kwargs)
        obs.end()
    except Exception:  # pragma: no cover - defensive
        pass
