from __future__ import annotations

import operator
from typing import Annotated, Any, Literal, TypedDict

from app.models.agent import QualitativeAgent, SocialPlaybook
from app.models.canvas import ProjectCanvas
from app.models.institution import Institution
from app.models.metrics import ComparisonMetrics
from app.models.raptor import RaptorNode

ExecutionMode = Literal["society", "baseline"]
DesignPhase = Literal["concept", "technical", "polish", "validation"]


class SimulationState(TypedDict):
    tick: int
    macro_season: str
    micro_season: str
    design_phase: str
    judgment_temperature: str
    execution_mode: str
    agents: list[QualitativeAgent]
    playbook: SocialPlaybook
    canvas: ProjectCanvas
    regret: float
    regret_narrative: str
    conflict_active: bool
    ought_snapshot: dict[str, Any]
    events: Annotated[list, operator.add]
    institutions: list[Institution]
    raptor_nodes: list[RaptorNode]
    quality_pool: list[str]
    metrics: ComparisonMetrics
    running: bool
    max_ticks: int
    speed: float
    paused: bool
    inject_conflict: bool
    attention_policy: dict[str, Any]
    answer_max_tokens: int