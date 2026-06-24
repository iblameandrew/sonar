import type { Agent } from "../types";

const VERB_ACCESSORIES: Record<string, { offset: [number, number, number]; color: number }> = {
  farm: { offset: [0.3, 0.8, 0], color: 0x8b6914 },
  build: { offset: [-0.3, 0.8, 0], color: 0x888888 },
  hunt: { offset: [0.4, 1.0, 0.2], color: 0xcc4444 },
  trade: { offset: [0, 1.0, 0.3], color: 0xffd700 },
  heal: { offset: [-0.2, 0.9, 0.1], color: 0x44cc88 },
  steal: { offset: [0.2, 0.7, -0.2], color: 0x333333 },
  pray: { offset: [0, 1.2, 0], color: 0xeeddcc },
  sing: { offset: [-0.1, 1.1, 0.2], color: 0xff88cc },
  guard: { offset: [0.3, 0.6, 0.3], color: 0x6666aa },
  weave: { offset: [-0.3, 0.7, 0.1], color: 0xcc88aa },
};

const ADJECTIVE_HUE: Record<string, number> = {
  trusted: 0.08,
  generous: 0.1,
  calm: 0.12,
  prestigious: 0.13,
  skilled: 0.05,
  fed: 0.07,
  hungry: 0.0,
  feared: 0.95,
  cunning: 0.85,
  lonely: 0.6,
  tired: 0.55,
  weary: 0.5,
  diligent: 0.15,
  brave: 0.04,
  restless: 0.02,
};

export function agentBaseColor(agent: Agent): number {
  let hue = 0.55;
  for (const adj of agent.adjectives) {
    if (adj in ADJECTIVE_HUE) {
      hue = ADJECTIVE_HUE[adj];
      break;
    }
  }
  const h = hue;
  const s = 0.5;
  const l = 0.45 + Math.min(agent.nouns.length, 5) * 0.04;
  return hslToHex(h, s, l);
}

export function agentHeight(agent: Agent): number {
  return 1.0 + Math.min(agent.nouns.length, 6) * 0.15;
}

export function agentScale(agent: Agent): number {
  return 0.8 + Math.min(agent.verbs.length, 4) * 0.1;
}

export function getAccessories(agent: Agent) {
  return agent.verbs
    .map((v) => VERB_ACCESSORIES[v])
    .filter(Boolean)
    .slice(0, 2);
}

function hslToHex(h: number, s: number, l: number): number {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  const r = Math.round(f(0) * 255);
  const g = Math.round(f(8) * 255);
  const b = Math.round(f(4) * 255);
  return (r << 16) | (g << 8) | b;
}

export const SEASON_PALETTES: Record<string, { fog: number; ambient: number; ground: number }> = {
  harvest: { fog: 0x3a2818, ambient: 0xffa040, ground: 0x5a4020 },
  scarcity: { fog: 0x1a1a2a, ambient: 0x6080a0, ground: 0x2a2a3a },
  planting: { fog: 0x1a3020, ambient: 0x60c080, ground: 0x304030 },
  festival: { fog: 0x2a1830, ambient: 0xc080ff, ground: 0x402050 },
  sharp: { fog: 0x101020, ambient: 0xffffff, ground: 0x202030 },
  diffuse: { fog: 0x202030, ambient: 0xaaaacc, ground: 0x303040 },
};