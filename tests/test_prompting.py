import unittest

from backend.app.prompting import build_recent_conversation_context, improve_codex_task_prompt


class PromptingTests(unittest.TestCase):
    def test_context_strips_hallucinated_inline_tool_call_text(self) -> None:
        context = build_recent_conversation_context(
            [
                {"role": "user", "text": "Check the repo"},
                {
                    "role": "assistant",
                    "text": "Calling run_codex_task task: inspect the files\nI will report back.",
                },
            ],
            limit=5,
        )

        self.assertIn("user: Check the repo", context)
        self.assertIn("assistant: I will report back.", context)
        self.assertNotIn("run_codex_task", context)

    def test_context_drops_assistant_message_that_is_only_fake_tool_call(self) -> None:
        context = build_recent_conversation_context(
            [
                {
                    "role": "assistant",
                    "text": "run_codex_task\ntask: inspect the files\nworkdir: /tmp/project",
                },
                {"role": "user", "text": "What happened?"},
            ],
            limit=5,
        )

        self.assertEqual(context, "user: What happened?")

    def test_context_strips_dangling_codex_call_claim(self) -> None:
        context = build_recent_conversation_context(
            [
                {"role": "assistant", "text": "Calling run_codex_task. Done now."},
            ],
            limit=5,
        )

        self.assertEqual(context, "assistant: Done now.")

    def test_codex_task_prompt_cleans_common_voice_transcription_errors(self) -> None:
        prompt = improve_codex_task_prompt("ask the kodak agent about the converstaioon")

        self.assertEqual(prompt, "ask the Codex agent about the conversation")


if __name__ == "__main__":
    unittest.main()
