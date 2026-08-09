from __future__ import annotations

import asyncio
import json
import os
import shutil
import sqlite3
import subprocess
import uuid
from pathlib import Path
from typing import Any, AsyncIterator, cast

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    ResultMessage,
    StreamEvent,
    SystemMessage,
    TextBlock,
    ToolUseBlock,
)

from .codex_runner import CancellationToken, resolve_workdir
from .settings import Settings, get_settings

_CLAUDE_STATUS_FIRST_DELAY_SECONDS = 20
_CLAUDE_STATUS_REPEAT_SECONDS = 60
_SUBSCRIPTION_ONLY_ENV_KEYS = frozenset(
    {
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_BASE_URL",
        "CLAUDE_CODE_USE_ANTHROPIC_AWS",
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_FOUNDRY",
        "CLAUDE_CODE_USE_VERTEX",
    }
)


class _ClaudeSdkTurn:
    def __init__(self, client: ClaudeSDKClient) -> None:
        self.client = client
        self._interrupted = False

    async def interrupt(self) -> None:
        if self._interrupted:
            return
        self._interrupted = True
        try:
            await asyncio.wait_for(self.client.interrupt(), timeout=3)
        except Exception:
            # Disconnecting in the runner's finally block remains the hard stop.
            return


def installed_claude_bin() -> str | None:
    return shutil.which("claude")


def subscription_only_environment() -> dict[str, str]:
    env = dict(os.environ)
    for key in _SUBSCRIPTION_ONLY_ENV_KEYS:
        env.pop(key, None)
    # Extended-context variants can consume usage credits on subscription plans.
    env["CLAUDE_CODE_DISABLE_1M_CONTEXT"] = "1"
    return env


def claude_auth_status() -> dict[str, Any]:
    claude_bin = installed_claude_bin()
    if not claude_bin:
        return {
            "installed": False,
            "loggedIn": False,
            "authMethod": "none",
            "subscriptionType": None,
        }
    try:
        proc = subprocess.run(
            [claude_bin, "auth", "status", "--json"],
            capture_output=True,
            text=True,
            timeout=10,
            env=subscription_only_environment(),
        )
        payload = json.loads(proc.stdout or "{}")
    except Exception:
        payload = {}
    return {
        "installed": True,
        "loggedIn": bool(payload.get("loggedIn")),
        "authMethod": str(payload.get("authMethod") or "none"),
        "apiProvider": str(payload.get("apiProvider") or "firstParty"),
        "subscriptionType": payload.get("subscriptionType"),
    }


async def probe_claude_sdk_auth_status() -> dict[str, Any]:
    """Read Claude account metadata through the SDK without sending a model request."""
    claude_bin = installed_claude_bin()
    if not claude_bin:
        return {
            "installed": False,
            "loggedIn": False,
            "authMethod": "none",
            "subscriptionType": None,
        }

    stderr_messages: list[str] = []
    env = subscription_only_environment()
    env["ENABLE_CLAUDEAI_MCP_SERVERS"] = "false"
    client = ClaudeSDKClient(
        options=ClaudeAgentOptions(
            cli_path=claude_bin,
            cwd=Path.cwd(),
            env=env,
            tools=[],
            mcp_servers={},
            strict_mcp_config=True,
            setting_sources=["user", "project", "local"],
            stderr=stderr_messages.append,
            load_timeout_ms=10_000,
        )
    )
    try:
        await client.connect()
        info = await asyncio.wait_for(client.get_server_info(), timeout=10)
        account = info.get("account") if isinstance(info, dict) else None
        if not isinstance(account, dict):
            account = {}
        token_source = str(account.get("tokenSource") or "none")
        subscription_type = account.get("subscriptionType")
        api_provider = str(account.get("apiProvider") or "firstParty")
        return {
            "installed": True,
            "loggedIn": token_source.lower() != "none" or bool(subscription_type),
            "authMethod": token_source,
            "apiProvider": api_provider,
            "subscriptionType": subscription_type,
            "source": "sdk",
        }
    except Exception:
        fallback = await asyncio.to_thread(claude_auth_status)
        return {**fallback, "source": "cli"}
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass


