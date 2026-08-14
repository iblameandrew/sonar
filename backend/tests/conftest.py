from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.simulation.runner import runner


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture(autouse=True)
def _idle_runner() -> None:
    """Keep the process-wide simulation runner idle between tests."""
    yield
    runner.state = None
    runner.baseline_state = None
    runner._task = None
    runner.execution_mode = "idle"
    runner.reset_live_progress()
    runner.final_answer = ""
    runner.run_id = ""
    while True:
        try:
            runner.event_queue.get_nowait()
        except Exception:
            break
