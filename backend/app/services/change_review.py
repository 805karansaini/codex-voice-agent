from __future__ import annotations

import shutil
import subprocess
from pathlib import Path, PurePosixPath
from typing import Protocol

from typing_extensions import TypedDict

from ..codex_runner import resolve_workdir


class RevertResult(TypedDict):
    ok: bool
    reverted_files: list[str]


class CommitResult(TypedDict):
    ok: bool
    commit: str | None
    committed_files: list[str]
    message: str


class ArtifactWriter(Protocol):
    def create(
        self,
        *,
        chat_id: str | None,
        message_id: str | None,
        title: str,
        summary: str,
        content: str,
        content_type: str,
        source: str,
        workdir: str | None,
    ) -> dict[str, object]: ...


class EventLogger(Protocol):
    def write(self, event: str, **payload: object) -> None: ...


def artifact_summary(text: object, limit: int = 220) -> str:
    value = " ".join(str(text or "").split())
    if not value:
        return "Codex completed without a textual result."
    return value if len(value) <= limit else value[:limit].rstrip() + "..."


def artifact_content_type(text: object) -> str:
    value = str(text or "")
    if value.startswith("diff --git ") or "\n@@ " in value:
        return "diff"
    if value.startswith(("```", "## ", "### ")):
        return "markdown"
    if "\n| " in value and "\n|-" in value:
        return "markdown"
    markdown_markers = ("```", "\n## ", "\n### ", "\n- [", "\n* [")
    return "markdown" if any(marker in value for marker in markdown_markers) else "text"


def create_tool_artifact(
    *,
    artifacts: ArtifactWriter,
    app_log: EventLogger,
    chat_id: str | None,
    message_id: str | None,
    title: str,
    content: object,
    source: str,
    workdir: str | None,
) -> dict[str, object] | None:
    text = str(content or "").strip()
    if not text:
        return None
    item = artifacts.create(
        chat_id=chat_id,
        message_id=message_id,
        title=title,
        summary=artifact_summary(text),
        content=text,
        content_type=artifact_content_type(text),
        source=source,
        workdir=workdir,
    )
    app_log.write(
        "artifact.created",
        chat_id=chat_id,
        message_id=message_id,
        artifact_id=item["id"],
        title=title,
        source=source,
        content_chars=len(text),
    )
    return item


def event_item_type(event: object) -> str:
    if not isinstance(event, dict):
        return ""
    nested = event.get("event")
    if isinstance(nested, dict):
        return str(nested.get("item_type") or nested.get("type") or "")
    return str(event.get("item_type") or "")


def has_file_changes(events: list[object]) -> bool:
    return any(event_item_type(event) == "fileChange" for event in events)


def git_output(root: Path, args: list[str]) -> str:
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


def changed_files_from_status(status_text: str) -> list[str]:
    files: list[str] = []
    for line in status_text.splitlines():
        value = line[3:].strip() if len(line) > 3 else ""
        if " -> " in value:
            value = value.split(" -> ", 1)[1].strip()
        if value:
            files.append(value)
    return files


def create_change_review_artifact(
    *,
    artifacts: ArtifactWriter,
    app_log: EventLogger,
    chat_id: str | None,
    workdir: str | None,
    codex_events: list[object],
) -> dict[str, object] | None:
    if not workdir or not has_file_changes(codex_events):
        return None
    try:
        root = resolve_workdir(workdir)
    except Exception:
        return None
    status_text = git_output(root, ["status", "--short"])
    diff_text = git_output(root, ["diff", "--no-ext-diff", "HEAD", "--"])
    if not status_text and not diff_text:
        return None
    files = changed_files_from_status(status_text)
    file_summary = f"{len(files)} file{'s' if len(files) != 1 else ''} changed"
    content = "\n".join(
        part
        for part in [
            f"# Git status\n\n```text\n{status_text or '(clean)'}\n```",
            f"# Diff\n\n```diff\n{diff_text or '(no tracked diff)'}\n```",
        ]
        if part
    )
    artifact = artifacts.create(
        chat_id=chat_id,
        message_id=None,
        title=f"Change review: {file_summary}",
        summary=file_summary,
        content=content,
        content_type="diff",
        source="git_diff",
        workdir=str(root),
    )
    artifact["changed_files"] = files
    app_log.write(
        "artifact.created",
        chat_id=chat_id,
        artifact_id=artifact["id"],
        title=artifact["title"],
        source="git_diff",
        content_chars=len(content),
        changed_file_count=len(files),
    )
    return artifact


