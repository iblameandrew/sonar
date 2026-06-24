/** Mathematical agent role labels (transformer primitive + Agent suffix). */

export const ROLE_LABELS: Record<string, string> = {
  loss_agent: "Loss Agent",
  residual_flow_agent: "Residual Flow Agent",
  gradient_descent_agent: "Gradient Descent Agent",
  feed_forward_agent: "Feed-Forward Agent",
  weight_agent: "Weight Agent",
  attention_agent: "Attention Agent",
  input_projection_agent: "Input Projection Agent",
  multi_head_agent: "Multi-Head Agent",
  intervention_agent: "Intervention Agent",
  low_rank_agent: "Low-Rank Agent",
  hierarchical_memory_agent: "Hierarchical Memory Agent",
  baseline_agent: "Baseline Agent",
  voxel_architect: "Voxel Architect Agent",
  orchestrator: "Orchestrator Agent",
  optimizer: "Optimizer Agent",
  integrator: "Integrator Agent",
  ux_weaver: "UX Weaver Agent",
  critic_evaluator: "Critic Evaluator Agent",
  worker: "Swarm Agent",
  generalist: "Generalist Agent",
};

export const DASHBOARD_ROLES = [
  "loss_agent",
  "attention_agent",
  "gradient_descent_agent",
  "residual_flow_agent",
  "feed_forward_agent",
  "input_projection_agent",
  "multi_head_agent",
  "intervention_agent",
  "baseline_agent",
  "voxel_architect",
  "orchestrator",
  "integrator",
] as const;

export const LAYER_ROLE_KEYS = [
  "attention_agent",
  "loss_agent",
  "gradient_descent_agent",
  "residual_flow_agent",
  "feed_forward_agent",
] as const;

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role.replace(/_/g, " ");
}