from __future__ import annotations

import operator
from typing import Annotated, Any, TypedDict

from app.models.agent import QualitativeAgent, SocialPlaybook
from app.models.institution import Institution
from app.models.raptor import RaptorNode


class SimulationState(TypedDict):
    tick: int
    macro_season: str
    micro_season: str
    judgment_temperature: str
    agents: list[QualitativeAgent]
    playbook: SocialPlaybook
    regret: float
    regret_narrative: str
    ought_snapshot: dict[str, Any]
    events: Annotated[list, operator.add]
    institutions: list[Institution]
    raptor_nodes: list[RaptorNode]
    quality_pool: list[str]
    running: bool
    max_ticks: int
    speed: float
    paused: bool