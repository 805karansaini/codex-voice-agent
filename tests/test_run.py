import unittest
from unittest.mock import Mock, patch

import run


class FakeSocket:
    def __init__(self, *, bind_error: OSError | None = None) -> None:
        self.bind_error = bind_error
        self.options: list[tuple[int, int, int]] = []
        self.address: tuple[str, int] | None = None
        self.inheritable: bool | None = None
        self.closed = False

    def setsockopt(self, level: int, option: int, value: int) -> None:
        self.options.append((level, option, value))

    def bind(self, address: tuple[str, int]) -> None:
        if self.bind_error is not None:
            raise self.bind_error
        self.address = address

    def set_inheritable(self, inheritable: bool) -> None:
        self.inheritable = inheritable

    def close(self) -> None:
        self.closed = True


class RunScriptTests(unittest.TestCase):
    def test_default_hosts_include_any_tailscale_address(self) -> None:
        with patch.object(
            run,
            "_interface_addresses",
            return_value=["127.0.0.1", "192.168.1.6", "100.99.1.2", "169.254.5.6"],
        ):
            self.assertEqual(run._default_hosts(), ["127.0.0.1", "192.168.1.6", "100.99.1.2"])

    def test_host_environment_variable_takes_precedence(self) -> None:
        with patch.dict(
            run.os.environ,
            {"HOST": "10.0.0.4", "HOSTS": "127.0.0.1,192.168.1.6"},
            clear=True,
        ):
            self.assertEqual(run._hosts(), ["10.0.0.4"])

    def test_hosts_environment_variable_preserves_order_and_removes_duplicates(self) -> None:
        with patch.dict(
            run.os.environ,
            {"HOSTS": " 192.168.1.6,127.0.0.1,192.168.1.6 "},
            clear=True,
        ):
            self.assertEqual(run._hosts(), ["192.168.1.6", "127.0.0.1"])

    def test_all_bound_sockets_are_passed_to_one_server(self) -> None:
        first_socket = FakeSocket()
        second_socket = FakeSocket()
        server = Mock()
        server.started = True

        with patch.dict(run.os.environ, {"PORT": "9000", "LOG_LEVEL": "warning"}, clear=True):
            with patch.object(run, "_bind_sockets", return_value=[first_socket, second_socket]):
                with patch.object(run.uvicorn, "Config") as config_factory:
                    with patch.object(run.uvicorn, "Server", return_value=server) as server_factory:
                        run._run_server(["127.0.0.1", "192.168.1.6"])

        config_factory.assert_called_once_with(
            "backend.app.main:app",
            host="127.0.0.1",
            port=9000,
            reload=False,
            log_level="warning",
        )
        server_factory.assert_called_once_with(config_factory.return_value)
        server.run.assert_called_once_with(sockets=[first_socket, second_socket])
        self.assertTrue(first_socket.closed)
        self.assertTrue(second_socket.closed)

    def test_failed_server_startup_raises_and_closes_sockets(self) -> None:
        bound_socket = FakeSocket()
        server = Mock()
        server.started = False

        with patch.object(run, "_bind_sockets", return_value=[bound_socket]):
            with patch.object(run.uvicorn, "Server", return_value=server):
                with self.assertRaisesRegex(RuntimeError, "Backend failed to start"):
                    run._run_server(["127.0.0.1"])

        self.assertTrue(bound_socket.closed)

    def test_keyboard_interrupt_during_startup_exits_cleanly(self) -> None:
        bound_socket = FakeSocket()
        server = Mock()
        server.started = False
        server.run.side_effect = KeyboardInterrupt

        with patch.object(run, "_bind_sockets", return_value=[bound_socket]):
            with patch.object(run.uvicorn, "Server", return_value=server):
                run._run_server(["127.0.0.1"])

        self.assertTrue(bound_socket.closed)

    def test_partial_bind_failure_closes_every_opened_socket(self) -> None:
        first_socket = FakeSocket()
        failed_socket = FakeSocket(bind_error=OSError("bind failed"))

        with patch.object(run.socket, "socket", side_effect=[first_socket, failed_socket]):
            with self.assertRaisesRegex(OSError, "bind failed"):
                run._bind_sockets(["127.0.0.1", "192.168.1.6"], 8765)

        self.assertTrue(first_socket.closed)
        self.assertTrue(failed_socket.closed)

    def test_empty_host_list_is_rejected_before_server_startup(self) -> None:
        with patch.object(run.uvicorn, "Server") as server_factory:
            with self.assertRaisesRegex(ValueError, "At least one server host"):
                run._run_server([])

        server_factory.assert_not_called()
