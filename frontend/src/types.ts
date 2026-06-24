export interface Agent {
  id: string;
  name: string;
  role: string;
  verbs: string[];
  nouns: string[];
  adjectives: string[];
  parent_ids: string[];
  institution_id: string | null;
  grid_x: number;
  grid_y: number;
  current_task_id: string | null;
  /** Error-adapted persona block (verbs · nouns · adjectives · purpose). */
  system_prompt?: string;
}

export interface DependencyEntry {
  from_id: string;
  to_id: string;
  kind: string;
  verb_basis: string;
  qualitative_distance: string;
  strength: string;
  rationale: string;
  season_weight: number;
  tick: number;
  negotiation_id?: string;
}

export interface Subtask {
  id: string;
  title: string;
  description: string;
  assigned_to: string | null;
  status: string;
  parent_id: string | null;
}

export interface NegotiationRound {
  id: string;
  tick: number;
  topic: string;
  proposer_id: string;
  responder_id: string;
  proposal: string;
  counter_offer: string | null;
  outcome: string;
  rationale: string;
}

export interface ProjectCanvas {
  goal: string;
  requirements: string[];
  subtasks: Subtask[];
  artifacts: { id: string; title: string; kind: string; content: string; author_id: string }[];
  decisions: string[];
  negotiations: NegotiationRound[];
  society_progress: number;
  colony_voxels: { x: number; y: number; z: number; color: string; label: string }[];
}

export interface RunMetrics {
  mode: string;
  quality_score: number;
  iterations: number;
  conflicts_detected: number;
  conflicts_resolved: number;
  negotiations: number;
  subtasks_completed: number;
  features_complete: number;
  tokens_estimate: number;
  transparency_events: number;
}

export interface ComparisonMetrics {
  society: RunMetrics;
  baseline: RunMetrics;
  society_wins_quality: boolean;
  society_wins_efficiency: boolean;
  summary: string;
}

export interface SimEvent {
  type: string;
  tick: number;
  payload: Record<string, unknown>;
}

export interface LayerVisibility {
  agents: boolean;
  connections: boolean;
  negotiations: boolean;
  institutions: boolean;
  colony: boolean;
  conflictArena: boolean;
  metrics: boolean;
  birthDeath: boolean;
  attention_agent: boolean;
  loss_agent: boolean;
  gradient_descent_agent: boolean;
  residual_flow_agent: boolean;
  feed_forward_agent: boolean;
}

export const KIND_COLORS: Record<string, number> = {
  economic: 0xf0c040,
  kinship: 0x40c070,
  prestige: 0xc080f0,
  conflict: 0xf04040,
  sustenance: 0xf08040,
  craft: 0x60a0c0,
  ritual: 0xc0c0f0,
  collaboration: 0x40ff80,
  negotiation: 0xff80ff,
};

export const ROLE_COLORS: Record<string, number> = {
  voxel_architect: 0x60c0ff,
  orchestrator: 0xff6060,
  optimizer: 0xffff60,
  integrator: 0x60ff90,
  ux_weaver: 0xff90ff,
  critic_evaluator: 0xffffff,
  worker: 0x90caf9,
  generalist: 0xb0bec5,
};

export interface ColonyInfo {
  world_size: number;
  walkable_cells: number;
  agent_count: number;
  sectors?: Record<string, number>;
}

export const STRENGTH_SCALE: Record<string, number> = {
  none: 0,
  low: 0.12,
  med: 0.28,
  high: 0.5,
};