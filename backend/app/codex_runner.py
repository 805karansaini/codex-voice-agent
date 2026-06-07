import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncIterator

from .settings import Settings


@dataclass
class CodexRun:
    final_response: str
    workdir: str
    thread_id: str | None = None
    turn_id: str | None = None
    status: str | None = None
    events: list[dict[str, Any]] | None = None


class CancellationToken:
    def __init__(self):
        self._is_cancelled = False

    def cancel(self):
        self._is_cancelled = True

    @property
    def is_cancelled(self) -> bool:
        return self._is_cancelled


def resolve_workdir(workdir: str) -> Path:
    root = Path(workdir).expanduser()
    try:
        root = root.resolve(strict=True)
    except FileNotFoundError as exc:
        raise FileNotFoundError(f"Directory does not exist: {workdir}") from exc
    if not root.is_dir():
        raise NotADirectoryError(f"Not a directory: {workdir}")
    return root


def _codex_modes(settings: Settings):
    from openai_codex import ApprovalMode, Sandbox

    approval_mode = ApprovalMode.deny_all if settings.codex_approval_mode == "never" else ApprovalMode.auto_review
    sandbox = Sandbox.full_access if settings.codex_sandbox_mode == "danger-full-access" else Sandbox.workspace_write
    return approval_mode, sandbox


@dataclass
class _ThreadSession:
    codex: object
    thread: object
    workdir: str
    approval_mode: object
    sandbox: object
    lock: asyncio.Lock
    active_turn: object | None = None


_sessions: dict[str, _ThreadSession] = {}
_sessions_lock = asyncio.Lock()


def _session_key(conversation_id: str) -> str:
    return f"chat:{conversation_id}"


async def _close_session(session: _ThreadSession) -> None:
    async with session.lock:
        try:
            await session.codex.close()
        except Exception:
            pass


async def _get_thread_session(workdir: str, settings: Settings, conversation_id: str | None = None) -> _ThreadSession:
    from openai_codex import AsyncCodex, CodexConfig

    if not conversation_id:
        raise ValueError("conversation_id is required for reusable Codex sessions")

    root = resolve_workdir(workdir)
    approval_mode, sandbox = _codex_modes(settings)
    key = _session_key(conversation_id)
    old_session = None
    async with _sessions_lock:
        session = _sessions.get(key)
        if (
            session
            and session.workdir == str(root)
            and session.approval_mode == approval_mode
            and session.sandbox == sandbox
        ):
            return session

        if session:
            old_session = _sessions.pop(key, None)

    if old_session:
        await _close_session(old_session)

    codex = AsyncCodex(CodexConfig(cwd=str(root)))
    await codex.__aenter__()
    thread = await codex.thread_start(approval_mode=approval_mode, sandbox=sandbox, cwd=str(root))
    session = _ThreadSession(
        codex=codex,
        thread=thread,
        workdir=str(root),
        approval_mode=approval_mode,
        sandbox=sandbox,
        lock=asyncio.Lock(),
    )
    async with _sessions_lock:
        current = _sessions.get(key)
        if current is not None:
            await _close_session(session)
            return current
        _sessions[key] = session
        return session


async def close_codex_thread_session(conversation_id: str | None) -> None:
    if not conversation_id:
        return
    async with _sessions_lock:
        session = _sessions.pop(_session_key(conversation_id), None)
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


def _normalize_event(event: Any) -> dict[str, Any]:
    method = str(getattr(event, "method", "unknown"))
    payload = getattr(event, "payload", None)
    payload_json = _dump_model(payload)
    item = _root_item(getattr(payload, "item", None))
    turn = getattr(payload, "turn", None)
    item_id = getattr(payload, "item_id", None) or getattr(item, "id", None)
    turn_id = getattr(payload, "turn_id", None) or getattr(turn, "id", None)
    thread_id = getattr(payload, "thread_id", None)
    data: dict[str, Any] = {
        "method": method,
        "summary": _event_summary(method, payload),
        "payload": payload_json,
    }
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
        thread = await codex.thread_start(approval_mode=approval_mode, sandbox=sandbox, cwd=str(root))
        async for item in _stream_turn(thread, prompt, str(root), cancel_token):
            yield item


async def _stream_turn(
    thread: object,
    prompt: str,
    workdir: str,
    cancel_token: CancellationToken | None,
    session: _ThreadSession | None = None,
) -> AsyncIterator[dict[str, Any]]:
    parts: list[str] = []
    events: list[dict[str, Any]] = []
    turn = await thread.turn(prompt)
    if session:
        session.active_turn = turn
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
        yield {"type": "error", "message": str(exc), "events": [_strip_payload(e) for e in events[-200:]]}
    finally:
        if session:
            session.active_turn = None


async def run_codex(prompt: str, workdir: str, settings: Settings, conversation_id: str | None = None) -> CodexRun:
    final = ""
    resolved_workdir = str(resolve_workdir(workdir))
    thread_id = None
    turn_id = None
    status = None
    events: list[dict[str, Any]] = []
    async for event in run_codex_stream(prompt, resolved_workdir, settings, conversation_id=conversation_id):
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
    cancel_token: CancellationToken = None,
    conversation_id: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    if conversation_id:
        session = await _get_thread_session(workdir, settings, conversation_id)
        async with session.lock:
            async for item in _stream_turn(session.thread, prompt, session.workdir, cancel_token, session):
                yield item
        return

    async for item in _run_ephemeral_turn(prompt, workdir, settings, cancel_token):
        yield item


async def run_codex_stream_with_timer(
    prompt: str,
    workdir: str,
    settings: Settings,
    cancel_token: CancellationToken = None,
    conversation_id: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    queue: asyncio.Queue = asyncio.Queue()
    done = False
    latest_status = "Codex started working."

    async def stream_reader():
        nonlocal done, latest_status
        try:
            async for event in run_codex_stream(prompt, workdir, settings, cancel_token, conversation_id):
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
            await asyncio.sleep(20)
            while not done:
                elapsed = int(time.time() - start_time)
                await queue.put({"type": "status", "message": f"{latest_status} (elapsed: {elapsed}s)", "elapsed": elapsed})
                await asyncio.sleep(60)
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
