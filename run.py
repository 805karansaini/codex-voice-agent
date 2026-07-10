#!/usr/bin/env python3

from __future__ import annotations

import ipaddress
import os
import signal
import subprocess
import sys
import time
from collections.abc import Iterable
from typing import Protocol

import uvicorn


_LAN_NETWORKS = (
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
)
_TAILSCALE_NETWORK = ipaddress.ip_network("100.64.0.0/10")


class _ManagedProcess(Protocol):
    def poll(self) -> int | None: ...

    def terminate(self) -> None: ...

    def wait(self, timeout: float | None = None) -> int: ...

    def kill(self) -> None: ...


class _ShutdownRequested(Exception):
    def __init__(self, signum: int) -> None:
        self.signum = signum


def _interface_addresses() -> list[str]:
    try:
        result = subprocess.run(["ifconfig"], check=True, capture_output=True, text=True)
    except (OSError, subprocess.CalledProcessError):
        return []

    addresses: list[str] = []
    for line in result.stdout.splitlines():
        fields = line.strip().split()
        if len(fields) >= 2 and fields[0] == "inet":
            addresses.append(fields[1])
    return addresses


def _is_lan_address(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    return address.version == 4 and any(address in network for network in _LAN_NETWORKS)


def _is_tailscale_address(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    return address.version == 4 and address in _TAILSCALE_NETWORK


def _dedupe(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            ordered.append(value)
    return ordered


def _default_hosts() -> list[str]:
    interfaces = _interface_addresses()
    return _dedupe(
        [
            "127.0.0.1",
            *(address for address in interfaces if _is_lan_address(address)),
            *(address for address in interfaces if _is_tailscale_address(address)),
        ]
    )


def _hosts() -> list[str]:
    single_host = os.getenv("HOST")
    if single_host:
        return [single_host]

    configured = os.getenv("HOSTS")
    if configured:
        return _dedupe(host.strip() for host in configured.split(","))

    return _default_hosts()


def _run_server(host: str) -> None:
    uvicorn.run(
        "backend.app.main:app",
        host=host,
        port=int(os.getenv("PORT", "8765")),
        reload=False,
        log_level=os.getenv("LOG_LEVEL", "info"),
    )


def _wait_for_first_exit(
    processes: Iterable[_ManagedProcess], *, poll_interval_seconds: float = 0.1
) -> int:
    managed_processes = list(processes)
    if not managed_processes:
        raise ValueError("At least one server process is required")

    while True:
        for process in managed_processes:
            exit_code = process.poll()
            if exit_code is not None:
                return exit_code
        time.sleep(poll_interval_seconds)


def _stop_processes(processes: Iterable[_ManagedProcess]) -> None:
    managed_processes = list(processes)
    for process in managed_processes:
        if process.poll() is None:
            process.terminate()
    for process in managed_processes:
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


def _shutdown_signal_handler(signum: int, _frame: object) -> None:
    raise _ShutdownRequested(signum)


def _run_servers(hosts: list[str]) -> int:
    print(f"Starting backend on: {', '.join(hosts)}", flush=True)
    processes: list[_ManagedProcess] = []
    try:
        for host in hosts:
            processes.append(
                subprocess.Popen([sys.executable, __file__], env={**os.environ, "HOST": host})
            )
        return _wait_for_first_exit(processes)
    except KeyboardInterrupt:
        return 130
    except _ShutdownRequested as shutdown:
        return 128 + shutdown.signum
    finally:
        _stop_processes(processes)


if __name__ == "__main__":
    hosts = _hosts()
    if len(hosts) == 1:
        _run_server(hosts[0])
        raise SystemExit

    previous_sigterm_handler = signal.signal(signal.SIGTERM, _shutdown_signal_handler)
    try:
        exit_code = _run_servers(hosts)
    finally:
        signal.signal(signal.SIGTERM, previous_sigterm_handler)
    raise SystemExit(exit_code)
