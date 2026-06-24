/** Colony isometric zone-map scene (Three.js). */
import * as THREE from "three";
import { formatSystemPrompt } from "../agentPrompt";
import type { Agent, DependencyEntry, LayerVisibility, SimEvent } from "../types";
import { KIND_COLORS, ROLE_COLORS, STRENGTH_SCALE } from "../types";

export const WORLD_SIZE = 96;
export const SECTOR_SIZE = 12;
export const MAX_AGENTS = 2048;
const CELL = 1;
const WORLD_EXTENT = WORLD_SIZE * CELL;
const SECTOR_COUNT = Math.floor(WORLD_SIZE / SECTOR_SIZE);
const AMBIENT_BUBBLE_COUNT = 96;
const IDLE_ALIVE_PULSE = 0.62;
const COMPUTE_ALIVE_PULSE = 1.0;
const CA_SIZE = 64;
const CA_CELLS = CA_SIZE * CA_SIZE;
const CA_CELL = WORLD_EXTENT / CA_SIZE;
const CA_IDLE_HZ = 7;
const CA_COMPUTE_HZ = 14;
const TREE_MARGIN = 4;
const TREE_SPACING = 8;

const ECO = {
  sky: 0x87ceeb,
  skyFog: 0xb8e6f5,
  grass: 0x5dbb63,
  grassBright: 0x7fd87f,
  dirt: 0x8b6914,
  moss: 0x3ddc84,
  mossGlow: 0x66ffaa,
};

interface ZonePalette {
  base: number;
  bright: number;
  emissive: number;
}

/** Minecraft HD zone tints — greens, reds, blues bathed in volumetric light */
const ZONE_PALETTES: ZonePalette[] = [
  { base: 0x5dbb63, bright: 0x7fd87f, emissive: 0x2e7d32 },
  { base: 0xc85a4a, bright: 0xe87868, emissive: 0x8b2500 },
  { base: 0x4fc3f7, bright: 0x81d4fa, emissive: 0x0277bd },
  { base: 0x66bb6a, bright: 0xa5d6a7, emissive: 0x388e3c },
  { base: 0xef5350, bright: 0xff867c, emissive: 0xb71c1c },
  { base: 0x42a5f5, bright: 0x64b5f6, emissive: 0x1565c0 },
  { base: 0x8bc34a, bright: 0xc5e1a5, emissive: 0x558b2f },
  { base: 0x5c6bc0, bright: 0x9fa8da, emissive: 0x283593 },
];

export interface ColonyStats {
  agentCount: number;
  activeAgents: number;
  walkableCells: number;
  sectors: Record<string, number>;
}

function sectorId(x: number, y: number): string {
  return `s${Math.floor(x / SECTOR_SIZE)}-${Math.floor(y / SECTOR_SIZE)}`;
}

function sectorPalette(sx: number, sy: number): ZonePalette {
  return ZONE_PALETTES[(sx + sy * 2) % ZONE_PALETTES.length];
}

function sectorColor(sx: number, sy: number, gx: number, gy: number, t = 0.5): THREE.Color {
  const pal = sectorPalette(sx, sy);
  const c = new THREE.Color(pal.base);
  const bright = new THREE.Color(pal.bright);
  const checker = ((gx + gy) % 2) * 0.07;
  c.lerp(bright, t + checker);
  return c;
}

interface SpawnAnim {
  fromX: number;
  fromY: number;
  start: number;
  duration: number;
}

interface AnimatedConnection {
  line: THREE.Line;
  mat: THREE.LineDashedMaterial;
  birth: number;
  pulse: number;
  strength: number;
  fromId: string;
  toId: string;
  y: number;
}

function easeOutCubic(t: number): number {
  const p = Math.max(0, Math.min(1, t));
  return 1 - (1 - p) ** 3;
}

function isTreeWorld(wx: number, wy: number): boolean {
  if (wx < TREE_MARGIN || wy < TREE_MARGIN || wx >= WORLD_SIZE - TREE_MARGIN || wy >= WORLD_SIZE - TREE_MARGIN) {
    return true;
  }
  const lx = wx - TREE_MARGIN;
  const ly = wy - TREE_MARGIN;
  return lx % TREE_SPACING === 0 && ly % TREE_SPACING === 0;
}

function caWorldCoord(cx: number, cy: number): { wx: number; wy: number } {
  return {
    wx: Math.min(WORLD_SIZE - 1, Math.floor(((cx + 0.5) / CA_SIZE) * WORLD_SIZE)),
    wy: Math.min(WORLD_SIZE - 1, Math.floor(((cy + 0.5) / CA_SIZE) * WORLD_SIZE)),
  };
}

