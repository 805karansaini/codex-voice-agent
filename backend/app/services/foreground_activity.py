from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, ParamSpec, TypeVar


class ForegroundActivityUnavailable(RuntimeError):
    """Raised when work tries to enter a scope that is being cleared."""


@dataclass(frozen=True)
class ActivityScope:
    chat_id: str | None = None
    project_id: str | None = None
    workdir: str | None = None

    @property
    def keys(self) -> tuple[str, ...]:
        values = (
            ("chat", self.chat_id),
            ("project", self.project_id),
            ("workdir", self.workdir),
        )
        return tuple(f"{kind}:{value}" for kind, value in values if value)


@dataclass(eq=False)
class _ActivityRecord:
    scope: ActivityScope
    owner: asyncio.Task[Any]


@dataclass
class _ScopeState:
    key: str
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    generation: int = 0
    cleaning: bool = False
    available: asyncio.Event = field(default_factory=asyncio.Event)
    records: set[_ActivityRecord] = field(default_factory=set)
    active_commits: int = 0
    commits_idle: asyncio.Event = field(default_factory=asyncio.Event)
    reservations: int = 0

    def __post_init__(self) -> None:
        self.available.set()
        self.commits_idle.set()


P = ParamSpec("P")
R = TypeVar("R")


class ForegroundActivityLease:
    def __init__(
        self,
        *,
        states: tuple[_ScopeState, ...],
        generations: tuple[int, ...],
        record: _ActivityRecord,
    ) -> None:
        self._states = states
        self._generations = generations
        self._record = record
        self._released = False

    async def is_active(self) -> bool:
        if self._released:
            return False
        await _acquire_state_locks(self._states)
        try:
            return self._is_active_locked()
        finally:
            _release_state_locks(self._states)

    async def bind_owner(self, owner: asyncio.Task[Any] | None = None) -> None:
        """Move cancellation ownership when a response body starts streaming."""
        task = owner or asyncio.current_task()
        if task is None:
            raise RuntimeError("Foreground activity requires an asyncio task")
        await _acquire_state_locks(self._states)
        try:
            if not self._is_active_locked():
                raise ForegroundActivityUnavailable("The chat is being cleared")
            self._record.owner = task
        finally:
            _release_state_locks(self._states)

    async def run_sync(self, function: Callable[P, R], *args: P.args, **kwargs: P.kwargs) -> R:
        """Run a blocking write without letting cleanup overtake the worker thread."""
        await _acquire_state_locks(self._states)
        try:
            if not self._is_active_locked():
                raise ForegroundActivityUnavailable("The chat is being cleared")
            for state in self._states:
                state.active_commits += 1
                state.commits_idle.clear()
        finally:
            _release_state_locks(self._states)

        worker = asyncio.create_task(asyncio.to_thread(function, *args, **kwargs))
        try:
            return await asyncio.shield(worker)
        except asyncio.CancelledError:
            # asyncio.to_thread cannot stop a function that has begun. Await it so
            # the deletion barrier never clears the store before this write settles.
            while not worker.done():
                try:
                    await asyncio.shield(worker)
                except asyncio.CancelledError:
                    continue
            try:
                worker.result()
            except BaseException:
                pass
            raise
        finally:
            finish_task = asyncio.create_task(self._finish_commit())
            cancelled = await _await_task_uninterruptibly(finish_task)
            if cancelled:
                raise asyncio.CancelledError

    def _is_active_locked(self) -> bool:
        return all(
            not state.cleaning and state.generation == generation
            for state, generation in zip(self._states, self._generations, strict=True)
        )

    async def _finish_commit(self) -> None:
        await _acquire_state_locks(self._states)
        try:
            for state in self._states:
                state.active_commits -= 1
                if state.active_commits == 0:
                    state.commits_idle.set()
        finally:
            _release_state_locks(self._states)


