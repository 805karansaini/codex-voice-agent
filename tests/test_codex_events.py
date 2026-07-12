import unittest
from types import SimpleNamespace

from backend.app.codex_runner import _enable_ultra_reasoning_effort, _normalize_event


class FakePayload:
    def model_dump(self, **_kwargs):
        return {
            "usage": {
                "input_tokens": 1200,
                "output_tokens": 340,
                "total_tokens": 1540,
            }
        }


class CodexEventTests(unittest.TestCase):
    def test_codex_sdk_accepts_ultra_reasoning_effort(self) -> None:
        from openai_codex.generated.v2_all import ReasoningEffort

        _enable_ultra_reasoning_effort()

        self.assertEqual(ReasoningEffort("ultra").value, "ultra")

    def test_token_usage_event_keeps_compact_usage(self) -> None:
        event = SimpleNamespace(method="thread/tokenUsage/updated", payload=FakePayload())

        normalized = _normalize_event(event, include_payload=False)

        self.assertEqual(
            normalized["token_usage"],
            {"input_tokens": 1200, "output_tokens": 340, "total_tokens": 1540},
        )


if __name__ == "__main__":
    unittest.main()