def list_claude_models() -> list[dict[str, Any]]:
    default_efforts = [
        {"reasoningEffort": "", "description": "Use Claude's default effort"},
        {"reasoningEffort": "low", "description": "Fastest for simple tasks"},
        {"reasoningEffort": "medium", "description": "Lower subscription usage"},
        {"reasoningEffort": "high", "description": "Balanced coding effort"},
        {"reasoningEffort": "xhigh", "description": "Deeper reasoning"},
        {"reasoningEffort": "max", "description": "Maximum reasoning for this session"},
    ]
    return [
        {
            "id": "claude-default",
            "model": "default",
            "displayName": "Default",
            "description": "Recommended model for the signed-in Claude account",
            "isDefault": True,
            "defaultReasoningEffort": "",
            "supportedReasoningEfforts": default_efforts,
        },
        {
            "id": "claude-sonnet",
            "model": "sonnet",
            "displayName": "Sonnet",
            "description": "Daily coding tasks",
            "defaultReasoningEffort": "high",
            "supportedReasoningEfforts": default_efforts,
        },
        {
            "id": "claude-opus",
            "model": "opus",
            "displayName": "Opus",
            "description": "Complex reasoning and difficult coding tasks",
            "defaultReasoningEffort": "high",
            "supportedReasoningEfforts": default_efforts,
        },
        {
            "id": "claude-haiku",
            "model": "haiku",
            "displayName": "Haiku",
            "description": "Fast, simple, and mechanical tasks",
            "defaultReasoningEffort": "",
            "supportedReasoningEfforts": [default_efforts[0]],
        },
        {
            "id": "claude-opusplan",
            "model": "opusplan",
            "displayName": "Opus Plan",
            "description": "Opus for planning, then Sonnet for execution",
            "defaultReasoningEffort": "high",
            "supportedReasoningEfforts": default_efforts,
        },
        {
            "id": "claude-best",
            "model": "best",
            "displayName": "Best available",
            "description": "Most capable model available to this account",
            "defaultReasoningEffort": "high",
            "supportedReasoningEfforts": default_efforts,
        },
        {
            "id": "claude-fable",
            "model": "fable",
            "displayName": "Fable",
            "description": "Longest and most difficult tasks when account access permits",
            "defaultReasoningEffort": "high",
            "supportedReasoningEfforts": default_efforts,
        },
    ]


def _session_registry_path(settings: Settings) -> Path:
    return settings.history_path.with_suffix(".sqlite3")