class ForegroundActivityRegistry:
    """Coordinates foreground work and deletion with small, per-scope barriers."""

    def __init__(self) -> None:
        self._states: dict[str, _ScopeState] = {}

    def _reserve_states(self, keys: tuple[str, ...]) -> tuple[_ScopeState, ...]:
        states = tuple(
            self._states.setdefault(key, _ScopeState(key=key)) for key in sorted(set(keys))
        )
        for state in states:
            state.reservations += 1
        return states

    def _release_reservations(self, states: tuple[_ScopeState, ...]) -> None:
        for state in states:
            state.reservations -= 1
            if (
                state.reservations == 0
                and not state.records
                and state.active_commits == 0
                and not state.cleaning
                and self._states.get(state.key) is state
            ):
                self._states.pop(state.key, None)

    @asynccontextmanager
    async def activity(
        self,
        *,
        chat_id: str | None = None,
        project_id: str | None = None,
        workdir: str | None = None,
        owner: asyncio.Task[Any] | None = None,
    ) -> AsyncIterator[ForegroundActivityLease]:
        scope = ActivityScope(chat_id=chat_id, project_id=project_id, workdir=workdir)
        states = self._reserve_states(scope.keys)
        task = owner or asyncio.current_task()
        if task is None:
            self._release_reservations(states)
            raise RuntimeError("Foreground activity requires an asyncio task")
        record = _ActivityRecord(scope=scope, owner=task)

        try:
            await _acquire_state_locks(states)
            try:
                if any(state.cleaning for state in states):
                    raise ForegroundActivityUnavailable("The chat is being cleared")
                for state in states:
                    state.records.add(record)
                lease = ForegroundActivityLease(
                    states=states,
                    generations=tuple(state.generation for state in states),
                    record=record,
                )
            finally:
                _release_state_locks(states)
            try:
                yield lease
            finally:
                release_task = asyncio.create_task(_release_activity(lease, record, states))
                cancelled = await _await_task_uninterruptibly(release_task)
                if cancelled:
                    raise asyncio.CancelledError
        finally:
            self._release_reservations(states)

    @asynccontextmanager
    async def cleanup(
        self,
        *,
        chat_ids: list[str] | tuple[str, ...] = (),
        project_id: str | None = None,
        workdir: str | None = None,
    ) -> AsyncIterator[list[str]]:
        """Stop affected work and hold its scopes closed through persistent cleanup."""
        normalized_chat_ids = list(dict.fromkeys(chat_id for chat_id in chat_ids if chat_id))
        scope = ActivityScope(project_id=project_id, workdir=workdir)
        keys = set(scope.keys)
        keys.update(f"chat:{chat_id}" for chat_id in normalized_chat_ids)
        states = self._reserve_states(tuple(keys))
        cleanup_started = False
        try:
            await self._begin_cleanup(states)
            cleanup_started = True
            records = {record for state in states for record in state.records}
            affected_chat_ids = list(normalized_chat_ids)
            affected_chat_ids.extend(
                record.scope.chat_id for record in records if record.scope.chat_id is not None
            )
            affected_chat_ids = list(dict.fromkeys(affected_chat_ids))

            current = asyncio.current_task()
            owners = {record.owner for record in records if record.owner is not current}
            for owner in owners:
                if not owner.done():
                    owner.cancel()
            if owners:
                await asyncio.gather(*owners, return_exceptions=True)
            for state in states:
                await state.commits_idle.wait()

            yield affected_chat_ids
        finally:
            try:
                if cleanup_started:
                    await _reset_cleanup(states)
            finally:
                self._release_reservations(states)

    async def _begin_cleanup(self, states: tuple[_ScopeState, ...]) -> None:
        while True:
            await _acquire_state_locks(states)
            busy = tuple(state for state in states if state.cleaning)
            if not busy:
                for state in states:
                    state.cleaning = True
                    state.generation += 1
                    state.available.clear()
                _release_state_locks(states)
                return
            _release_state_locks(states)
            await asyncio.gather(*(state.available.wait() for state in busy))


async def _acquire_state_locks(states: tuple[_ScopeState, ...]) -> None:
    acquired: list[_ScopeState] = []
    try:
        for state in states:
            await state.lock.acquire()
            acquired.append(state)
    except BaseException:
        for state in reversed(acquired):
            state.lock.release()
        raise


def _release_state_locks(states: tuple[_ScopeState, ...]) -> None:
    for state in reversed(states):
        state.lock.release()


async def _reset_cleanup(states: tuple[_ScopeState, ...]) -> None:
    reset_task = asyncio.create_task(_reset_cleanup_once(states))
    cancelled = await _await_task_uninterruptibly(reset_task)
    if cancelled:
        raise asyncio.CancelledError


async def _reset_cleanup_once(states: tuple[_ScopeState, ...]) -> None:
    await _acquire_state_locks(states)
    try:
        for state in states:
            state.cleaning = False
            state.available.set()
    finally:
        _release_state_locks(states)


async def _release_activity(
    lease: ForegroundActivityLease,
    record: _ActivityRecord,
    states: tuple[_ScopeState, ...],
) -> None:
    await _acquire_state_locks(states)
    try:
        lease._released = True
        for state in states:
            state.records.discard(record)
    finally:
        _release_state_locks(states)


async def _await_task_uninterruptibly(task: asyncio.Task[Any]) -> bool:
    cancelled = False
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            cancelled = True
    task.result()
    return cancelled
