import asyncio
import subprocess
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, AsyncIterator, Awaitable, Callable, Protocol, cast

from .settings import Settings, get_settings


_CODEX_STATUS_FIRST_DELAY_SECONDS = 20
_CODEX_STATUS_REPEAT_SECONDS = 60


class _InterruptibleTurn(Protocol):
    async def interrupt(self) -> None: ...


class _CodexClient(Protocol):
    async def __aenter__(self) -> "_CodexClient": ...

    async def close(self) -> None: ...

    async def thread_start(self, **kwargs: Any) -> "_CodexThread": ...

    async def thread_resume(self, thread_id: str, **kwargs: Any) -> "_CodexThread": ...


class _CodexThread(Protocol):
    @property
    def id(self) -> str | None: ...

    async def turn(self, input: Any, **kwargs: Any) -> "_CodexTurn": ...


class _CodexTurn(Protocol):
    @property
    def id(self) -> str | None: ...

    async def interrupt(self) -> None: ...

    def stream(self) -> AsyncIterator[Any]: ...


@dataclass
class CodexRun:
    final_response: str
    workdir: str
    thread_id: str | None = None
    turn_id: str | None = None
    status: str | None = None
    events: list[dict[str, Any]] | None = None


@dataclass
class CodexCheckpoint:
    created: bool
    commit: str | None
    message: str
    skipped_reason: str | None = None


class CancellationToken:
    def __init__(self):
        self._is_cancelled = False
        self._active_turn: _InterruptibleTurn | None = None

    def cancel(self):
        self._is_cancelled = True
        self._interrupt_active_turn()

    @property
    def is_cancelled(self) -> bool:
        return self._is_cancelled

    def bind_turn(self, turn: _InterruptibleTurn) -> None:
        self._active_turn = turn
        if self._is_cancelled:
            self._interrupt_active_turn()

    def clear_turn(self, turn: _InterruptibleTurn) -> None:
        if self._active_turn is turn:
            self._active_turn = None

    def _interrupt_active_turn(self) -> None:
        turn = self._active_turn
        if turn is None:
            return
        interrupt = getattr(turn, "interrupt", None)
        if not callable(interrupt):
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.create_task(self._interrupt_safely(cast(Callable[[], Awaitable[None]], interrupt)))

    async def _interrupt_safely(self, interrupt: Callable[[], Awaitable[None]]) -> None:
        try:
            await interrupt()
        except Exception:
            pass


def resolve_workdir(workdir: str) -> Path:
    root = Path(workdir).expanduser()
    try:
        root = root.resolve(strict=True)
    except FileNotFoundError as exc:
        raise FileNotFoundError(f"Directory does not exist: {workdir}") from exc
    if not root.is_dir():
        raise NotADirectoryError(f"Not a directory: {workdir}")
    return root


