export interface Agent {
  id: string;
  verbs: string[];
  nouns: string[];
  adjectives: string[];
  parent_ids: string[];
  institution_id: string | null;
  position: [number, number, number];
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
}

export interface Institution {
  id: string;
  name: string;
  member_ids: string[];
  policy: Record<string, string>;
  birthing_entry_ids: string[];
  cluster_centroid: number[];
  position: [number, number, number];
}

export interface SimEvent {
  type: string;
  tick: number;
  payload: Record<string, unknown>;
}

export interface StateSnapshot {
  tick: number;
  macro_season: string;
  micro_season: string;
  judgment_temperature: string;
  regret: number;
  regret_narrative: string;
  running: boolean;
  paused: boolean;
  agents: Agent[];
  playbook: DependencyEntry[];
  institutions: Institution[];
  raptor_nodes: unknown[];
}

export interface LayerVisibility {
  agents: boolean;
  connections: boolean;
  institutions: boolean;
  birthDeath: boolean;
  attention: boolean;
  auditor: boolean;
  reformer: boolean;
  confessor: boolean;
  messenger: boolean;
  raptor: boolean;
  minimap: boolean;
  labels: boolean;
}

export const KIND_COLORS: Record<string, number> = {
  economic: 0xf0c040,
  kinship: 0x40c070,
  prestige: 0xc080f0,
  conflict: 0xf04040,
  sustenance: 0xf08040,
  craft: 0x60a0c0,
  ritual: 0xc0c0f0,
};

export const STRENGTH_SCALE: Record<string, number> = {
  none: 0,
  low: 0.15,
  med: 0.35,
  high: 0.6,
};