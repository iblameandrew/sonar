from __future__ import annotations

import uuid

from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel

from app.roles import INPUT_PROJECTION_AGENT
from app.llm.qwen_factory import qwen_factory
from app.models.agent import QualitativeAgent, SpecialistRole
from app.models.canvas import ProjectCanvas, Subtask
from app.models.events import SimEvent

ROLE_TASK_MAP: dict[SpecialistRole, list[str]] = {
    "voxel_architect": ["Voxel Viz"],
    "orchestrator": ["LangGraph Core", "SSE Pipeline"],
    "optimizer": ["Benchmark Harness", "Metrics Dashboard"],
    "integrator": ["Integration", "SSE Pipeline"],
    "ux_weaver": ["Negotiation UI", "Voxel Viz"],
    "critic_evaluator": ["Metrics Dashboard", "Benchmark Harness"],
}


class TaskAssignment(BaseModel):
    task_id: str
    agent_id: str
    rationale: str


class DecomposeResult(BaseModel):
    assignments: list[TaskAssignment]


DECOMPOSE_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "human",
            "Goal: {goal}\nPhase: {phase}\nPending tasks: {tasks}\nSpecialists: {agents}\n"
            "Assign up to 2 pending tasks to best-matching specialists by verbs/nouns.",
        ),
    ]
)


class Decomposer:
    def decompose(
        self,
        canvas: ProjectCanvas,
        agents: list[QualitativeAgent],
        tick: int,
        phase: str,
    ) -> tuple[ProjectCanvas, list[QualitativeAgent], list[SimEvent]]:
        events: list[SimEvent] = []
        canvas = canvas.model_copy(deep=True)
        agents = [a.model_copy(deep=True) for a in agents]
        agent_map = {a.id: a for a in agents}
        pending = [t for t in canvas.subtasks if t.status == "pending"]

        result = qwen_factory.invoke_structured(
            INPUT_PROJECTION_AGENT,
            DecomposeResult,
            DECOMPOSE_PROMPT,
            {
                "goal": canvas.goal,
                "phase": phase,
                "tasks": [{"id": t.id, "title": t.title, "desc": t.description} for t in pending],
                "agents": [{"id": a.id, "name": a.name, "role": a.role, "verbs": a.verbs} for a in agents],
            },
        )

        assignments = result.assignments if result else []
        if not assignments:
            for task in pending[:2]:
                best = self._match_agent(task, agents)
                if best:
                    assignments.append(
                        TaskAssignment(task_id=task.id, agent_id=best.id, rationale="Rule-based match")
                    )

        for asgn in assignments[:2]:
            task = next((t for t in canvas.subtasks if t.id == asgn.task_id), None)
            agent = agent_map.get(asgn.agent_id)
            if not task or not agent or task.status != "pending":
                continue
            task.status = "assigned"
            task.assigned_to = agent.id
            agent.current_task_id = task.id
            agent.adjectives = list(dict.fromkeys(agent.adjectives + ["focused"]))
            events.append(
                SimEvent(
                    type="task_decomposed",
                    tick=tick,
                    payload={
                        "task_id": task.id,
                        "title": task.title,
                        "assigned_to": agent.id,
                        "agent_name": agent.name,
                        "role": agent.role,
                        "phase": phase,
                        "rationale": asgn.rationale,
                        "llm": "qwen",
                    },
                )
            )

        return canvas, list(agent_map.values()), events

    def _match_agent(self, task: Subtask, agents: list[QualitativeAgent]) -> QualitativeAgent | None:
        for agent in agents:
            if task.title in ROLE_TASK_MAP.get(agent.role, []) and not agent.current_task_id:
                return agent
        return next((a for a in agents if not a.current_task_id), None)