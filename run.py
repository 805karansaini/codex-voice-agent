#!/usr/bin/env python3

from __future__ import annotations

import ipaddress
import os
import socket
import subprocess
from collections.abc import Iterable

import uvicorn

_LAN_NETWORKS = (
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
)
_TAILSCALE_NETWORK = ipaddress.ip_network("100.64.0.0/10")


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


def _bind_socket(host: str, port: int) -> socket.socket:
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    bound_socket = socket.socket(family=family, type=socket.SOCK_STREAM)
    try:
        bound_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        bound_socket.bind((host, port))
        bound_socket.set_inheritable(True)
    except BaseException:
        bound_socket.close()
        raise
    return bound_socket


def _bind_sockets(hosts: Iterable[str], port: int) -> list[socket.socket]:
    bound_sockets: list[socket.socket] = []
    try:
        for host in hosts:
            bound_sockets.append(_bind_socket(host, port))
    except BaseException:
        for bound_socket in bound_sockets:
            bound_socket.close()
        raise
    return bound_sockets


def _run_server(hosts: list[str]) -> None:
    if not hosts:
        raise ValueError("At least one server host is required")

    port = int(os.getenv("PORT", "8765"))
    config = uvicorn.Config(
        "backend.app.main:app",
        host=hosts[0],
        port=port,
        reload=False,
        log_level=os.getenv("LOG_LEVEL", "info"),
    )
    server = uvicorn.Server(config)
    bound_sockets = _bind_sockets(hosts, port)
    print(f"Starting backend on: {', '.join(hosts)}", flush=True)
    try:
        try:
            server.run(sockets=bound_sockets)
        except KeyboardInterrupt:
            return
        if not server.started:
            raise RuntimeError("Backend failed to start")
    finally:
        for bound_socket in bound_sockets:
            bound_socket.close()


if __name__ == "__main__":
    _run_server(_hosts())