def _git_output(root: Path, args: list[str]) -> str:
    try:
        proc = subprocess.run(
            ["git", "-C", str(root), *args],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except Exception:
        return ""
    return proc.stdout.strip() if proc.returncode == 0 else ""


def _git_status_code(root: Path, args: list[str], timeout: int = 10) -> tuple[int, str, str]:
    proc = subprocess.run(
        ["git", "-C", str(root), *args],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()


def _compact_commit_message(message: str) -> str:
    value = " ".join(str(message or "").split())
    if len(value) > 72:
        return value[:69].rstrip() + "..."
    return value


def create_pre_codex_checkpoint(
    workdir: str,
    message: str = "Checkpoint before Codex turn",
) -> CodexCheckpoint:
    root = resolve_workdir(workdir)
    git_root_value = _git_output(root, ["rev-parse", "--show-toplevel"])
    if not git_root_value:
        return CodexCheckpoint(False, None, message, "not_git")
    git_root = Path(git_root_value).resolve()
    status = _git_output(git_root, ["status", "--short"])
    if not status:
        return CodexCheckpoint(False, None, message, "clean")

    add_code, _stdout, add_stderr = _git_status_code(git_root, ["add", "-A", "--"], timeout=30)
    if add_code != 0:
        raise ValueError(add_stderr or "Failed to stage checkpoint changes")

    diff_code, _stdout, diff_stderr = _git_status_code(git_root, ["diff", "--cached", "--quiet"])
    if diff_code == 0:
        return CodexCheckpoint(False, None, message, "clean")
    if diff_code not in (0, 1):
        raise ValueError(diff_stderr or "Failed to inspect checkpoint changes")

    commit_message = _compact_commit_message(message)
    commit_code, _stdout, commit_stderr = _git_status_code(
        git_root,
        ["commit", "-m", commit_message],
        timeout=30,
    )
    if commit_code != 0:
        raise ValueError(commit_stderr or "Failed to create checkpoint commit")
    commit_id = _git_output(git_root, ["rev-parse", "--short", "HEAD"])
    return CodexCheckpoint(True, commit_id, commit_message)


def _codex_modes(settings: Settings):
    from openai_codex import ApprovalMode, Sandbox

    approval_mode = (
        ApprovalMode.deny_all
        if settings.codex_approval_mode == "never"
        else ApprovalMode.auto_review
    )
    sandbox = (
        Sandbox.full_access
        if settings.codex_sandbox_mode == "danger-full-access"
        else Sandbox.workspace_write
    )
    return approval_mode, sandbox


@dataclass
class _ThreadSession:
    codex: _CodexClient
    thread: _CodexThread
    workdir: str
    approval_mode: object
    sandbox: object
    lock: asyncio.Lock
    active_turn: _CodexTurn | None = None
    last_used: datetime | None = None


_sessions: dict[str, _ThreadSession] = {}
_sessions_lock = asyncio.Lock()
_SESSION_IDLE_TTL = timedelta(minutes=30)
_SESSION_LIMIT = 12


def _thread_registry_path(settings: Settings) -> Path:
    return settings.history_path.with_suffix(".sqlite3")


def _init_thread_registry(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS codex_threads (
            conversation_id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL,
            workdir TEXT NOT NULL,
            approval_mode TEXT NOT NULL,
            sandbox_mode TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )


def _read_thread_mapping(settings: Settings, conversation_id: str) -> dict[str, str] | None:
    path = _thread_registry_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        _init_thread_registry(conn)
        row = conn.execute(
            """
            SELECT conversation_id, thread_id, workdir, approval_mode, sandbox_mode, updated_at
            FROM codex_threads
            WHERE conversation_id = ?
            """,
            (conversation_id,),
        ).fetchone()
    return dict(row) if row else None


def _save_thread_mapping(
    settings: Settings,
    *,
    conversation_id: str,
    thread_id: str | None,
    workdir: str,
) -> None:
    if not thread_id:
        return
    path = _thread_registry_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        _init_thread_registry(conn)
        conn.execute(
            """
            INSERT INTO codex_threads (
                conversation_id, thread_id, workdir, approval_mode, sandbox_mode, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(conversation_id) DO UPDATE SET
                thread_id = excluded.thread_id,
                workdir = excluded.workdir,
                approval_mode = excluded.approval_mode,
                sandbox_mode = excluded.sandbox_mode,
                updated_at = excluded.updated_at
            """,
            (
                conversation_id,
                thread_id,
                workdir,
                settings.codex_approval_mode,
                settings.codex_sandbox_mode,
                _now().isoformat(),
            ),
        )


def _delete_thread_mapping(settings: Settings, conversation_id: str | None) -> None:
    if not conversation_id:
        return
    path = _thread_registry_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        _init_thread_registry(conn)
        conn.execute("DELETE FROM codex_threads WHERE conversation_id = ?", (conversation_id,))


def _session_key(conversation_id: str) -> str:
    return f"chat:{conversation_id}"


async def _close_session(session: _ThreadSession) -> None:
    async with session.lock:
        try:
            await session.codex.close()
        except Exception:
            pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _evict_idle_sessions_locked() -> list[_ThreadSession]:
    now = _now()
    stale: list[_ThreadSession] = []
    for key, session in list(_sessions.items()):
        last_used = session.last_used or now
        if session.active_turn is None and now - last_used > _SESSION_IDLE_TTL:
            stale.append(_sessions.pop(key))
    if len(_sessions) > _SESSION_LIMIT:
        idle = sorted(
            ((key, session) for key, session in _sessions.items() if session.active_turn is None),
            key=lambda item: item[1].last_used or now,
        )
        for key, _session in idle[: max(0, len(_sessions) - _SESSION_LIMIT)]:
            stale.append(_sessions.pop(key))
    return stale


async def _get_thread_session(
    workdir: str, settings: Settings, conversation_id: str | None = None
) -> _ThreadSession:
    from openai_codex import AsyncCodex, CodexConfig

    if not conversation_id:
        raise ValueError("conversation_id is required for reusable Codex sessions")

    root = resolve_workdir(workdir)
    approval_mode, sandbox = _codex_modes(settings)
    key = _session_key(conversation_id)
    old_session = None
    stale_sessions: list[_ThreadSession] = []
    async with _sessions_lock:
        stale_sessions = await _evict_idle_sessions_locked()
        session = _sessions.get(key)
        if (
            session
            and session.workdir == str(root)
            and session.approval_mode == approval_mode
            and session.sandbox == sandbox
        ):
            session.last_used = _now()
            return session

        if session:
            old_session = _sessions.pop(key, None)

    for stale_session in stale_sessions:
        await _close_session(stale_session)

    if old_session:
        await _close_session(old_session)

    codex = cast(_CodexClient, AsyncCodex(CodexConfig(cwd=str(root))))
    await codex.__aenter__()
    saved = _read_thread_mapping(settings, conversation_id)
    thread = None
    if (
        saved
        and saved.get("workdir") == str(root)
        and saved.get("approval_mode") == settings.codex_approval_mode
        and saved.get("sandbox_mode") == settings.codex_sandbox_mode
        and saved.get("thread_id")
    ):
        try:
            thread = cast(
                _CodexThread,
                await codex.thread_resume(
                    str(saved["thread_id"]),
                    approval_mode=approval_mode,
                    sandbox=sandbox,
                    cwd=str(root),
                ),
            )
        except Exception:
            thread = None
    if thread is None:
        thread = cast(
            _CodexThread,
            await codex.thread_start(approval_mode=approval_mode, sandbox=sandbox, cwd=str(root)),
        )
    _save_thread_mapping(
        settings,
        conversation_id=conversation_id,
        thread_id=getattr(thread, "id", None),
        workdir=str(root),
    )
    session = _ThreadSession(
        codex=codex,
        thread=thread,
        workdir=str(root),
        approval_mode=approval_mode,
        sandbox=sandbox,
        lock=asyncio.Lock(),
        last_used=_now(),
    )
    async with _sessions_lock:
        current = _sessions.get(key)
        if current is not None:
            await _close_session(session)
            current.last_used = _now()
            return current
        _sessions[key] = session
        return session


async def close_codex_thread_session(conversation_id: str | None) -> None:
    if not conversation_id:
        return
    async with _sessions_lock:
        session = _sessions.pop(_session_key(conversation_id), None)
    if conversation_id:
        _delete_thread_mapping(get_settings(), conversation_id)
    if session:
        await _close_session(session)


async def close_codex_thread_sessions_for(conversation_ids: list[str]) -> None:
    for conversation_id in conversation_ids:
        await close_codex_thread_session(conversation_id)


async def close_codex_thread_sessions() -> None:
    async with _sessions_lock:
        sessions = list(_sessions.values())
        _sessions.clear()
    for session in sessions:
        await _close_session(session)


async def interrupt_codex_thread_session(conversation_id: str | None) -> bool:
    if not conversation_id:
        return False
    async with _sessions_lock:
        session = _sessions.get(_session_key(conversation_id))
    if not session:
        return False
    # Snapshot active_turn to avoid a race with _stream_turn's finally block
    # which sets active_turn = None after the lock is released.
    turn = session.active_turn
    if not turn:
        return False
    try:
        await turn.interrupt()
        return True
    except Exception:
        return False


def _dump_model(obj: Any) -> dict[str, Any]:
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json", by_alias=True, exclude_none=True)
    return {}


def _enum_value(value: Any) -> str | None:
    if value is None:
        return None
    return str(getattr(value, "value", value))


def _root_item(item: Any) -> Any:
    return getattr(item, "root", item)


def _event_summary(method: str, payload: Any) -> str:
    item = _root_item(getattr(payload, "item", None))
    item_type = getattr(item, "type", None)
    if method == "turn/started":
        return "Codex started working."
    if method == "turn/completed":
        turn = getattr(payload, "turn", None)
        status = _enum_value(getattr(turn, "status", None))
        return f"Codex finished with status: {status or 'completed'}."
    if method == "item/started":
        if item_type == "commandExecution":
            return f"Running command: {getattr(item, 'command', '')}".strip()
        if item_type == "fileChange":
            return "Applying file changes."
        if item_type == "mcpToolCall":
            return f"Calling tool: {getattr(item, 'tool', '')}".strip()
        if item_type == "plan":
            return "Updating the plan."
        if item_type == "reasoning":
            return "Thinking through the task."
        return f"Started {item_type or 'item'}."
    if method == "item/completed":
        if item_type == "commandExecution":
            status = _enum_value(getattr(item, "status", None))
            command = getattr(item, "command", "")
            return f"Command {status or 'completed'}: {command}".strip()
        if item_type == "fileChange":
            return "File changes recorded."
        if item_type == "agentMessage":
            text = str(getattr(item, "text", "")).strip()
            return text[:180] if text else "Codex wrote a response."
        return f"Completed {item_type or 'item'}."
    if method == "item/plan/delta":
        return "Codex is updating its plan."
    if method == "item/reasoning/summaryTextDelta":
        return "Codex is reasoning through the task."
    if method == "item/commandExecution/outputDelta":
        return "Command output is streaming."
    if method == "item/fileChange/patchUpdated":
        return "File patch updated."
    if method == "thread/tokenUsage/updated":
        return "Token usage updated."
    return method


def _find_token_usage(value: Any) -> dict[str, int] | None:
    if isinstance(value, dict):
        usage: dict[str, int] = {}
        for key, amount in value.items():
            normalized_key = str(key).replace("-", "_").lower()
            if normalized_key in {
                "input_tokens",
                "output_tokens",
                "total_tokens",
                "cached_input_tokens",
            }:
                try:
                    usage[normalized_key] = int(amount)
                except (TypeError, ValueError):
                    pass
        if usage:
            return usage
        for nested in value.values():
            found = _find_token_usage(nested)
            if found:
                return found
    elif isinstance(value, list):
        for nested in value:
            found = _find_token_usage(nested)
            if found:
                return found
    return None


def _normalize_event(event: Any, *, include_payload: bool = True) -> dict[str, Any]:
    method = str(getattr(event, "method", "unknown"))
    payload = getattr(event, "payload", None)
    payload_dump = _dump_model(payload)
    item = _root_item(getattr(payload, "item", None))
    turn = getattr(payload, "turn", None)
    item_id = getattr(payload, "item_id", None) or getattr(item, "id", None)
    turn_id = getattr(payload, "turn_id", None) or getattr(turn, "id", None)
    thread_id = getattr(payload, "thread_id", None)
    data: dict[str, Any] = {
        "method": method,
        "summary": _event_summary(method, payload),
    }
    # The full payload can be very large (model_dump output). Include it in
    # real-time streaming so the client has full detail, but callers that
    # persist events (e.g. history) should pass include_payload=False.
    if include_payload:
        data["payload"] = payload_dump
    if method == "thread/tokenUsage/updated":
        token_usage = _find_token_usage(payload_dump)
        if token_usage:
            data["token_usage"] = token_usage
    if item_id:
        data["item_id"] = item_id
    if turn_id:
        data["turn_id"] = turn_id
    if thread_id:
        data["thread_id"] = thread_id
    item_type = getattr(item, "type", None)
    if item_type:
        data["item_type"] = item_type
    if item_type == "commandExecution":
        data["command"] = getattr(item, "command", "")
        data["status"] = _enum_value(getattr(item, "status", None))
        data["output"] = getattr(item, "aggregated_output", None)
        data["exit_code"] = getattr(item, "exit_code", None)
    elif item_type == "fileChange":
        data["status"] = _enum_value(getattr(item, "status", None))
    elif item_type == "agentMessage":
        data["text"] = getattr(item, "text", "")
    return data


def _strip_payload(event: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of the event without the heavy 'payload' field for persistence."""
    return {k: v for k, v in event.items() if k != "payload"}


async def _run_ephemeral_turn(
    prompt: str,
    workdir: str,
    settings: Settings,
    cancel_token: CancellationToken | None,
) -> AsyncIterator[dict[str, Any]]:
    from openai_codex import AsyncCodex, CodexConfig

    root = resolve_workdir(workdir)
    approval_mode, sandbox = _codex_modes(settings)
    async with AsyncCodex(CodexConfig(cwd=str(root))) as codex:
        thread = cast(
            _CodexThread,
            await codex.thread_start(approval_mode=approval_mode, sandbox=sandbox, cwd=str(root)),
        )
        async for item in _stream_turn(thread, prompt, str(root), cancel_token):
            yield item


async def _stream_turn(
    thread: _CodexThread,
    prompt: str,
    workdir: str,
    cancel_token: CancellationToken | None,
    session: _ThreadSession | None = None,
) -> AsyncIterator[dict[str, Any]]:
    parts: list[str] = []
    events: list[dict[str, Any]] = []
    turn = await thread.turn(prompt)
    if cancel_token:
        cancel_token.bind_turn(turn)
    if session:
        session.active_turn = turn
        session.last_used = _now()
    try:
        async for event in turn.stream():
            if cancel_token and cancel_token.is_cancelled:
                try:
                    await turn.interrupt()
                except Exception:
                    pass
            normalized = _normalize_event(event)
            events.append(normalized)
            yield {"type": "codex_event", **normalized}
            if event.method == "item/agentMessage/delta":
                delta = getattr(event.payload, "delta", "")
                if delta:
                    parts.append(delta)
                    yield {"type": "delta", "text": delta}
            if event.method == "turn/completed":
                turn_payload = getattr(event.payload, "turn", None)
                status = _enum_value(getattr(turn_payload, "status", None))
                final = "".join(parts).strip()
                if not final:
                    for raw_item in getattr(turn_payload, "items", []) or []:
                        item = _root_item(raw_item)
                        if getattr(item, "type", None) == "agentMessage":
                            final = str(getattr(item, "text", "") or "").strip()
                yield {
                    "type": "done",
                    "text": final or "Done.",
                    "workdir": workdir,
                    "thread_id": getattr(thread, "id", None),
                    "turn_id": getattr(turn, "id", None),
                    "status": status,
                    "events": [_strip_payload(e) for e in events[-200:]],
                }
                return
    except Exception as exc:
        yield {
            "type": "error",
            "message": str(exc),
            "events": [_strip_payload(e) for e in events[-200:]],
        }
    finally:
        if cancel_token:
            cancel_token.clear_turn(turn)
        if session:
            session.last_used = _now()
            session.active_turn = None


async def run_codex(
    prompt: str, workdir: str, settings: Settings, conversation_id: str | None = None
) -> CodexRun:
    final = ""
    resolved_workdir = str(resolve_workdir(workdir))
    thread_id = None
    turn_id = None
    status = None
    events: list[dict[str, Any]] = []
    async for event in run_codex_stream(
        prompt, resolved_workdir, settings, conversation_id=conversation_id
    ):
        if event.get("type") == "codex_event":
            events.append(dict(event))
        elif event.get("type") == "done":
            final = str(event.get("text") or "")
            resolved_workdir = str(event.get("workdir") or resolved_workdir)
            thread_id = event.get("thread_id")
            turn_id = event.get("turn_id")
            status = event.get("status")
            events = list(event.get("events") or events)
        elif event.get("type") == "error":
            raise RuntimeError(str(event.get("message") or "Codex failed"))
    return CodexRun(final, resolved_workdir, thread_id, turn_id, status, events)


async def run_codex_stream(
    prompt: str,
    workdir: str,
    settings: Settings,
    cancel_token: CancellationToken | None = None,
    conversation_id: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    if settings.codex_auto_checkpoint:
        checkpoint = create_pre_codex_checkpoint(workdir)
        yield {
            "type": "checkpoint",
            "created": checkpoint.created,
            "commit": checkpoint.commit,
            "message": checkpoint.message,
            "skipped_reason": checkpoint.skipped_reason,
        }

    if conversation_id:
        session = await _get_thread_session(workdir, settings, conversation_id)
        async with session.lock:
            async for item in _stream_turn(
                session.thread, prompt, session.workdir, cancel_token, session
            ):
                yield item
        return

    async for item in _run_ephemeral_turn(prompt, workdir, settings, cancel_token):
        yield item


async def run_codex_stream_with_timer(
    prompt: str,
    workdir: str,
    settings: Settings,
    cancel_token: CancellationToken | None = None,
    conversation_id: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    queue: asyncio.Queue = asyncio.Queue()
    done = False
    latest_status = "Codex started working."

    async def stream_reader():
        nonlocal done, latest_status
        try:
            async for event in run_codex_stream(
                prompt, workdir, settings, cancel_token, conversation_id
            ):
                if event.get("type") == "codex_event":
                    latest_status = str(event.get("summary") or latest_status)
                await queue.put(event)
        except Exception as exc:
            await queue.put({"type": "error", "message": str(exc)})
        finally:
            done = True
            await queue.put(None)

    async def timer_worker():
        import time

        start_time = time.time()
        try:
            await asyncio.sleep(_CODEX_STATUS_FIRST_DELAY_SECONDS)
            while not done:
                elapsed = int(time.time() - start_time)
                await queue.put(
                    {
                        "type": "status",
                        "message": f"{latest_status} (elapsed: {elapsed}s)",
                        "elapsed": elapsed,
                    }
                )
                await asyncio.sleep(_CODEX_STATUS_REPEAT_SECONDS)
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
