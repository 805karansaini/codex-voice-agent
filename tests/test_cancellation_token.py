import asyncio
import unittest

from backend.app.codex_runner import CancellationToken


class FakeTurn:
    def __init__(self) -> None:
        self.interrupted = False

    async def interrupt(self) -> None:
        self.interrupted = True


class CancellationTokenTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancel_interrupts_bound_turn(self) -> None:
        token = CancellationToken()
        turn = FakeTurn()

        token.bind_turn(turn)
        token.cancel()
        await asyncio.sleep(0)

        self.assertTrue(turn.interrupted)

    async def test_bind_after_cancel_interrupts_turn(self) -> None:
        token = CancellationToken()
        turn = FakeTurn()

        token.cancel()
        token.bind_turn(turn)
        await asyncio.sleep(0)

        self.assertTrue(turn.interrupted)


if __name__ == "__main__":
    unittest.main()
