"""Small-scale simulation smoke test (do not commit with API key)."""
from __future__ import annotations

import asyncio
import os
import sys
import time

# Allow `python scripts/test_sim_small.py` from backend/
sys.path.insert(0, ".")

from app.llm.qwen_factory import qwen_factory
from app.simulation.runner import runner


API_KEY = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("DASHSCOPE_API_KEY", "")


async def drain_events(seconds: float) -> list[str]:
    lines: list[str] = []
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            ev = await asyncio.wait_for(runner.event_queue.get(), timeout=2.0)
            lines.append(f"t{ev.tick} · {ev.type}")
        except asyncio.TimeoutError:
            snap = runner.get_state_snapshot()
            tick = snap["tick"] if snap else "?"
            running = snap["running"] if snap else "?"
            lines.append(f"(wait) tick={tick} running={running}")
    return lines


async def main() -> None:
    if API_KEY:
        qwen_factory.set_api_key(API_KEY)
        valid, msg = qwen_factory.validate_api_key()
        print("validate:", valid, msg)
    print("configured:", qwen_factory.is_configured())
    print("masked:", qwen_factory.masked_api_key())

    t0 = time.time()
    await runner.start(max_ticks=3, speed=10.0, agent_count=6)
    print("started in", round(time.time() - t0, 2), "s")

    lines = await drain_events(90.0)
    for line in lines:
        print(line)

    snap = runner.get_state_snapshot()
    print("final tick:", snap["tick"] if snap else None)
    print("running:", snap["running"] if snap else None)
    print("qwen:", qwen_factory.get_status().get("last_error", ""))
    print("usage calls:", qwen_factory.get_usage_summary().get("total_calls", 0))


if __name__ == "__main__":
    asyncio.run(main())