export class ColonyScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  private zoneMesh: THREE.Mesh;
  private zoneMat: THREE.MeshStandardMaterial;
  private volWash: THREE.Mesh;
  private sectorLines: THREE.LineSegments;
  private sectorLineMat: THREE.LineBasicMaterial;
  private agentMesh: THREE.InstancedMesh;
  private agentIndex = new Map<string, number>();
  private freeSlots: number[] = [];
  private agents = new Map<string, Agent>();
  private prevPositions = new Map<string, { x: number; y: number }>();
  private spawnAnim = new Map<string, SpawnAnim>();
  private spreadWaveStart = -1;
  private connectionLines: AnimatedConnection[] = [];
  private debateParticles: THREE.Points[] = [];
  private institutionHulls: THREE.Mesh[] = [];
  private conflictRing: THREE.Mesh | null = null;
  private seasonTint = 1;
  private agentPulseUntil = new Map<string, number>();
  private agentMotionPhase = new Map<string, number>();
  private bubbleMesh: THREE.InstancedMesh;
  private bubbleBase = new Float32Array(AMBIENT_BUBBLE_COUNT * 3);
  private bubblePhase = new Float32Array(AMBIENT_BUBBLE_COUNT * 4);
  private caGrid = new Uint8Array(CA_CELLS);
  private caNext = new Uint8Array(CA_CELLS);
  private caBlocked = new Uint8Array(CA_CELLS);
  private caPhase = new Float32Array(CA_CELLS);
  private caMesh: THREE.InstancedMesh;
  private caMat: THREE.MeshStandardMaterial;
  private caAccumulator = 0;
  private caActive = false;
  private caAliveColor = new THREE.Color(ECO.mossGlow);
  private caIdleColor = new THREE.Color(ECO.moss);
  private alivePulse = IDLE_ALIVE_PULSE;
  private computing = false;
  private clock = new THREE.Clock();
  private panX = 0;
  private panZ = 0;
  private zoom = 1;
  private aspect = 1;
  private dragging = false;
  private didDrag = false;
  private dragStart = { x: 0, y: 0, panX: 0, panZ: 0 };
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private dummy = new THREE.Object3D();
  private colorHelper = new THREE.Color();

  layers: LayerVisibility;
  onAgentSelect: ((agent: Agent | null) => void) | null = null;
  onMovement: ((agent: Agent, from: { x: number; y: number }) => void) | null = null;
  private tooltipEl: HTMLElement | null;
  private colonyPurpose = "";

  constructor(canvas: HTMLCanvasElement) {
    this.tooltipEl = document.getElementById("cell-prompt-tooltip");
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(ECO.sky, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(ECO.skyFog, 70, 160);

    this.aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
    this.resize(canvas);

    const hemi = new THREE.HemisphereLight(ECO.sky, ECO.grass, 1.45);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff8e1, 1.55);
    sun.position.set(40, 60, 30);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x81d4fa, 0.35);
    fill.position.set(-30, 40, -20);
    this.scene.add(fill);

    this.zoneMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.86,
      metalness: 0.02,
      emissive: ECO.grassBright,
      emissiveIntensity: 0.12,
    });
    this.zoneMesh = new THREE.Mesh(this.buildZoneGeometry(), this.zoneMat);
    this.zoneMesh.rotation.x = -Math.PI / 2;
    this.zoneMesh.position.set(WORLD_EXTENT / 2, 0, WORLD_EXTENT / 2);
    this.scene.add(this.zoneMesh);

    this.caMat = new THREE.MeshStandardMaterial({
      color: ECO.moss,
      emissive: ECO.mossGlow,
      emissiveIntensity: 0.45,
      roughness: 0.55,
      metalness: 0.04,
      vertexColors: true,
    });
    const caGeo = new THREE.BoxGeometry(CA_CELL * 0.82, CELL * 0.22, CA_CELL * 0.82);
    this.caMesh = new THREE.InstancedMesh(caGeo, this.caMat, CA_CELLS);
    this.caMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.caMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CA_CELLS * 3), 3);
    this.initCaBlocked();
    this.caGrid.fill(0);
    this.updateCaMesh(0, 0);
    this.caMesh.visible = false;
    this.scene.add(this.caMesh);

    this.volWash = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_EXTENT * 1.1, WORLD_EXTENT * 1.1),
      new THREE.MeshBasicMaterial({
        color: ECO.grassBright,
        transparent: true,
        opacity: 0.07,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.volWash.rotation.x = -Math.PI / 2;
    this.volWash.position.set(WORLD_EXTENT / 2, 0.4, WORLD_EXTENT / 2);
    this.scene.add(this.volWash);

    const border = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_EXTENT + 6, WORLD_EXTENT + 6),
      new THREE.MeshStandardMaterial({ color: ECO.dirt, roughness: 0.95 }),
    );
    border.rotation.x = -Math.PI / 2;
    border.position.set(WORLD_EXTENT / 2, -0.08, WORLD_EXTENT / 2);
    this.scene.add(border);

    this.sectorLineMat = new THREE.LineBasicMaterial({ color: 0x2e5c28, transparent: true, opacity: 0.22 });
    this.sectorLines = new THREE.LineSegments(this.buildSectorGridGeometry(), this.sectorLineMat);
    this.sectorLines.rotation.x = -Math.PI / 2;
    this.sectorLines.position.set(WORLD_EXTENT / 2, 0.02, WORLD_EXTENT / 2);
    this.scene.add(this.sectorLines);

    const agentGeo = new THREE.BoxGeometry(CELL * 0.62, CELL * 0.62, CELL * 0.62);
    const agentMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.55,
      roughness: 0.35,
      metalness: 0.08,
      vertexColors: true,
    });
    this.agentMesh = new THREE.InstancedMesh(agentGeo, agentMat, MAX_AGENTS);
    this.agentMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.agentMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_AGENTS * 3), 3);
    for (let i = 0; i < MAX_AGENTS; i++) {
      this.dummy.position.set(0, -10, 0);
      this.dummy.scale.setScalar(0.001);
      this.dummy.updateMatrix();
      this.agentMesh.setMatrixAt(i, this.dummy.matrix);
      this.freeSlots.push(i);
    }
    this.agentMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.agentMesh);

    const bubbleGeo = new THREE.SphereGeometry(CELL * 0.11, 6, 6);
    const bubbleMat = new THREE.MeshStandardMaterial({
      color: ECO.mossGlow,
      emissive: ECO.mossGlow,
      emissiveIntensity: 0.55,
      transparent: true,
      opacity: 0.38,
      roughness: 0.2,
      metalness: 0.05,
      depthWrite: false,
    });
    this.bubbleMesh = new THREE.InstancedMesh(bubbleGeo, bubbleMat, AMBIENT_BUBBLE_COUNT);
    this.bubbleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const cx = WORLD_EXTENT / 2;
    const cz = WORLD_EXTENT / 2;
    for (let i = 0; i < AMBIENT_BUBBLE_COUNT; i++) {
      const angle = (i / AMBIENT_BUBBLE_COUNT) * Math.PI * 2 * 3.7;
      const radius = 6 + (i % 17) * 2.1 + Math.sin(i * 1.3) * 4;
      this.bubbleBase[i * 3] = cx + Math.cos(angle) * radius;
      this.bubbleBase[i * 3 + 1] = 0.12 + (i % 5) * 0.04;
      this.bubbleBase[i * 3 + 2] = cz + Math.sin(angle) * radius;
      this.bubblePhase[i * 4] = Math.random() * Math.PI * 2;
      this.bubblePhase[i * 4 + 1] = Math.random() * Math.PI * 2;
      this.bubblePhase[i * 4 + 2] = Math.random() * Math.PI * 2;
      this.bubblePhase[i * 4 + 3] = 0.55 + Math.random() * 0.9;
      this.dummy.position.set(this.bubbleBase[i * 3], this.bubbleBase[i * 3 + 1], this.bubbleBase[i * 3 + 2]);
      this.dummy.scale.setScalar(0.001);
      this.dummy.updateMatrix();
      this.bubbleMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.bubbleMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.bubbleMesh);

    this.layers = {
      agents: true,
      connections: true,
      negotiations: true,
      institutions: true,
      colony: true,
      conflictArena: true,
      metrics: true,
      birthDeath: true,
      attention_agent: true,
      loss_agent: true,
      gradient_descent_agent: true,
      residual_flow_agent: true,
      feed_forward_agent: true,
    };

    canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e, canvas));
    canvas.addEventListener("pointermove", (e) => this.onPointerMove(e, canvas));
    canvas.addEventListener("pointerup", () => { this.dragging = false; });
    canvas.addEventListener("pointerleave", () => this.hideCellTooltip());
    canvas.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener("click", (e) => this.onClick(e, canvas));
    window.addEventListener("resize", () => this.resize(canvas));
  }

  handleEvent(event: SimEvent): void {
    const p = event.payload;
    switch (event.type) {
      case "attention_judgment":
        if (this.layers.attention_agent) {
          this.addConnection(p as unknown as DependencyEntry);
          const entry = p as unknown as DependencyEntry;
          const from = this.agents.get(entry.from_id);
          const to = this.agents.get(entry.to_id);
          if (from) this.sparkCaAt(from.grid_x, from.grid_y, 1);
          if (to) this.sparkCaAt(to.grid_x, to.grid_y, 1);
        }
        break;
      case "messenger_propose":
      case "reformer_update":
      case "task_decomposed":
        if (this.layers.agents || this.layers.feed_forward_agent) {
          const id = (p.agent_id ?? p.assigned_to) as string;
          if (id) {
            this.pulseAgent(id);
            const agent = this.agents.get(id);
            if (agent) this.sparkCaAt(agent.grid_x, agent.grid_y, 2);
          }
        }
        break;
      case "tick_phase":
        if (this.layers.agents) this.pulseAllAgents();
        this.sparkCaFromAgents(2);
        break;
      case "attention_progress":
        if (this.layers.attention_agent && typeof p.matched === "number" && p.matched > 0) {
          this.pulseAllAgents();
          this.sparkCaFromAgents(1);
        }
        break;
      case "negotiation_round":
        if (this.layers.negotiations) this.showDebate(p.proposer_id as string, p.responder_id as string);
        break;
      case "conflict_resolved":
      case "conflict_injected":
        if (this.layers.conflictArena) this.flashConflictArena();
        break;
      case "auditor_regret":
        if (this.layers.loss_agent) this.flashBackdrop(0x2a1018);
        break;
      case "colony_voxel":
        if (this.layers.colony) this.signalAgentAtCell(p.x as number, p.y as number);
        break;
      case "agent_birth":
        if (this.layers.birthDeath) {
          this.upsertAgent({
            id: p.child_id as string,
            name: "Spawnling",
            role: "worker",
            verbs: p.verbs as string[],
            nouns: p.nouns as string[],
            adjectives: p.adjectives as string[],
            parent_ids: [],
            institution_id: null,
            grid_x: (p.grid_x as number) ?? WORLD_SIZE / 2,
            grid_y: (p.grid_y as number) ?? WORLD_SIZE / 2,
            current_task_id: null,
          });
        }
        break;
      case "agent_death":
        if (this.layers.birthDeath) this.removeAgent(p.agent_id as string);
        break;
      case "phase_change":
        this.applyDesignPhase(String(p.design_phase ?? "concept"));
        break;
      case "season_change":
        this.applySeason(String(p.macro_season ?? "sharp"), String(p.judgment_temperature ?? "sharp"));
        break;
      case "institution_formed":
        if (this.layers.institutions) this.addInstitutionHull(p);
        break;
    }
  }

  loadAgents(agents: Agent[]): void {
    const wasEmpty = this.agents.size === 0;
    const incoming = new Set(agents.map((a) => a.id));
    const cx = WORLD_SIZE / 2;
    const cy = WORLD_SIZE / 2;
    const now = this.clock.getElapsedTime();

    if (wasEmpty && agents.length > 0) {
      this.spreadWaveStart = now;
    }

    for (const id of [...this.agents.keys()]) {
      if (!incoming.has(id)) this.removeAgent(id);
    }
    for (const a of agents) {
      const isNew = !this.agents.has(a.id);
      if (isNew && wasEmpty) {
        const dist = Math.hypot(a.grid_x - cx, a.grid_y - cy);
        this.spawnAnim.set(a.id, {
          fromX: cx,
          fromY: cy,
          start: now + dist * 0.006,
          duration: 0.55 + dist * 0.014,
        });
      }
      this.upsertAgent(a);
    }
  }

  setColonyPurpose(goal: string): void {
    this.colonyPurpose = goal.trim();
  }

  /** Boost ambient motion while the society loop is actively computing. */
  setComputing(active: boolean): void {
    this.computing = active;
  }

  /** Start or stop Conway CA — only enabled after Deploy Colony. */
  setCaActive(active: boolean): void {
    this.caActive = active;
    if (active) {
      this.seedCaGrid();
      this.caAccumulator = 0;
      this.updateCaMesh(this.clock.getElapsedTime(), 1);
    } else {
      this.caGrid.fill(0);
      this.caAccumulator = 0;
      this.updateCaMesh(0, 0);
    }
    this.syncCaVisibility();
  }

  private syncCaVisibility(): void {
    this.caMesh.visible = this.layers.colony && this.caActive;
  }

  private agentPhase(id: string): number {
    let phase = this.agentMotionPhase.get(id);
    if (phase === undefined) {
      phase = (id.charCodeAt(0) + id.charCodeAt(id.length - 1)) * 0.17;
      this.agentMotionPhase.set(id, phase);
    }
    return phase;
  }

  /** Clear agents, playbook edges, and debate overlays for a fresh colony. */
  resetColony(): void {
    this.hideCellTooltip();
    for (const conn of this.connectionLines) {
      this.scene.remove(conn.line);
      conn.line.geometry.dispose();
      conn.mat.dispose();
    }
    this.connectionLines = [];
    this.spawnAnim.clear();
    this.spreadWaveStart = -1;
    this.setCaActive(false);
    for (const pts of this.debateParticles) {
      this.scene.remove(pts);
      pts.geometry.dispose();
      (pts.material as THREE.Material).dispose();
    }
    this.debateParticles = [];
    for (const hull of this.institutionHulls) {
      this.scene.remove(hull);
      hull.geometry.dispose();
      (hull.material as THREE.Material).dispose();
    }
    this.institutionHulls = [];
    if (this.conflictRing) this.conflictRing.visible = false;
    for (const id of [...this.agents.keys()]) this.removeAgent(id);
    this.onAgentSelect?.(null);
  }

  /** Blueprint voxels are metadata only — terrain shows agents, not decorative blocks. */
  loadColonyVoxels(_voxels: { x: number; y: number; color: string }[]): void {}

  getAgents(): Agent[] {
    return [...this.agents.values()];
  }

  getColonyStats(): ColonyStats {
    let activeAgents = 0;
    const sectors: Record<string, number> = {};
    for (const a of this.agents.values()) {
      if (a.current_task_id) activeAgents++;
      const sid = sectorId(a.grid_x, a.grid_y);
      sectors[sid] = (sectors[sid] ?? 0) + 1;
    }
    return {
      agentCount: this.agents.size,
      activeAgents,
      walkableCells: WORLD_SIZE * WORLD_SIZE,
      sectors,
    };
  }

  drawMinimap(ctx: CanvasRenderingContext2D, size: number): void {
    const scale = size / WORLD_SIZE;
    for (let sy = 0; sy < SECTOR_COUNT; sy++) {
      for (let sx = 0; sx < SECTOR_COUNT; sx++) {
        const c = sectorColor(sx, sy, sx * SECTOR_SIZE, sy * SECTOR_SIZE, 0.6);
        ctx.fillStyle = `rgb(${Math.floor(c.r * 255)},${Math.floor(c.g * 255)},${Math.floor(c.b * 255)})`;
        ctx.fillRect(sx * SECTOR_SIZE * scale, sy * SECTOR_SIZE * scale, SECTOR_SIZE * scale, SECTOR_SIZE * scale);
      }
    }
    for (const a of this.agents.values()) {
      const base = ROLE_COLORS[a.role] ?? 0x7ec8e3;
      const c = new THREE.Color(base);
      ctx.fillStyle = `rgb(${Math.floor(c.r * 255)},${Math.floor(c.g * 255)},${Math.floor(c.b * 255)})`;
      ctx.fillRect(a.grid_x * scale - 1, a.grid_y * scale - 1, Math.max(3, scale * 2), Math.max(3, scale * 2));
    }
  }

  private agentWorldPos(agent: Agent, t: number): { x: number; z: number; spreading: boolean } {
    let gx = agent.grid_x;
    let gy = agent.grid_y;
    let spreading = false;
    const anim = this.spawnAnim.get(agent.id);
    if (anim) {
      const p = (t - anim.start) / anim.duration;
      if (p < 1) {
        const eased = easeOutCubic(p);
        gx = anim.fromX + (agent.grid_x - anim.fromX) * eased;
        gy = anim.fromY + (agent.grid_y - anim.fromY) * eased;
        spreading = true;
      } else {
        this.spawnAnim.delete(agent.id);
      }
    }
    return {
      x: gx * CELL + CELL / 2,
      z: gy * CELL + CELL / 2,
      spreading,
    };
  }

  upsertAgent(agent: Agent): void {
    const prev = this.prevPositions.get(agent.id);
    if (prev && (prev.x !== agent.grid_x || prev.y !== agent.grid_y)) {
      this.onMovement?.(agent, prev);
    }
    this.prevPositions.set(agent.id, { x: agent.grid_x, y: agent.grid_y });
    this.agents.set(agent.id, agent);

    let idx = this.agentIndex.get(agent.id);
    if (idx === undefined) {
      idx = this.freeSlots.pop();
      if (idx === undefined) return;
      this.agentIndex.set(agent.id, idx);
      const cx = WORLD_SIZE / 2;
      const cy = WORLD_SIZE / 2;
      const dist = Math.hypot(agent.grid_x - cx, agent.grid_y - cy);
      const now = this.clock.getElapsedTime();
      this.spawnAnim.set(agent.id, {
        fromX: cx,
        fromY: cy,
        start: now + dist * 0.006,
        duration: 0.55 + dist * 0.014,
      });
    }

    const sx = Math.floor(agent.grid_x / SECTOR_SIZE);
    const sy = Math.floor(agent.grid_y / SECTOR_SIZE);
    const zone = sectorColor(sx, sy, agent.grid_x, agent.grid_y, 0.65);
    const role = new THREE.Color(ROLE_COLORS[agent.role] ?? 0x4dd0e1);
    this.colorHelper.copy(zone).lerp(role, 0.45);
    if (!agent.current_task_id) this.colorHelper.multiplyScalar(0.7);

    const t = this.clock.getElapsedTime();
    const pos = this.agentWorldPos(agent, t);
    const active = Boolean(agent.current_task_id);
    const stack = 1 + Math.min(agent.nouns.length, 4) * 0.12;
    const scale = (agent.role === "worker" || agent.role === "generalist" ? 0.88 : 1.05) * stack;
    const y = CELL * (0.28 + stack * 0.18);
    this.dummy.position.set(pos.x, y, pos.z);
    this.dummy.scale.set(1, active || pos.spreading ? scale * 1.1 : scale, 1);
    this.dummy.updateMatrix();
    this.agentMesh.setMatrixAt(idx, this.dummy.matrix);
    this.agentMesh.setColorAt(idx, this.colorHelper);
    this.agentMesh.instanceMatrix.needsUpdate = true;
    if (this.agentMesh.instanceColor) this.agentMesh.instanceColor.needsUpdate = true;
  }

  removeAgent(id: string): void {
    const idx = this.agentIndex.get(id);
    if (idx !== undefined) {
      this.dummy.position.set(0, -10, 0);
      this.dummy.scale.setScalar(0.001);
      this.dummy.updateMatrix();
      this.agentMesh.setMatrixAt(idx, this.dummy.matrix);
      this.agentMesh.instanceMatrix.needsUpdate = true;
      this.agentIndex.delete(id);
      this.freeSlots.push(idx);
    }
    this.agents.delete(id);
    this.prevPositions.delete(id);
    this.agentMotionPhase.delete(id);
  }

  applyLayers(): void {
    this.agentMesh.visible = this.layers.agents;
    this.bubbleMesh.visible = this.layers.colony;
    this.syncCaVisibility();
    this.connectionLines.forEach((c) => (c.line.visible = this.layers.connections));
    this.institutionHulls.forEach((m) => (m.visible = this.layers.institutions));
    this.debateParticles.forEach((p) => (p.visible = this.layers.negotiations));
    if (this.conflictRing) this.conflictRing.visible = this.layers.conflictArena;
  }

  render(): void {
    const dt = this.clock.getDelta();
    const t = this.clock.getElapsedTime();
    const targetPulse = this.computing ? COMPUTE_ALIVE_PULSE : IDLE_ALIVE_PULSE;
    this.alivePulse += (targetPulse - this.alivePulse) * 0.04;
    const life = this.alivePulse;

    if (this.caActive) {
      const caHz = this.computing ? CA_COMPUTE_HZ : CA_IDLE_HZ;
      this.caAccumulator += dt;
      const caInterval = 1 / caHz;
      while (this.caAccumulator >= caInterval) {
        this.stepCaGrid();
        this.caAccumulator -= caInterval;
      }
      this.updateCaMesh(t, life);
    }

    const agentMat = this.agentMesh.material as THREE.MeshStandardMaterial;
    agentMat.emissiveIntensity = 0.34 + Math.sin(t * 2.5) * 0.1 * life;

    for (const [id, idx] of this.agentIndex) {
      const agent = this.agents.get(id);
      if (!agent) continue;
      const pos = this.agentWorldPos(agent, t);
      const phase = this.agentPhase(id);
      const pulsing = (this.agentPulseUntil.get(id) ?? 0) > t;
      const working = Boolean(agent.current_task_id) || pulsing || pos.spreading;
      const ambientBob = Math.sin(t * 2.2 + phase) * 0.09 * life;
      const activeBob = working ? Math.sin(t * 4.2 + idx * 0.3) * 0.05 * life : 0;
      const wobbleX = Math.sin(t * 1.35 + phase * 1.7) * 0.045 * life;
      const wobbleZ = Math.cos(t * 1.15 + phase * 2.3) * 0.045 * life;
      const stack = 1 + Math.min(agent.nouns.length, 4) * 0.12;
      const base = (agent.role === "worker" || agent.role === "generalist" ? 0.88 : 1.05) * stack;
      const breathe = 1 + Math.sin(t * 1.9 + phase) * 0.07 * life;
      const scale = base * breathe * (pulsing ? 1.22 : working ? 1.08 : 1);
      const y = CELL * (0.28 + stack * 0.18) + ambientBob + activeBob;
      this.dummy.position.set(pos.x + wobbleX, y, pos.z + wobbleZ);
      this.dummy.scale.set(1, scale, 1);
      this.dummy.updateMatrix();
      this.agentMesh.setMatrixAt(idx, this.dummy.matrix);
    }
    this.agentMesh.instanceMatrix.needsUpdate = true;

    const bubbleMat = this.bubbleMesh.material as THREE.MeshStandardMaterial;
    bubbleMat.emissiveIntensity = 0.42 + Math.sin(t * 1.6) * 0.18 * life;
    bubbleMat.opacity = 0.28 + Math.sin(t * 1.1) * 0.1 * life;
    for (let i = 0; i < AMBIENT_BUBBLE_COUNT; i++) {
      const ph0 = this.bubblePhase[i * 4];
      const ph1 = this.bubblePhase[i * 4 + 1];
      const ph2 = this.bubblePhase[i * 4 + 2];
      const speed = this.bubblePhase[i * 4 + 3];
      const bx = this.bubbleBase[i * 3];
      const by = this.bubbleBase[i * 3 + 1];
      const bz = this.bubbleBase[i * 3 + 2];
      const rise = Math.abs(Math.sin(t * (0.85 + speed * 0.25) + ph1)) * 0.42 * life;
      const driftX = Math.sin(t * (0.65 + speed * 0.15) + ph0) * 0.28 * life;
      const driftZ = Math.cos(t * (0.55 + speed * 0.12) + ph2) * 0.28 * life;
      const bScale = (0.45 + Math.sin(t * (1.7 + speed * 0.2) + ph0) * 0.28) * life;
      this.dummy.position.set(bx + driftX, by + rise, bz + driftZ);
      this.dummy.scale.setScalar(bScale);
      this.dummy.updateMatrix();
      this.bubbleMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.bubbleMesh.instanceMatrix.needsUpdate = true;

    for (const conn of this.connectionLines) {
      const from = this.agents.get(conn.fromId);
      const to = this.agents.get(conn.toId);
      const lineY = conn.y + Math.sin(t * 2.4 + conn.pulse) * 0.08 * life;
      if (from && to) {
        const fp = this.agentWorldPos(from, t);
        const tp = this.agentWorldPos(to, t);
        const pos = conn.line.geometry.getAttribute("position") as THREE.BufferAttribute;
        pos.setXYZ(0, fp.x, lineY, fp.z);
        pos.setXYZ(1, tp.x, lineY, tp.z);
        pos.needsUpdate = true;
        conn.line.computeLineDistances();
      }
      const age = t - conn.birth;
      const fadeIn = Math.min(1, age * 2.5);
      const pulse = 0.72 + Math.sin(t * 3.2 + conn.pulse) * 0.22;
      conn.mat.opacity = (0.35 + conn.strength * 0.45) * pulse * fadeIn;
      (conn.mat as THREE.LineDashedMaterial & { dashOffset: number }).dashOffset -=
        (0.035 + 0.03 * life) * (0.6 + conn.strength);
    }

    for (let i = 0; i < this.institutionHulls.length; i++) {
      const hull = this.institutionHulls[i];
      const baseY = (hull.userData.baseY as number | undefined) ?? hull.position.y;
      hull.position.y = baseY + Math.sin(t * 1.6 + i * 0.8) * 0.05 * life;
      const s = 1 + Math.sin(t * 2.1 + i * 0.5) * 0.035 * life;
      hull.scale.set(s, 1, s);
    }

    let waveBoost = 0;
    if (this.spreadWaveStart >= 0) {
      const waveAge = t - this.spreadWaveStart;
      if (waveAge < 2.8) {
        waveBoost = Math.sin(waveAge * 4.5) * Math.max(0, 1 - waveAge / 2.8) * 0.18;
      } else {
        this.spreadWaveStart = -1;
      }
    }
    const meadowPulse = Math.sin(t * 1.2) * 0.05 * life;
    this.zoneMat.emissiveIntensity = 0.1 + meadowPulse + waveBoost;
    (this.volWash.material as THREE.MeshBasicMaterial).opacity =
      0.06 + Math.sin(t * 0.8) * 0.03 * life + waveBoost * 0.6;
    this.sectorLineMat.opacity = 0.22 + Math.sin(t * 1.6) * 0.05 * life + waveBoost;
    this.volWash.position.y = 0.4 + Math.sin(t * 0.9) * 0.06 * life;
    const washScale = 1 + Math.sin(t * 0.7) * 0.012 * life;
    this.volWash.scale.set(washScale, washScale, 1);
    this.sectorLines.position.y = 0.02 + Math.sin(t * 1.3) * 0.015 * life;

    if (this.caActive) {
      this.caMat.emissiveIntensity = 0.38 + Math.sin(t * 2.8) * 0.14 * life;
    }

    this.renderer.render(this.scene, this.camera);
  }

  private caIndex(cx: number, cy: number): number {
    return cy * CA_SIZE + cx;
  }

  private initCaBlocked(): void {
    for (let cy = 0; cy < CA_SIZE; cy++) {
      for (let cx = 0; cx < CA_SIZE; cx++) {
        const idx = this.caIndex(cx, cy);
        const { wx, wy } = caWorldCoord(cx, cy);
        this.caBlocked[idx] = isTreeWorld(wx, wy) ? 1 : 0;
      }
    }
  }

  private seedCaGrid(): void {
    for (let cy = 0; cy < CA_SIZE; cy++) {
      for (let cx = 0; cx < CA_SIZE; cx++) {
        const idx = this.caIndex(cx, cy);
        const { wx, wy } = caWorldCoord(cx, cy);
        if (isTreeWorld(wx, wy)) {
          this.caBlocked[idx] = 1;
          this.caGrid[idx] = 0;
          this.caPhase[idx] = 0;
          continue;
        }
        this.caBlocked[idx] = 0;
        this.caGrid[idx] = Math.random() < 0.26 ? 1 : 0;
        this.caPhase[idx] = Math.random() * Math.PI * 2;
      }
    }
    const mid = Math.floor(CA_SIZE / 2);
    const gliders: [number, number][] = [
      [mid - 4, mid - 2],
      [mid - 3, mid - 1],
      [mid - 2, mid - 1],
      [mid - 1, mid],
      [mid - 4, mid],
      [mid + 2, mid + 3],
      [mid + 3, mid + 4],
      [mid + 4, mid + 4],
      [mid + 5, mid + 4],
    ];
    for (const [gx, gy] of gliders) {
      if (gx < 0 || gy < 0 || gx >= CA_SIZE || gy >= CA_SIZE) continue;
      const idx = this.caIndex(gx, gy);
      if (!this.caBlocked[idx]) this.caGrid[idx] = 1;
    }
  }

  private stepCaGrid(): void {
    for (let cy = 0; cy < CA_SIZE; cy++) {
      for (let cx = 0; cx < CA_SIZE; cx++) {
        const idx = this.caIndex(cx, cy);
        if (this.caBlocked[idx]) {
          this.caNext[idx] = 0;
          continue;
        }
        let neighbors = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = (cx + dx + CA_SIZE) % CA_SIZE;
            const ny = (cy + dy + CA_SIZE) % CA_SIZE;
            const nIdx = this.caIndex(nx, ny);
            if (!this.caBlocked[nIdx]) neighbors += this.caGrid[nIdx];
          }
        }
        const alive = this.caGrid[idx] === 1;
        this.caNext[idx] = alive ? (neighbors === 2 || neighbors === 3 ? 1 : 0) : neighbors === 3 ? 1 : 0;
      }
    }
    this.caGrid.set(this.caNext);
  }

  private updateCaMesh(t: number, life: number): void {
    let i = 0;
    for (let cy = 0; cy < CA_SIZE; cy++) {
      for (let cx = 0; cx < CA_SIZE; cx++) {
        const idx = this.caIndex(cx, cy);
        const alive = this.caGrid[idx] === 1 && !this.caBlocked[idx];
        const x = cx * CA_CELL + CA_CELL / 2;
        const z = cy * CA_CELL + CA_CELL / 2;
        if (alive) {
          const pulse = 0.82 + Math.sin(t * 5.5 + this.caPhase[idx]) * 0.22 * life;
          const bob = Math.sin(t * 3.4 + this.caPhase[idx] * 1.3) * 0.04 * life;
          this.dummy.position.set(x, CELL * 0.14 + bob, z);
          this.dummy.scale.set(pulse, 0.85 + pulse * 0.2, pulse);
          this.caAliveColor.setHex(ECO.mossGlow);
          this.caAliveColor.lerp(this.colorHelper.setHex(ECO.grassBright), 0.18);
        } else {
          this.dummy.position.set(x, -3, z);
          this.dummy.scale.setScalar(0.001);
          this.caIdleColor.setHex(ECO.moss);
        }
        this.dummy.updateMatrix();
        this.caMesh.setMatrixAt(i, this.dummy.matrix);
        this.caMesh.setColorAt(i, alive ? this.caAliveColor : this.caIdleColor);
        i++;
      }
    }
    this.caMesh.instanceMatrix.needsUpdate = true;
    if (this.caMesh.instanceColor) this.caMesh.instanceColor.needsUpdate = true;
  }

  private sparkCaAt(wx: number, wy: number, radius = 2): void {
    if (!this.caActive) return;
    const cx = Math.floor((wx / WORLD_SIZE) * CA_SIZE);
    const cy = Math.floor((wy / WORLD_SIZE) * CA_SIZE);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = (cx + dx + CA_SIZE) % CA_SIZE;
        const ny = (cy + dy + CA_SIZE) % CA_SIZE;
        const idx = this.caIndex(nx, ny);
        if (this.caBlocked[idx]) continue;
        if (Math.abs(dx) + Math.abs(dy) <= radius) {
          this.caGrid[idx] = Math.random() < 0.72 ? 1 : 0;
        }
      }
    }
  }

  private sparkCaFromAgents(radius = 1): void {
    for (const agent of this.agents.values()) {
      this.sparkCaAt(agent.grid_x, agent.grid_y, radius);
    }
  }

  private buildZoneGeometry(): THREE.BufferGeometry {
    const geo = new THREE.PlaneGeometry(WORLD_EXTENT, WORLD_EXTENT, WORLD_SIZE, WORLD_SIZE);
    const colors: number[] = [];
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i) + WORLD_EXTENT / 2;
      const ly = -pos.getY(i) + WORLD_EXTENT / 2;
      const gx = Math.floor((lx / WORLD_EXTENT) * WORLD_SIZE);
      const gy = Math.floor((ly / WORLD_EXTENT) * WORLD_SIZE);
      const sx = Math.floor(gx / SECTOR_SIZE);
      const sy = Math.floor(gy / SECTOR_SIZE);
      const fx = (gx % SECTOR_SIZE) / SECTOR_SIZE;
      const fy = (gy % SECTOR_SIZE) / SECTOR_SIZE;
      const center = sectorColor(sx, sy, gx, gy, 0.72);
      const edge = sectorColor(sx, sy, gx, gy, 0.38);
      const dist = Math.sqrt((fx - 0.5) ** 2 + (fy - 0.5) ** 2);
      this.colorHelper.copy(center).lerp(edge, Math.min(1, dist * 1.4));
      colors.push(this.colorHelper.r, this.colorHelper.g, this.colorHelper.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return geo;
  }

  private buildSectorGridGeometry(): THREE.BufferGeometry {
    const pts: number[] = [];
    for (let i = 0; i <= SECTOR_COUNT; i++) {
      const p = i * SECTOR_SIZE * CELL;
      pts.push(-WORLD_EXTENT / 2, p - WORLD_EXTENT / 2, 0, WORLD_EXTENT / 2, p - WORLD_EXTENT / 2, 0);
      pts.push(p - WORLD_EXTENT / 2, -WORLD_EXTENT / 2, 0, p - WORLD_EXTENT / 2, WORLD_EXTENT / 2, 0);
    }
    return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  }

  private signalAgentAtCell(x: number, y: number): void {
    for (const a of this.agents.values()) {
      if (a.grid_x === x && a.grid_y === y) {
        this.pulseAgent(a.id);
        return;
      }
    }
    const architect = [...this.agents.values()].find((a) => a.role === "voxel_architect");
    if (architect) this.pulseAgent(architect.id);
  }

  private addConnection(entry: DependencyEntry): void {
    const from = this.agents.get(entry.from_id);
    const to = this.agents.get(entry.to_id);
    if (!from || !to) return;
    const strength = STRENGTH_SCALE[entry.strength] ?? 0;
    if (strength <= 0) return;
    const color = KIND_COLORS[entry.kind] ?? 0xffffff;
    const y = 0.85 + strength * 0.35;
    const mat = new THREE.LineDashedMaterial({
      color,
      dashSize: 0.32 + strength * 0.18,
      gapSize: 0.16,
      transparent: true,
      opacity: 0,
    });
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(from.grid_x * CELL + CELL / 2, y, from.grid_y * CELL + CELL / 2),
        new THREE.Vector3(to.grid_x * CELL + CELL / 2, y, to.grid_y * CELL + CELL / 2),
      ]),
      mat,
    );
    line.computeLineDistances();
    this.scene.add(line);
    this.connectionLines.push({
      line,
      mat,
      birth: this.clock.getElapsedTime(),
      pulse: Math.random() * Math.PI * 2,
      strength,
      fromId: entry.from_id,
      toId: entry.to_id,
      y,
    });
    if (this.connectionLines.length > 200) {
      const old = this.connectionLines.shift()!;
      this.scene.remove(old.line);
      old.line.geometry.dispose();
      old.mat.dispose();
    }
  }

  private showDebate(fromId: string, toId: string): void {
    const from = this.agents.get(fromId);
    const to = this.agents.get(toId);
    if (!from || !to) return;
    const positions = new Float32Array(15);
    const fx = from.grid_x * CELL + CELL / 2;
    const fy = from.grid_y * CELL + CELL / 2;
    const tx = to.grid_x * CELL + CELL / 2;
    const ty = to.grid_y * CELL + CELL / 2;
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      positions[i * 3] = fx + (tx - fx) * t;
      positions[i * 3 + 1] = 1.2 + Math.sin(t * Math.PI);
      positions[i * 3 + 2] = fy + (ty - fy) * t;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0xffeb3b, size: 0.35, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending }),
    );
    this.scene.add(pts);
    this.debateParticles.push(pts);
    setTimeout(() => {
      this.scene.remove(pts);
      geo.dispose();
      (pts.material as THREE.Material).dispose();
    }, 2500);
  }

  private pulseAgent(id: string): void {
    if (!this.agents.has(id)) return;
    this.agentPulseUntil.set(id, this.clock.getElapsedTime() + 0.55);
  }

  private pulseAllAgents(): void {
    const until = this.clock.getElapsedTime() + 0.45;
    for (const id of this.agents.keys()) {
      this.agentPulseUntil.set(id, until);
    }
  }

  private flashConflictArena(): void {
    const cx = (WORLD_SIZE / 2) * CELL;
    const cy = (WORLD_SIZE / 2) * CELL;
    if (!this.conflictRing) {
      this.conflictRing = new THREE.Mesh(
        new THREE.RingGeometry(2, 5, 48),
        new THREE.MeshBasicMaterial({ color: 0xff5252, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
      );
      this.conflictRing.rotation.x = -Math.PI / 2;
      this.scene.add(this.conflictRing);
    }
    this.conflictRing.position.set(cx, 0.15, cy);
    this.conflictRing.visible = true;
    setTimeout(() => {
      if (this.conflictRing) this.conflictRing.visible = this.layers.conflictArena;
    }, 1200);
  }

  private addInstitutionHull(payload: Record<string, unknown>): void {
    const memberIds = (payload.member_ids as string[]) ?? [];
    const members = memberIds.map((id) => this.agents.get(id)).filter(Boolean) as Agent[];
    if (!members.length) return;
    let cx = 0;
    let cz = 0;
    for (const m of members) {
      cx += m.grid_x;
      cz += m.grid_y;
    }
    cx = (cx / members.length) * CELL + CELL / 2;
    cz = (cz / members.length) * CELL + CELL / 2;
    const radius = Math.max(2.5, Math.sqrt(members.length) * 1.4);
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(radius * 2, CELL * 0.35, radius * 2),
      new THREE.MeshStandardMaterial({
        color: 0xc5e1a5,
        emissive: 0x558b2f,
        emissiveIntensity: 0.35,
        transparent: true,
        opacity: 0.45,
      }),
    );
    hull.position.set(cx, CELL * 0.12, cz);
    hull.userData.baseY = CELL * 0.12;
    this.scene.add(hull);
    this.institutionHulls.push(hull);
    if (this.institutionHulls.length > 24) {
      const old = this.institutionHulls.shift()!;
      this.scene.remove(old);
      old.geometry.dispose();
      (old.material as THREE.Material).dispose();
    }
  }

  private applySeason(macro: string, temperature: string): void {
    this.seasonTint = macro === "sharp" ? 1 : 0.82;
    const sky = macro === "sharp" ? ECO.sky : 0xa8c8e8;
    const fog = macro === "sharp" ? ECO.skyFog : 0xc8d8e8;
    this.renderer.setClearColor(sky);
    if (this.scene.fog) (this.scene.fog as THREE.Fog).color.setHex(fog);
    this.zoneMat.emissiveIntensity = temperature === "sharp" ? 0.14 : 0.08;
  }

  private applyDesignPhase(phase: string): void {
    const tints: Record<string, number> = {
      concept: 0x0a1420,
      technical: 0x0a1a28,
      polish: 0x1a1428,
      validation: 0x142818,
    };
    this.flashBackdrop(tints[phase] ?? 0x0a1420);
  }

  private flashBackdrop(color: number): void {
    const prev = this.renderer.getClearColor(new THREE.Color());
    this.renderer.setClearColor(color);
    setTimeout(() => this.renderer.setClearColor(ECO.sky), 300);
  }

  /** Reset pan/zoom to the default isometric view centered on the colony. */
  recenter(): void {
    this.panX = 0;
    this.panZ = 0;
    this.fitCamera();
  }

  private fitCamera(): void {
    const cx = WORLD_EXTENT / 2 + this.panX;
    const cz = WORLD_EXTENT / 2 + this.panZ;
    this.camera.position.set(cx + 18, 88, cz + 22);
    this.camera.lookAt(cx, 0, cz);
    const pad = 1.04;
    const fitZoom = Math.min(
      (this.aspect * 100) / (WORLD_EXTENT * pad),
      100 / (WORLD_EXTENT * pad),
    );
    this.zoom = fitZoom;
    this.applyZoom();
  }

  private applyZoom(): void {
    const halfH = (WORLD_EXTENT / this.zoom) / 2;
    const halfW = halfH * this.aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.zoom = Math.max(0.35, Math.min(4, this.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    this.applyZoom();
  }

  private onPointerDown(e: PointerEvent, canvas: HTMLCanvasElement): void {
    this.dragging = true;
    this.didDrag = false;
    this.dragStart = { x: e.clientX, y: e.clientY, panX: this.panX, panZ: this.panZ };
    canvas.setPointerCapture(e.pointerId);
  }

  private onPointerMove(e: PointerEvent, canvas: HTMLCanvasElement): void {
    if (this.dragging) {
      const dx = (e.clientX - this.dragStart.x) / this.zoom;
      const dy = (e.clientY - this.dragStart.y) / this.zoom;
      if (Math.abs(e.clientX - this.dragStart.x) > 4 || Math.abs(e.clientY - this.dragStart.y) > 4) {
        this.didDrag = true;
      }
      this.panX = this.dragStart.panX - dx;
      this.panZ = this.dragStart.panZ - dy;
      const cx = WORLD_EXTENT / 2 + this.panX;
      const cz = WORLD_EXTENT / 2 + this.panZ;
      this.camera.position.set(cx + 18, 88, cz + 22);
      this.camera.lookAt(cx, 0, cz);
      this.hideCellTooltip();
      return;
    }
    this.updateCellHover(e, canvas);
  }

  private updateCellHover(e: PointerEvent, canvas: HTMLCanvasElement): void {
    if (!this.tooltipEl) return;
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObject(this.zoneMesh);
    if (!hits.length) {
      this.hideCellTooltip();
      return;
    }
    const gx = Math.max(0, Math.min(WORLD_SIZE - 1, Math.floor(hits[0].point.x / CELL)));
    const gy = Math.max(0, Math.min(WORLD_SIZE - 1, Math.floor(hits[0].point.z / CELL)));
    const agent = [...this.agents.values()].find((a) => a.grid_x === gx && a.grid_y === gy);
    const stage = canvas.parentElement;
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    this.tooltipEl.style.left = `${e.clientX - stageRect.left + 12}px`;
    this.tooltipEl.style.top = `${e.clientY - stageRect.top + 12}px`;
    if (agent) {
      const prompt = formatSystemPrompt(agent, this.colonyPurpose);
      this.tooltipEl.innerHTML = `<strong>${agent.name}</strong><pre>${prompt.replace(/</g, "&lt;")}</pre>`;
    } else {
      this.tooltipEl.innerHTML = `<span class="cell-empty">Cell (${gx}, ${gy}) — meadow · no agent</span>`;
    }
    this.tooltipEl.classList.remove("hidden");
  }

  private hideCellTooltip(): void {
    this.tooltipEl?.classList.add("hidden");
  }

  private onClick(e: MouseEvent, canvas: HTMLCanvasElement): void {
    if (this.didDrag) return;
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObject(this.agentMesh);
    if (hits.length && hits[0].instanceId !== undefined) {
      for (const [id, slot] of this.agentIndex) {
        if (slot === hits[0].instanceId) {
          this.onAgentSelect?.(this.agents.get(id) ?? null);
          return;
        }
      }
    }
    this.onAgentSelect?.(null);
  }

  private resize(canvas: HTMLCanvasElement): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    this.renderer.setSize(w, h);
    this.aspect = w / h;
    this.fitCamera();
  }
}