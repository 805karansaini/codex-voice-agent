import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator

from .settings import Settings


@dataclass
class CodexRun:
    final_response: str
    workdir: str


class CancellationToken:
    def __init__(self):
        self._is_cancelled = False

    def cancel(self):
        self._is_cancelled = True

    @property
    def is_cancelled(self) -> bool:
        return self._is_cancelled


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


async def run_codex_stream(prompt: str, workdir: str, settings: Settings, cancel_token: CancellationToken = None) -> AsyncIterator[dict]:
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
                    if cancel_token and cancel_token.is_cancelled:
                        loop.call_soon_threadsafe(queue.put_nowait, {"type": "error", "message": "Task cancelled by user."})
                        break
                    payload = event.payload
                    if isinstance(payload, AgentMessageDeltaNotification) and payload.delta:
                        parts.append(payload.delta)
                        loop.call_soon_threadsafe(queue.put_nowait, {"type": "delta", "text": payload.delta})
            final = "".join(parts).strip() or "Done."
            if not (cancel_token and cancel_token.is_cancelled):
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
        if cancel_token:
            cancel_token.cancel()
        if future.done():
            await future


def summarize_progress(accumulated_text: str) -> str:
    lines = [line.strip() for line in accumulated_text.splitlines() if line.strip()]
    for line in reversed(lines):
        if "Running command" in line or "Executing" in line or "$ " in line:
            cmd = line.split("Running command:")[-1].split("Executing:")[-1].strip()
            if cmd.startswith("$"):
                cmd = cmd[1:].strip()
            return f"Codex is running: {cmd}"
        if "Reading file" in line or "inspecting" in line.lower():
            file = line.split("Reading file")[-1].strip()
            return f"Codex is reading {Path(file).name if '/' in file else file}"
        if "Writing file" in line or "Editing file" in line or "Updating file" in line:
            file = line.split("file")[-1].strip()
            return f"Codex is modifying {Path(file).name if '/' in file else file}"
    return "Codex is still working on the task"


async def run_codex_stream_with_timer(prompt: str, workdir: str, settings: Settings, cancel_token: CancellationToken = None) -> AsyncIterator[dict]:
    """Stream a Codex turn with a background timer that emits status events for long-running tasks.

    Yields incremental events:
      - {"type": "delta", "text": str}
      - {"type": "status", "message": str, "elapsed": int}
      - {"type": "done", "text": str, "workdir": str}
      - {"type": "error", "message": str}
    """
    import time
    queue: asyncio.Queue = asyncio.Queue()
    done = False
    accumulated_parts = []

    async def stream_reader():
        nonlocal done
        try:
            async for event in run_codex_stream(prompt, workdir, settings, cancel_token):
                if event.get("type") == "delta":
                    accumulated_parts.append(event.get("text", ""))
                await queue.put(event)
        except Exception as exc:
            await queue.put({"type": "error", "message": str(exc)})
        finally:
            done = True
            await queue.put(None)

    async def timer_worker():
        start_time = time.time()
        try:
            # Wait 30 seconds for the first "still working" update
            await asyncio.sleep(30)
            if not done:
                elapsed = int(time.time() - start_time)
                text_so_far = "".join(accumulated_parts)
                progress_summary = summarize_progress(text_so_far)
                msg = f"{progress_summary} (elapsed: {elapsed} seconds)"
                await queue.put({
                    "type": "status",
                    "message": msg,
                    "elapsed": elapsed
                })
            
            # After that, send updates every 120 seconds (2 minutes)
            while not done:
                await asyncio.sleep(120)
                if not done:
                    elapsed = int(time.time() - start_time)
                    text_so_far = "".join(accumulated_parts)
                    progress_summary = summarize_progress(text_so_far)
                    msg = f"{progress_summary} (elapsed: {elapsed}s)..."
                    await queue.put({
                        "type": "status",
                        "message": msg,
                        "elapsed": elapsed
                    })
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