def safe_changed_file(value: str) -> str:
    normalized = value.replace("\\", "/").strip().strip("/")
    path = PurePosixPath(normalized)
    if not normalized or path.is_absolute() or ".." in path.parts:
        raise ValueError(f"Unsafe changed file path: {value}")
    return path.as_posix()


def git_file_is_tracked(root: Path, rel_path: str) -> bool:
    proc = subprocess.run(
        ["git", "-C", str(root), "ls-files", "--error-unmatch", "--", rel_path],
        capture_output=True,
        text=True,
        timeout=5,
    )
    return proc.returncode == 0


def revert_changed_files(workdir: str, files: list[str]) -> RevertResult:
    if not files:
        raise ValueError("No changed files were provided")
    root = resolve_workdir(workdir)
    if not (root / ".git").exists() and not git_output(root, ["rev-parse", "--show-toplevel"]):
        raise ValueError("Workdir is not inside a git repository")

    reverted: list[str] = []
    for raw_file in files:
        rel_path = safe_changed_file(raw_file)
        target = (root / rel_path).resolve()
        if target != root and root not in target.parents:
            raise ValueError(f"Changed file path escapes workdir: {raw_file}")
        if git_file_is_tracked(root, rel_path):
            proc = subprocess.run(
                [
                    "git",
                    "-C",
                    str(root),
                    "restore",
                    "--source=HEAD",
                    "--worktree",
                    "--staged",
                    "--",
                    rel_path,
                ],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if proc.returncode != 0:
                raise ValueError(proc.stderr.strip() or f"Failed to restore {rel_path}")
        elif target.exists():
            if target.is_dir() and not target.is_symlink():
                shutil.rmtree(target)
            else:
                target.unlink()
        reverted.append(rel_path)
    return {"ok": True, "reverted_files": reverted}


def compact_commit_message(message: str) -> str:
    value = " ".join(str(message or "").split())
    if len(value) > 72:
        return value[:69].rstrip() + "..."
    return value


def commit_changed_files(workdir: str, files: list[str], message: str) -> CommitResult:
    if not files:
        raise ValueError("No changed files were provided")
    commit_message = compact_commit_message(message)
    if not commit_message:
        raise ValueError("Commit message is required")
    root = resolve_workdir(workdir)
    if not (root / ".git").exists() and not git_output(root, ["rev-parse", "--show-toplevel"]):
        raise ValueError("Workdir is not inside a git repository")

    safe_files = [safe_changed_file(raw_file) for raw_file in files]
    for rel_path in safe_files:
        target = (root / rel_path).resolve()
        if target != root and root not in target.parents:
            raise ValueError(f"Changed file path escapes workdir: {rel_path}")

    add_proc = subprocess.run(
        ["git", "-C", str(root), "add", "--", *safe_files],
        capture_output=True,
        text=True,
        timeout=10,
    )
    if add_proc.returncode != 0:
        raise ValueError(add_proc.stderr.strip() or "Failed to stage changed files")

    diff_proc = subprocess.run(
        ["git", "-C", str(root), "diff", "--cached", "--quiet", "--", *safe_files],
        capture_output=True,
        text=True,
        timeout=10,
    )
    if diff_proc.returncode == 0:
        raise ValueError("No staged changes to commit")
    if diff_proc.returncode not in (0, 1):
        raise ValueError(diff_proc.stderr.strip() or "Failed to inspect staged changes")

    commit_proc = subprocess.run(
        ["git", "-C", str(root), "commit", "-m", commit_message, "--", *safe_files],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if commit_proc.returncode != 0:
        raise ValueError(commit_proc.stderr.strip() or "Failed to commit changed files")
    commit_id = git_output(root, ["rev-parse", "--short", "HEAD"])
    return {
        "ok": True,
        "commit": commit_id,
        "committed_files": safe_files,
        "message": commit_message,
    }
