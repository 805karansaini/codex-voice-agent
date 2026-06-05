import asyncio
from dataclasses import dataclass
from pathlib import Path

from .settings import Settings


@dataclass
class CodexRun:
    final_response: str
    workdir: str


def _run_codex_sync(prompt: str, workdir: str, settings: Settings) -> CodexRun:
    from openai_codex import ApprovalMode, Codex, CodexConfig, Sandbox

    root = Path(workdir).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    approval_mode = ApprovalMode.deny_all if settings.codex_approval_mode == "never" else ApprovalMode.auto_review
    sandbox = Sandbox.full_access if settings.codex_sandbox_mode == "danger-full-access" else Sandbox.workspace_write
    with Codex(CodexConfig(cwd=str(root))) as codex:
        thread = codex.thread_start(approval_mode=approval_mode, sandbox=sandbox, cwd=str(root))
        result = thread.run(prompt)
        return CodexRun(final_response=result.final_response or "", workdir=str(root))


async def run_codex(prompt: str, workdir: str, settings: Settings) -> CodexRun:
    return await asyncio.to_thread(_run_codex_sync, prompt, workdir, settings)
