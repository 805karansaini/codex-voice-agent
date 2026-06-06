import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator

from .settings import Settings


@dataclass
class CodexRun:
    final_response: str
    workdir: str


def resolve_workdir(workdir: str) -> Path:
    """Resolve a project directory to an existing folder on disk.

    The app operates on the *original* folder in place — it never copies or
    creates directories. If the path does not exist we fail loudly so a wrong
    path can be corrected instead of silently spawning an empty folder.
    """
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


def _run_codex_sync(prompt: str, workdir: str, settings: Settings) -> CodexRun:
    from openai_codex import Codex, CodexConfig

    root = resolve_workdir(workdir)
    approval_mode, sandbox = _codex_modes(settings)
    with Codex(CodexConfig(cwd=str(root))) as codex:
        thread = codex.thread_start(approval_mode=approval_mode, sandbox=sandbox, cwd=str(root))
        result = thread.run(prompt)
        return CodexRun(final_response=result.final_response or "", workdir=str(root))


async def run_codex(prompt: str, workdir: str, settings: Settings) -> CodexRun:
    return await asyncio.to_thread(_run_codex_sync, prompt, workdir, settings)


async def run_codex_stream(prompt: str, workdir: str, settings: Settings) -> AsyncIterator[dict]:
    """Stream a Codex turn, yielding incremental events.

    Events: {"type":"delta","text":str}, then {"type":"done","text":str,"workdir":str},
    or {"type":"error","message":str}. The blocking SDK stream is pumped from a worker
    thread into an asyncio queue so the response text reaches the client as it is produced.
    """
    from openai_codex import Codex, CodexConfig
    from openai_codex.generated.v2_all import AgentMessageDeltaNotification

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    sentinel = object()

    def worker() -> None:
        try:
            root = resolve_workdir(workdir)
            approval_mode, sandbox = _codex_modes(settings)
            parts: list[str] = []
            with Codex(CodexConfig(cwd=str(root))) as codex:
                thread = codex.thread_start(approval_mode=approval_mode, sandbox=sandbox, cwd=str(root))
                turn = thread.turn(prompt)
                for event in turn.stream():
                    payload = event.payload
                    if isinstance(payload, AgentMessageDeltaNotification) and payload.delta:
                        parts.append(payload.delta)
                        loop.call_soon_threadsafe(queue.put_nowait, {"type": "delta", "text": payload.delta})
            final = "".join(parts).strip() or "Done."
            loop.call_soon_threadsafe(queue.put_nowait, {"type": "done", "text": final, "workdir": str(root)})
        except Exception as exc:  # surfaced to the client as an error event
            loop.call_soon_threadsafe(queue.put_nowait, {"type": "error", "message": str(exc)})
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, sentinel)

    future = loop.run_in_executor(None, worker)
    try:
        while True:
            item = await queue.get()
            if item is sentinel:
                break
            yield item
    finally:
        await future