def _init_session_registry(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS claude_sessions (
            conversation_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            workdir TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


def _read_session_mapping(settings: Settings, conversation_id: str) -> dict[str, str] | None:
    path = _session_registry_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        _init_session_registry(conn)
        row = conn.execute(
            "SELECT conversation_id, session_id, workdir FROM claude_sessions "
            "WHERE conversation_id = ?",
            (conversation_id,),
        ).fetchone()
    return dict(row) if row else None


def _save_session_mapping(
    settings: Settings, conversation_id: str, session_id: str, workdir: str
) -> None:
    path = _session_registry_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        _init_session_registry(conn)
        conn.execute(
            """
            INSERT INTO claude_sessions (conversation_id, session_id, workdir, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(conversation_id) DO UPDATE SET
                session_id = excluded.session_id,
                workdir = excluded.workdir,
                updated_at = CURRENT_TIMESTAMP
            """,
            (conversation_id, session_id, workdir),
        )


def _delete_session_mapping(settings: Settings, conversation_id: str) -> None:
    path = _session_registry_path(settings)
    if not path.exists():
        return
    with sqlite3.connect(path) as conn:
        _init_session_registry(conn)
        conn.execute("DELETE FROM claude_sessions WHERE conversation_id = ?", (conversation_id,))


_conversation_locks: dict[str, asyncio.Lock] = {}
_active_turns: dict[str, _ClaudeSdkTurn] = {}


def _conversation_lock(conversation_id: str) -> asyncio.Lock:
    lock = _conversation_locks.get(conversation_id)
    if lock is None:
        lock = asyncio.Lock()
        _conversation_locks[conversation_id] = lock
    return lock


async def close_claude_session(
    conversation_id: str | None, settings: Settings | None = None
) -> None:
    if not conversation_id:
        return
    async with _conversation_lock(conversation_id):
        turn = _active_turns.pop(conversation_id, None)
        if turn:
            await turn.interrupt()
        await asyncio.to_thread(
            _delete_session_mapping,
            settings or get_settings(),
            conversation_id,
        )


async def close_claude_sessions_for(conversation_ids: list[str]) -> None:
    for conversation_id in conversation_ids:
        await close_claude_session(conversation_id)


async def close_claude_sessions() -> None:
    for conversation_id in list(_active_turns):
        await close_claude_session(conversation_id)


def _tool_event(name: str, session_id: str) -> dict[str, Any]:
    name = name or "tool"
    item_type = (
        "fileChange"
        if name in {"Edit", "Write", "NotebookEdit"}
        else "commandExecution"
        if name == "Bash"
        else "toolCall"
    )
    summary = {
        "fileChange": "Claude is applying file changes.",
        "commandExecution": "Claude is running a command.",
    }.get(item_type, f"Claude is using {name}.")
    return {
        "type": "codex_event",
        "harness": "claude",
        "method": "item/started",
        "summary": summary,
        "item_type": item_type,
        "thread_id": session_id,
        "tool": name,
    }


def _text_delta(event: dict[str, Any]) -> str:
    if event.get("type") != "content_block_delta":
        return ""
    delta = event.get("delta")
    if not isinstance(delta, dict) or delta.get("type") != "text_delta":
        return ""
    return str(delta.get("text") or "")


def _claude_error(stderr: str, fallback: str = "Claude task failed") -> str:
    value = " ".join(stderr.split())
    lowered = value.lower()
    if "not logged in" in lowered or "authentication" in lowered or "please login" in lowered:
        return "Claude Code CLI is not signed in. Run `claude auth login` in Terminal, then retry."
    if "usage limit" in lowered or "rate limit" in lowered or "limit reached" in lowered:
        return (
            "Claude reached the current subscription usage limit. Wait for it to reset, then retry."
        )
    return value[-800:] if value else fallback


def _sdk_options(
    claude_bin: str,
    root: Path,
    resume_id: str | None,
    session_id: str,
    model: str | None,
    reasoning_effort: str | None,
    stderr_messages: list[str],
) -> ClaudeAgentOptions:
    return ClaudeAgentOptions(
        cli_path=claude_bin,
        cwd=root,
        env=subscription_only_environment(),
        tools=cast(Any, {"type": "preset", "preset": "claude_code"}),
        system_prompt=cast(Any, {"type": "preset", "preset": "claude_code"}),
        setting_sources=["user", "project", "local"],
        permission_mode="auto",
        include_partial_messages=True,
        resume=resume_id,
        session_id=None if resume_id else session_id,
        model=None if not model or model == "default" else model,
        effort=cast(Any, reasoning_effort or None),
        stderr=stderr_messages.append,
    )


def _message_session_id(message: object) -> str | None:
    if isinstance(message, SystemMessage):
        value = message.data.get("session_id")
        return str(value) if value else None
    value = getattr(message, "session_id", None)
    return str(value) if value else None


def _result_error(message: ResultMessage) -> str:
    details = [str(value) for value in message.errors or [] if str(value).strip()]
    details.extend(
        str(value)
        for value in (message.result, message.terminal_reason, message.stop_reason)
        if value and str(value).strip()
    )
    return _claude_error(" ".join(details), "Claude task failed.")


async def _run_claude_sdk(
    prompt: str,
    root: Path,
    settings: Settings,
    cancel_token: CancellationToken | None,
    conversation_id: str | None,
    model: str | None,
    reasoning_effort: str | None,
) -> AsyncIterator[dict[str, Any]]:
    claude_bin = installed_claude_bin()
    if not claude_bin:
        yield {
            "type": "error",
            "message": "Claude Code CLI is not installed. Install Claude Code, then retry.",
        }
        return

    saved = (
        await asyncio.to_thread(_read_session_mapping, settings, conversation_id)
        if conversation_id
        else None
    )
    resume_id = (
        str(saved["session_id"])
        if saved and saved.get("workdir") == str(root) and saved.get("session_id")
        else None
    )
    session_id = resume_id or str(uuid.uuid4())
    stderr_messages: list[str] = []
    client = ClaudeSDKClient(
        options=_sdk_options(
            claude_bin,
            root,
            resume_id,
            session_id,
            model,
            reasoning_effort,
            stderr_messages,
        )
    )
    turn = _ClaudeSdkTurn(client)
    if conversation_id:
        _active_turns[conversation_id] = turn
    if cancel_token:
        cancel_token.bind_turn(turn)
    events: list[dict[str, Any]] = []
    result_seen = False
    assistant_text: list[str] = []
    try:
        await client.connect()
        await client.query(prompt)
        yield {
            "type": "codex_event",
            "harness": "claude",
            "method": "turn/started",
            "summary": "Claude started working.",
            "thread_id": session_id,
        }
        async for message in client.receive_response():
            if cancel_token and cancel_token.is_cancelled:
                await turn.interrupt()
                raise asyncio.CancelledError

            payload_session_id = _message_session_id(message) or session_id
            if conversation_id and payload_session_id:
                await asyncio.to_thread(
                    _save_session_mapping,
                    settings,
                    conversation_id,
                    payload_session_id,
                    str(root),
                )
                session_id = payload_session_id

            if isinstance(message, StreamEvent):
                delta = _text_delta(message.event)
                if delta:
                    yield {"type": "delta", "text": delta, "harness": "claude"}
                continue

            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock) and block.text:
                        assistant_text.append(block.text)
                    elif isinstance(block, ToolUseBlock):
                        event = _tool_event(block.name, session_id)
                        events.append(event)
                        yield event
                continue

            if not isinstance(message, ResultMessage):
                continue
            result_seen = True
            success = message.subtype == "success" and not message.is_error
            result_text = str(message.result or "").strip() or "\n".join(assistant_text).strip()
            status = "completed" if success else "failed"
            completed_event = {
                "type": "codex_event",
                "harness": "claude",
                "method": "turn/completed",
                "summary": f"Claude finished with status: {status}.",
                "thread_id": session_id,
                "status": status,
                "token_usage": message.usage,
                "cost_usd": message.total_cost_usd,
            }
            events.append(completed_event)
            yield completed_event
            if not success:
                yield {
                    "type": "error",
                    "message": _result_error(message),
                    "events": events[-200:],
                    "harness": "claude",
                }
                return
            if not result_text:
                yield {
                    "type": "error",
                    "message": "Claude completed but returned no response.",
                    "events": events[-200:],
                    "harness": "claude",
                }
                return
            yield {
                "type": "done",
                "text": result_text,
                "workdir": str(root),
                "thread_id": session_id,
                "turn_id": None,
                "status": status,
                "events": events[-200:],
                "harness": "claude",
                "usage": message.usage,
                "cost_usd": message.total_cost_usd,
            }
            return

        if not result_seen:
            yield {
                "type": "error",
                "message": _claude_error(
                    " ".join(stderr_messages),
                    "Claude SDK stopped before completing the task.",
                ),
                "events": events[-200:],
                "harness": "claude",
            }
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        if cancel_token and cancel_token.is_cancelled:
            raise asyncio.CancelledError from exc
        yield {
            "type": "error",
            "message": _claude_error(
                " ".join([*stderr_messages, str(exc)]),
                "Claude SDK failed to run the task.",
            ),
            "events": events[-200:],
            "harness": "claude",
        }
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass
        if cancel_token:
            cancel_token.clear_turn(turn)
        if conversation_id and _active_turns.get(conversation_id) is turn:
            _active_turns.pop(conversation_id, None)


async def run_claude_stream(
    prompt: str,
    workdir: str,
    settings: Settings,
    cancel_token: CancellationToken | None = None,
    conversation_id: str | None = None,
    model: str | None = None,
    reasoning_effort: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    root = resolve_workdir(workdir)
    if conversation_id:
        async with _conversation_lock(conversation_id):
            async for event in _run_claude_sdk(
                prompt,
                root,
                settings,
                cancel_token,
                conversation_id,
                model,
                reasoning_effort,
            ):
                yield event
        return
    async for event in _run_claude_sdk(
        prompt, root, settings, cancel_token, None, model, reasoning_effort
    ):
        yield event


async def run_claude_stream_with_timer(
    prompt: str,
    workdir: str,
    settings: Settings,
    cancel_token: CancellationToken | None = None,
    conversation_id: str | None = None,
    model: str | None = None,
    reasoning_effort: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
    done = False
    latest_status = "Claude started working."

    async def stream_reader() -> None:
        nonlocal done, latest_status
        try:
            async for event in run_claude_stream(
                prompt,
                workdir,
                settings,
                cancel_token,
                conversation_id,
                model,
                reasoning_effort,
            ):
                if event.get("type") == "codex_event":
                    latest_status = str(event.get("summary") or latest_status)
                await queue.put(event)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await queue.put({"type": "error", "message": str(exc), "harness": "claude"})
        finally:
            done = True
            await queue.put(None)

    async def timer_worker() -> None:
        loop = asyncio.get_running_loop()
        started = loop.time()
        try:
            await asyncio.sleep(_CLAUDE_STATUS_FIRST_DELAY_SECONDS)
            while not done:
                elapsed = int(loop.time() - started)
                await queue.put(
                    {
                        "type": "status",
                        "message": f"{latest_status} (elapsed: {elapsed}s)",
                        "elapsed": elapsed,
                        "harness": "claude",
                    }
                )
                await asyncio.sleep(_CLAUDE_STATUS_REPEAT_SECONDS)
        except asyncio.CancelledError:
            pass

    reader_task = asyncio.create_task(stream_reader())
    timer_task = asyncio.create_task(timer_worker())
    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            yield item
    finally:
        timer_task.cancel()
        reader_task.cancel()
        await asyncio.gather(reader_task, timer_task, return_exceptions=True)
