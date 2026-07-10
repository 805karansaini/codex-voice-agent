import unittest
from unittest.mock import patch

import run


class FakeProcess:
    def __init__(self, poll_results: list[int | None], *, wait_result: int = 0) -> None:
        self.poll_results = iter(poll_results)
        self.last_poll_result: int | None = None
        self.wait_result = wait_result
        self.terminated = False
        self.killed = False

    def poll(self) -> int | None:
        try:
            self.last_poll_result = next(self.poll_results)
        except StopIteration:
            pass
        return self.last_poll_result

    def terminate(self) -> None:
        self.terminated = True

    def wait(self, timeout: float | None = None) -> int:
        return self.wait_result

    def kill(self) -> None:
        self.killed = True


class RunScriptTests(unittest.TestCase):
    def test_default_hosts_include_any_tailscale_address(self) -> None:
        with patch.object(
            run,
            "_interface_addresses",
            return_value=["127.0.0.1", "192.168.1.6", "100.99.1.2", "169.254.5.6"],
        ):
            self.assertEqual(run._default_hosts(), ["127.0.0.1", "192.168.1.6", "100.99.1.2"])

    def test_later_child_failure_is_detected_without_waiting_for_first_child(self) -> None:
        first_child = FakeProcess([None])
        failed_child = FakeProcess([1])

        self.assertEqual(
            run._wait_for_first_exit([first_child, failed_child], poll_interval_seconds=0), 1
        )

    def test_partial_startup_failure_stops_already_started_child(self) -> None:
        started_child = FakeProcess([None, None])
        with patch.object(run.subprocess, "Popen", side_effect=[started_child, OSError("bind failed")]):
            with self.assertRaisesRegex(OSError, "bind failed"):
                run._run_servers(["127.0.0.1", "192.168.1.6"])

        self.assertTrue(started_child.terminated)

    def test_sigterm_request_stops_all_children_and_returns_signal_exit_code(self) -> None:
        first_child = FakeProcess([None, None])
        second_child = FakeProcess([None, None])
        with patch.object(run.subprocess, "Popen", side_effect=[first_child, second_child]):
            with patch.object(
                run,
                "_wait_for_first_exit",
                side_effect=run._ShutdownRequested(15),
            ):
                self.assertEqual(run._run_servers(["127.0.0.1", "192.168.1.6"]), 143)

        self.assertTrue(first_child.terminated)
        self.assertTrue(second_child.terminated)
