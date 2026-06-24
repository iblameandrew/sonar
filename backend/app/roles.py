"""Mathematical agent role identifiers (transformer primitive + Agent suffix)."""

from __future__ import annotations

# Society loop — neural / transformer primitives
LOSS_AGENT = "loss_agent"
RESIDUAL_FLOW_AGENT = "residual_flow_agent"
GRADIENT_DESCENT_AGENT = "gradient_descent_agent"
FEED_FORWARD_AGENT = "feed_forward_agent"
WEIGHT_AGENT = "weight_agent"
ATTENTION_AGENT = "attention_agent"
INPUT_PROJECTION_AGENT = "input_projection_agent"
MULTI_HEAD_AGENT = "multi_head_agent"
INTERVENTION_AGENT = "intervention_agent"
LOW_RANK_AGENT = "low_rank_agent"
HIERARCHICAL_MEMORY_AGENT = "hierarchical_memory_agent"
BASELINE_AGENT = "baseline_agent"

# Engineering specialists (colony cast)
VOXEL_ARCHITECT = "voxel_architect"
ORCHESTRATOR = "orchestrator"
OPTIMIZER = "optimizer"
INTEGRATOR = "integrator"
UX_WEAVER = "ux_weaver"
CRITIC_EVALUATOR = "critic_evaluator"

ROLE_LABELS: dict[str, str] = {
    LOSS_AGENT: "Loss Agent",
    RESIDUAL_FLOW_AGENT: "Residual Flow Agent",
    GRADIENT_DESCENT_AGENT: "Gradient Descent Agent",
    FEED_FORWARD_AGENT: "Feed-Forward Agent",
    WEIGHT_AGENT: "Weight Agent",
    ATTENTION_AGENT: "Attention Agent",
    INPUT_PROJECTION_AGENT: "Input Projection Agent",
    MULTI_HEAD_AGENT: "Multi-Head Agent",
    INTERVENTION_AGENT: "Intervention Agent",
    LOW_RANK_AGENT: "Low-Rank Agent",
    HIERARCHICAL_MEMORY_AGENT: "Hierarchical Memory Agent",
    BASELINE_AGENT: "Baseline Agent",
    VOXEL_ARCHITECT: "Voxel Architect Agent",
    ORCHESTRATOR: "Orchestrator Agent",
    OPTIMIZER: "Optimizer Agent",
    INTEGRATOR: "Integrator Agent",
    UX_WEAVER: "UX Weaver Agent",
    CRITIC_EVALUATOR: "Critic Evaluator Agent",
    "default": "Default Agent",
    "worker": "Swarm Agent",
    "generalist": "Generalist Agent",
}

DASHBOARD_ROLES: tuple[str, ...] = (
    LOSS_AGENT,
    ATTENTION_AGENT,
    GRADIENT_DESCENT_AGENT,
    RESIDUAL_FLOW_AGENT,
    FEED_FORWARD_AGENT,
    INPUT_PROJECTION_AGENT,
    MULTI_HEAD_AGENT,
    INTERVENTION_AGENT,
    BASELINE_AGENT,
    VOXEL_ARCHITECT,
    ORCHESTRATOR,
    INTEGRATOR,
)

REASONING_ROLES = {LOSS_AGENT, ATTENTION_AGENT, CRITIC_EVALUATOR, INTERVENTION_AGENT}
CODING_ROLES = {VOXEL_ARCHITECT, INTEGRATOR, ORCHESTRATOR}