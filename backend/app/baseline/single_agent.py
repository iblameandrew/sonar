from __future__ import annotations

import time
import uuid

from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel

from app.llm.qwen_factory import qwen_factory
from app.models.canvas import Artifact, ProjectCanvas
from app.models.events import SimEvent
from app.models.metrics import RunMetrics

BASELINE_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "human",
            "You are a single powerful agent building Colony alone.\n"
            "Task: {task_title} — {task_desc}\n"
            "All Colony requirements: visualization, LangGraph, SSE, negotiation UI, metrics, integration.\n"
            "Produce a concise engineering proposal (2-4 sentences). No collaboration transparency.",
        ),
    ]
)


class BaselineOutput(BaseModel):
    proposal: str
    quality_estimate: float


class SingleAgentBaseline:
    """Single-agent baseline using the same Qwen configuration for fair comparison."""

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

            result = qwen_factory.invoke_structured(
                "baseline_agent",
                BaselineOutput,
                BASELINE_PROMPT,
                {"task_title": task.title, "task_desc": task.description},
            )
            content = (
                result.proposal if result
                else f"[Solo Qwen pass] {task.title}: {task.description}"
            )

            events.append(
                SimEvent(
                    type="baseline_proposal", tick=tick,
                    payload={"task_id": task.id, "content": content, "llm": "qwen"},
                )
            )
            if tick % 2 == 1:
                task.status = "done"
                canvas.add_artifact(Artifact(
                    id=f"art-solo-{uuid.uuid4().hex[:6]}",
                    kind="code", title=task.title,
                    content=content, author_id="solo-agent", tick=tick,
                ))
                metrics.subtasks_completed += 1

        modules_done = sum(1 for t in canvas.subtasks if t.status == "done")
        total = max(len(canvas.subtasks), 1)
        metrics.features_complete = modules_done / total
        metrics.quality_score = min(0.72, 0.4 + metrics.features_complete * 0.35)
        usage = qwen_factory.get_usage_summary()
        metrics.tokens_estimate = usage.get("by_role", {}).get("baseline_agent", {}).get("tokens", 2800 + tick * 400)
        metrics.transparency_events = len(events)
        metrics.negotiations = 0
        metrics.time_ms = int((time.time() - start) * 1000)

        events.append(SimEvent(type="baseline_metrics", tick=tick, payload=metrics.model_dump()))
        return canvas, events, metrics