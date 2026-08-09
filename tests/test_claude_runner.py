from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from claude_agent_sdk import (
    AssistantMessage,
    ResultMessage,
    StreamEvent,
    ToolUseBlock,
)

from backend.app import claude_runner, coding_runner
from backend.app.settings import Settings


class _FakeSdkClient:
    def __init__(self, messages: list[object], server_info: dict[str, Any] | None = None) -> None:
        self.messages = messages
        self.server_info = server_info
        self.connected = False
        self.disconnected = False
        self.interrupted = False
        self.prompt = ""

    async def connect(self) -> None:
        self.connected = True

    async def query(self, prompt: str) -> None:
        self.prompt = prompt

    async def receive_response(self):
        for message in self.messages:
            yield message

    async def get_server_info(self) -> dict[str, Any] | None:
        return self.server_info

    async def interrupt(self) -> None:
        self.interrupted = True

    async def disconnect(self) -> None:
        self.disconnected = True


def _success_result(session_id: str = "session-1") -> ResultMessage:
    return ResultMessage(
        subtype="success",
        duration_ms=10,
        duration_api_ms=5,
        is_error=False,
        num_turns=1,
        session_id=session_id,
        result="All checks passed.",
        usage={"input_tokens": 10, "output_tokens": 5},
    )


def test_subscription_environment_removes_api_and_gateway_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "paid-api-key")
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "paid-auth-token")
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://example.invalid")
    monkeypatch.setenv("CLAUDE_CODE_USE_BEDROCK", "1")

    env = claude_runner.subscription_only_environment()

    assert "ANTHROPIC_API_KEY" not in env
    assert "ANTHROPIC_AUTH_TOKEN" not in env
    assert "ANTHROPIC_BASE_URL" not in env
    assert "CLAUDE_CODE_USE_BEDROCK" not in env
    assert env["CLAUDE_CODE_DISABLE_1M_CONTEXT"] == "1"


@pytest.mark.asyncio
async def test_claude_sdk_auth_probe_reuses_subscription_account_without_a_prompt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}
    client = _FakeSdkClient(
        [],
        server_info={
            "account": {
                "subscriptionType": "max",
                "tokenSource": "oauth",
                "apiProvider": "firstParty",
            }
        },
    )

    def create_client(*, options: Any) -> _FakeSdkClient:
        captured["options"] = options
        return client

    monkeypatch.setattr(claude_runner, "installed_claude_bin", lambda: "/bin/claude")
    monkeypatch.setattr(claude_runner, "ClaudeSDKClient", create_client)

    status = await claude_runner.probe_claude_sdk_auth_status()

    assert status == {
        "installed": True,
        "loggedIn": True,
        "authMethod": "oauth",
        "apiProvider": "firstParty",
        "subscriptionType": "max",
        "source": "sdk",
    }
    assert client.connected
    assert client.disconnected
    assert client.prompt == ""
    assert captured["options"].strict_mcp_config is True
    assert captured["options"].env.get("ANTHROPIC_API_KEY") is None


