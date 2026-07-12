import asyncio
import threading

import pytest

from backend.app.services.foreground_activity import (
    ForegroundActivityRegistry,
    ForegroundActivityUnavailable,
    _acquire_state_locks,
    _ScopeState,
)


@pytest.mark.asyncio
async def test_cleanup_cancels_only_matching_scope_and_blocks_registration() -> None:
    registry = ForegroundActivityRegistry()
    project_started = asyncio.Event()
    unrelated_finished = asyncio.Event()

    async def project_work() -> None:
        async with registry.activity(
            chat_id="chat-1", project_id="project-1", workdir="/tmp/project-1"
        ):
            project_started.set()
            await asyncio.Future()

    async def unrelated_work() -> None:
        async with registry.activity(chat_id="chat-2", project_id="project-2"):
            await asyncio.sleep(0)
            unrelated_finished.set()

    project_task = asyncio.create_task(project_work())
    unrelated_task = asyncio.create_task(unrelated_work())
    await project_started.wait()

    async with registry.cleanup(project_id="project-1") as affected_chat_ids:
        assert affected_chat_ids == ["chat-1"]
        assert project_task.cancelled()
        with pytest.raises(ForegroundActivityUnavailable):
            async with registry.activity(chat_id="chat-3", project_id="project-1"):
                pass

    await unrelated_task
    assert unrelated_finished.is_set()


@pytest.mark.asyncio
async def test_cleanup_waits_for_started_blocking_persistence_before_yielding() -> None:
    registry = ForegroundActivityRegistry()
    worker_started = threading.Event()
    allow_worker_to_finish = threading.Event()
    cleanup_entered = asyncio.Event()

    def persist() -> None:
        worker_started.set()
        assert allow_worker_to_finish.wait(timeout=2)

    async def active_work() -> None:
        async with registry.activity(chat_id="chat-1") as lease:
            await lease.run_sync(persist)

    async def clear_chat() -> None:
        async with registry.cleanup(chat_ids=["chat-1"]):
            cleanup_entered.set()

    activity_task = asyncio.create_task(active_work())
    assert await asyncio.to_thread(worker_started.wait, 1)
    cleanup_task = asyncio.create_task(clear_chat())
    await asyncio.sleep(0)
    assert not cleanup_entered.is_set()

    allow_worker_to_finish.set()
    await cleanup_task
    assert cleanup_entered.is_set()
    assert activity_task.cancelled()


@pytest.mark.asyncio
async def test_activity_can_start_again_after_cleanup_finishes() -> None:
    registry = ForegroundActivityRegistry()

    async with registry.cleanup(chat_ids=["chat-1"]):
        with pytest.raises(ForegroundActivityUnavailable):
            async with registry.activity(chat_id="chat-1"):
                pass

    async with registry.activity(chat_id="chat-1") as lease:
        assert await lease.is_active()

    assert registry._states == {}


@pytest.mark.asyncio
async def test_partial_lock_acquisition_is_released_when_cancelled() -> None:
    first = _ScopeState(key="first")
    second = _ScopeState(key="second")
    await second.lock.acquire()
    task = asyncio.create_task(_acquire_state_locks((first, second)))
    await asyncio.sleep(0)
    assert first.lock.locked()

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert not first.lock.locked()
    second.lock.release()


@pytest.mark.asyncio
async def test_cleanup_cancellation_resets_scope_before_entering_body() -> None:
    registry = ForegroundActivityRegistry()
    owner_started = asyncio.Event()
    owner_cancelled = asyncio.Event()
    release_owner = asyncio.Event()

    async def stubborn_owner() -> None:
        async with registry.activity(chat_id="chat-1"):
            owner_started.set()
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                owner_cancelled.set()
                await release_owner.wait()

    async def cleanup() -> None:
        async with registry.cleanup(chat_ids=["chat-1"]):
            pytest.fail("cancelled cleanup must not enter its body")

    owner = asyncio.create_task(stubborn_owner())
    await owner_started.wait()
    cleanup_task = asyncio.create_task(cleanup())
    await owner_cancelled.wait()
    cleanup_task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await cleanup_task

    async with registry.activity(chat_id="chat-1") as lease:
        assert await lease.is_active()

    release_owner.set()
    await asyncio.gather(owner, return_exceptions=True)
    assert registry._states == {}


@pytest.mark.asyncio
async def test_repeated_owner_cancellation_cannot_strand_commit_or_registry_state() -> None:
    registry = ForegroundActivityRegistry()
    worker_started = threading.Event()
    finish_worker = threading.Event()

    def persist() -> None:
        worker_started.set()
        assert finish_worker.wait(timeout=2)

    async def owner() -> None:
        async with registry.activity(chat_id="chat-1") as lease:
            await lease.run_sync(persist)

    activity_task = asyncio.create_task(owner())
    assert await asyncio.to_thread(worker_started.wait, 1)
    cleanup_task = asyncio.create_task(_run_cleanup(registry, "chat-1"))
    await asyncio.sleep(0)
    activity_task.cancel()
    finish_worker.set()

    await asyncio.wait_for(cleanup_task, timeout=1)
    assert activity_task.cancelled()
    assert registry._states == {}


async def _run_cleanup(registry: ForegroundActivityRegistry, chat_id: str) -> None:
    async with registry.cleanup(chat_ids=[chat_id]):
        pass
