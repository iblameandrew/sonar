from __future__ import annotations

import time
import uuid

from app.models.canvas import Artifact, ProjectCanvas, Subtask
from app.models.events import SimEvent
from app.models.metrics import RunMetrics
from app.seed import DEFAULT_OUGHT, VOXFORGE_REQUIREMENTS


class SingleAgentBaseline:
    """Powerful single-agent mode — one pass, low transparency, comparable output."""

    def run_tick(
        self,
        canvas: ProjectCanvas,
        tick: int,
    ) -> tuple[ProjectCanvas, list[SimEvent], RunMetrics]:
        start = time.time()
        events: list[SimEvent] = []
        canvas = canvas.model_copy(deep=True)
        metrics = RunMetrics(mode="baseline", iterations=tick + 1)

        pending = [t for t in canvas.subtasks if t.status in ("pending", "assigned")]
        if pending:
            task = pending[0]
            task.status = "in_progress"
            task.assigned_to = "solo-agent"
            content = (
                f"[Solo pass] Attempting {task.title}: {task.description}. "
                f"Single context window — no negotiation transparency."
            )
            events.append(
                SimEvent(
                    type="baseline_proposal",
                    tick=tick,
                    payload={"task_id": task.id, "content": content},
                )
            )
            if tick % 2 == 1:
                task.status = "done"
                canvas.add_artifact(
                    Artifact(
                        id=f"art-solo-{uuid.uuid4().hex[:6]}",
                        kind="code",
                        title=task.title,
                        content=content + " (completed solo)",
                        author_id="solo-agent",
                        tick=tick,
                    )
                )
                metrics.subtasks_completed += 1

        modules_done = sum(1 for t in canvas.subtasks if t.status == "done")
        total = max(len(canvas.subtasks), 1)
        metrics.features_complete = modules_done / total
        metrics.quality_score = min(0.72, 0.4 + metrics.features_complete * 0.35)
        metrics.tokens_estimate = 2800 + tick * 400
        metrics.transparency_events = len(events)
        metrics.negotiations = 0
        metrics.time_ms = int((time.time() - start) * 1000)

        events.append(
            SimEvent(
                type="baseline_metrics",
                tick=tick,
                payload=metrics.model_dump(),
            )
        )
        return canvas, events, metrics


def solo_initial_canvas() -> ProjectCanvas:
    from app.seed import create_project_canvas
    return create_project_canvas()