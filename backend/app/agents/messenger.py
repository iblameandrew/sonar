from __future__ import annotations

import uuid

from langchain_core.prompts import ChatPromptTemplate

from app.llm.qwen_factory import qwen_factory
from app.models.agent import QualitativeAgent
from app.models.canvas import Artifact, ProjectCanvas
from app.models.events import SimEvent
from app.models.institution import Institution
from app.seed import VOXFORGE_VOXEL_BLUEPRINT

PROPOSE_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "human",
            "Agent: {name} ({role})\nVerbs: {verbs}\nNouns: {nouns}\n"
            "Task: {task_title} — {task_desc}\nPhase: {phase}\n"
            "Write a concise engineering proposal or code skeleton for VoxForge (2-4 sentences).",
        ),
    ]
)

ROLE_ARTIFACT_KIND = {
    "voxel_architect": "ui",
    "orchestrator": "architecture",
    "optimizer": "benchmark",
    "integrator": "integration",
    "ux_weaver": "ui",
    "critic_evaluator": "tradeoff",
}


class Messenger:
    def perform(
        self,
        agents: list[QualitativeAgent],
        institutions: list[Institution],
        canvas: ProjectCanvas,
        tick: int,
        phase: str,
    ) -> tuple[list[QualitativeAgent], ProjectCanvas, list[SimEvent]]:
        events: list[SimEvent] = []
        inst_by_id = {i.id: i for i in institutions}
        canvas = canvas.model_copy(deep=True)
        updated: list[QualitativeAgent] = []

        for agent in agents:
            agent = agent.model_copy(deep=True)
            if agent.current_task_id:
                task = next((t for t in canvas.subtasks if t.id == agent.current_task_id), None)
                if task and task.status in ("assigned", "in_progress"):
                    task.status = "in_progress"
                    content = qwen_factory.invoke_text(
                        agent.role if agent.role in ROLE_ARTIFACT_KIND else "messenger",
                        PROPOSE_PROMPT,
                        {
                            "name": agent.name, "role": agent.role,
                            "verbs": agent.verbs, "nouns": agent.nouns,
                            "task_title": task.title, "task_desc": task.description,
                            "phase": phase,
                        },
                    )
                    if not content:
                        content = f"[{phase}] {agent.name} proposes solution for {task.title}"

                    kind = ROLE_ARTIFACT_KIND.get(agent.role, "code")
                    art = Artifact(
                        id=f"art-{uuid.uuid4().hex[:8]}",
                        kind=kind,  # type: ignore[arg-type]
                        title=f"{agent.name}: {task.title}",
                        content=content, author_id=agent.id, tick=tick,
                    )
                    canvas.add_artifact(art)
                    if tick % 3 == 0:
                        task.status = "done"
                        agent.adjectives = list(dict.fromkeys(agent.adjectives + ["productive"]))
                    events.append(
                        SimEvent(
                            type="messenger_propose", tick=tick,
                            payload={
                                "agent_id": agent.id, "agent_name": agent.name,
                                "role": agent.role, "task_id": task.id,
                                "artifact": art.model_dump(),
                                "grid_x": agent.grid_x, "grid_y": agent.grid_y,
                                "llm": "qwen",
                            },
                        )
                    )

            if agent.institution_id and agent.institution_id in inst_by_id:
                for adj, bias in inst_by_id[agent.institution_id].policy.items():
                    if bias == "promote" and adj not in agent.adjectives:
                        agent.adjectives.append(adj)

            updated.append(agent)

        done = sum(1 for t in canvas.subtasks if t.status == "done")
        progress = done / max(len(canvas.subtasks), 1)
        canvas.voxforge_voxels = VOXFORGE_VOXEL_BLUEPRINT[: int(progress * len(VOXFORGE_VOXEL_BLUEPRINT))]
        canvas.voxforge_progress = progress

        for voxel in canvas.voxforge_voxels[-2:]:
            events.append(SimEvent(type="voxforge_voxel", tick=tick, payload=voxel))

        return updated, canvas, events