from __future__ import annotations

from typing import Any, AsyncIterator, Literal

from .claude_runner import (
    close_claude_session,
    close_claude_sessions,
    list_claude_models,
    probe_claude_sdk_auth_status,
    run_claude_stream_with_timer,
)
from .codex_runner import (
    CancellationToken,
    close_codex_thread_session,
    close_codex_thread_sessions,
    list_codex_models,
    run_codex_stream_with_timer,
)
from .settings import Settings

CodingHarness = Literal["codex", "claude"]


def normalize_coding_harness(value: str | None) -> CodingHarness:
    return "claude" if str(value or "").strip().lower() == "claude" else "codex"


def coding_harness_label(value: str | None) -> str:
    return "Claude" if normalize_coding_harness(value) == "claude" else "Codex"


async def list_coding_harnesses() -> list[dict[str, Any]]:
    auth = await probe_claude_sdk_auth_status()
    try:
        codex_models = await list_codex_models()
        codex_error = ""
    except Exception as exc:
        codex_models = []
        codex_error = str(exc)
    return [
        {
            "id": "codex",
            "displayName": "Codex",
            "available": bool(codex_models),
            "authenticated": bool(codex_models),
            "error": codex_error,
            "models": codex_models,
        },
        {
            "id": "claude",
            "displayName": "Claude",
            "available": bool(auth.get("installed")),
            "authenticated": bool(auth.get("loggedIn")),
            "subscriptionType": auth.get("subscriptionType"),
            "authMethod": auth.get("authMethod"),
            "usagePolicy": (
                "Claude Agent SDK reuses your local Claude Code subscription login. "
                "Usage counts against your subscription limits; Vodex does not pass API keys."
            ),
            "error": (
                "" if auth.get("loggedIn") else "Run `claude auth login` in Terminal, then refresh."
            ),
            "models": list_claude_models(),
        },
    ]


async def run_coding_stream_with_timer(
    prompt: str,
    workdir: str,
    settings: Settings,
    cancel_token: CancellationToken | None = None,
    conversation_id: str | None = None,
    model: str | None = None,
    reasoning_effort: str | None = None,
    harness: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    selected = normalize_coding_harness(harness)
    runner = run_claude_stream_with_timer if selected == "claude" else run_codex_stream_with_timer
    async for event in runner(
        prompt,
        workdir,
        settings,
        cancel_token,
        conversation_id,
        model,
        reasoning_effort,
    ):
        yield {**event, "harness": selected}


async def close_coding_session(conversation_id: str | None) -> None:
    await close_codex_thread_session(conversation_id)
    await close_claude_session(conversation_id)


async def close_coding_sessions_for(conversation_ids: list[str]) -> None:
    for conversation_id in conversation_ids:
        await close_coding_session(conversation_id)


async def close_coding_sessions() -> None:
    await close_codex_thread_sessions()
    await close_claude_sessions()
