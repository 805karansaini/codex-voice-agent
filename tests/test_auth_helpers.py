import unittest

from backend.app.main import _artifact_content_type, _bearer_token, _is_local_host


class AuthHelperTests(unittest.TestCase):
    def test_bearer_token_parses_valid_header(self) -> None:
        self.assertEqual(_bearer_token("Bearer secret-token"), "secret-token")

    def test_bearer_token_rejects_other_schemes(self) -> None:
        self.assertIsNone(_bearer_token("Basic abc"))
        self.assertIsNone(_bearer_token(None))

    def test_local_host_detection_is_narrow(self) -> None:
        self.assertTrue(_is_local_host("127.0.0.1"))
        self.assertTrue(_is_local_host("::1"))
        self.assertFalse(_is_local_host("192.168.1.4"))

    def test_artifact_content_type_keeps_command_output_as_text(self) -> None:
        self.assertEqual(_artifact_content_type("- item\n| pipe in shell output\n`literal`"), "text")

    def test_artifact_content_type_detects_markdown_and_diff(self) -> None:
        self.assertEqual(_artifact_content_type("## Summary\n\n- [x] Done"), "markdown")
        self.assertEqual(_artifact_content_type("diff --git a/a.txt b/a.txt\n@@ -1 +1 @@"), "diff")


if __name__ == "__main__":
    unittest.main()