@pytest.mark.asyncio
async def test_harness_discovery_uses_the_sdk_subscription_probe(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def probe_auth() -> dict[str, Any]:
        return {
            "installed": True,
            "loggedIn": True,
            "authMethod": "oauth",
            "subscriptionType": "max",
        }

    async def codex_models() -> list[dict[str, Any]]:
        return [{"id": "codex-model"}]

    monkeypatch.setattr(coding_runner, "probe_claude_sdk_auth_status", probe_auth)
    monkeypatch.setattr(coding_runner, "list_codex_models", codex_models)

    harnesses = await coding_runner.list_coding_harnesses()
    claude = next(item for item in harnesses if item["id"] == "claude")

    assert claude["authenticated"] is True
    assert claude["subscriptionType"] == "max"
    assert claude["authMethod"] == "oauth"
    assert claude["error"] == ""


@pytest.mark.asyncio
async def test_claude_sdk_uses_selected_model_effort_and_subscription_env(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    captured: dict[str, Any] = {}
    client = _FakeSdkClient(
        [
            StreamEvent(
                uuid="event-1",
                session_id="session-1",
                event={
                    "type": "content_block_delta",
                    "delta": {"type": "text_delta", "text": "Working..."},
                },
            ),
            AssistantMessage(
                session_id="session-1",
                content=[ToolUseBlock(id="tool-1", name="Bash", input={})],
                model="sonnet",
            ),
            _success_result(),
        ]
    )

    def create_client(*, options: Any) -> _FakeSdkClient:
        captured["options"] = options
        return client

    monkeypatch.setattr(claude_runner, "installed_claude_bin", lambda: "/bin/claude")
    monkeypatch.setattr(claude_runner, "ClaudeSDKClient", create_client)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "must-not-leak")
    settings = Settings(DATA_DIR=tmp_path)

    events = [
        event
        async for event in claude_runner.run_claude_stream(
            "Run the checks",
            str(tmp_path),
            settings,
            conversation_id="chat-1",
            model="sonnet",
            reasoning_effort="high",
        )
    ]

    options = captured["options"]
    assert options.cli_path == "/bin/claude"
    assert options.permission_mode == "auto"
    assert options.model == "sonnet"
    assert options.effort == "high"
    assert options.env.get("ANTHROPIC_API_KEY") is None
    assert options.resume is None
    assert client.connected
    assert client.disconnected
    assert client.prompt == "Run the checks"
    assert any(event.get("method") == "item/started" for event in events)
    assert events[-1]["type"] == "done"
    assert events[-1]["text"] == "All checks passed."
    assert events[-1]["harness"] == "claude"


@pytest.mark.asyncio
async def test_claude_sdk_reports_missing_existing_login(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(claude_runner, "installed_claude_bin", lambda: "/bin/claude")
    client = _FakeSdkClient(
        [
            ResultMessage(
                subtype="success",
                duration_ms=10,
                duration_api_ms=5,
                is_error=True,
                num_turns=0,
                session_id="session-1",
                result="Not logged in · Please run /login",
            )
        ]
    )
    monkeypatch.setattr(claude_runner, "ClaudeSDKClient", lambda *, options: client)
    settings = Settings(DATA_DIR=tmp_path)

    events = [
        event async for event in claude_runner.run_claude_stream("Do work", str(tmp_path), settings)
    ]

    assert events[-1]["type"] == "error"
    assert events[-1]["message"] == (
        "Claude Code CLI is not signed in. Run `claude auth login` in Terminal, then retry."
    )


@pytest.mark.asyncio
async def test_claude_sdk_resumes_the_saved_conversation(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    clients = [
        _FakeSdkClient([_success_result("persisted-session")]),
        _FakeSdkClient([_success_result("persisted-session")]),
    ]
    captured_options: list[Any] = []

    def create_client(*, options: Any) -> _FakeSdkClient:
        captured_options.append(options)
        return clients[len(captured_options) - 1]

    monkeypatch.setattr(claude_runner, "installed_claude_bin", lambda: "/bin/claude")
    monkeypatch.setattr(claude_runner, "ClaudeSDKClient", create_client)
    settings = Settings(DATA_DIR=tmp_path)

    for prompt in ("First turn", "Follow-up turn"):
        events = [
            event
            async for event in claude_runner.run_claude_stream(
                prompt,
                str(tmp_path),
                settings,
                conversation_id="chat-1",
            )
        ]
        assert events[-1]["type"] == "done"

    assert captured_options[0].resume is None
    assert captured_options[0].session_id is not None
    assert captured_options[1].resume == "persisted-session"
    assert captured_options[1].session_id is None


@pytest.mark.asyncio
async def test_dispatcher_selects_claude(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    async def fake_claude(*_args: Any, **_kwargs: Any):
        yield {"type": "done", "text": "Claude result"}

    monkeypatch.setattr(coding_runner, "run_claude_stream_with_timer", fake_claude)
    events = [
        event
        async for event in coding_runner.run_coding_stream_with_timer(
            "Task",
            str(tmp_path),
            Settings(DATA_DIR=tmp_path),
            harness="claude",
        )
    ]

    assert events == [{"type": "done", "text": "Claude result", "harness": "claude"}]
