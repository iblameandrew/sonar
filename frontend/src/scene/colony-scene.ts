/** Colony isometric zone-map scene (Three.js). */
import * as THREE from "three";
import type { Agent, DependencyEntry, LayerVisibility, SimEvent } from "../types";
import { KIND_COLORS, ROLE_COLORS, STRENGTH_SCALE } from "../types";

export const WORLD_SIZE = 96;
export const SECTOR_SIZE = 12;
export const MAX_AGENTS = 2048;
const CELL = 1;
const WORLD_EXTENT = WORLD_SIZE * CELL;
const SECTOR_COUNT = Math.floor(WORLD_SIZE / SECTOR_SIZE);

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

export class ColonyScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  private zoneMesh: THREE.Mesh;
  private zoneMat: THREE.MeshStandardMaterial;
  private volWash: THREE.Mesh;
  private sectorLines: THREE.LineSegments;
  private agentMesh: THREE.InstancedMesh;
  private agentIndex = new Map<string, number>();
  private freeSlots: number[] = [];
  private agents = new Map<string, Agent>();
  private prevPositions = new Map<string, { x: number; y: number }>();
  private connectionLines: THREE.Line[] = [];
  private debateParticles: THREE.Points[] = [];
  private conflictRing: THREE.Mesh | null = null;
  private agentPulseUntil = new Map<string, number>();
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

  constructor(canvas: HTMLCanvasElement) {
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

    this.sectorLines = new THREE.LineSegments(
      this.buildSectorGridGeometry(),
      new THREE.LineBasicMaterial({ color: 0x2e5c28, transparent: true, opacity: 0.22 }),
    );
    this.sectorLines.rotation.x = -Math.PI / 2;
    this.sectorLines.position.set(WORLD_EXTENT / 2, 0.02, WORLD_EXTENT / 2);
    this.scene.add(this.sectorLines);

    const agentGeo = new THREE.SphereGeometry(CELL * 0.42, 10, 10);
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
    canvas.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener("click", (e) => this.onClick(e, canvas));
    window.addEventListener("resize", () => this.resize(canvas));
  }

  handleEvent(event: SimEvent): void {
    const p = event.payload;
    switch (event.type) {
      case "attention_judgment":
        if (this.layers.attention_agent) this.addConnection(p as unknown as DependencyEntry);
        break;
      case "messenger_propose":
      case "reformer_update":
      case "task_decomposed":
        if (this.layers.agents || this.layers.feed_forward_agent) {
          const id = (p.agent_id ?? p.assigned_to) as string;
          if (id) this.pulseAgent(id);
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
        this.flashBackdrop(0x0a1420);
        break;
    }
  }

  loadAgents(agents: Agent[]): void {
    const incoming = new Set(agents.map((a) => a.id));
    for (const id of [...this.agents.keys()]) {
      if (!incoming.has(id)) this.removeAgent(id);
    }
    for (const a of agents) this.upsertAgent(a);
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
    }

    const sx = Math.floor(agent.grid_x / SECTOR_SIZE);
    const sy = Math.floor(agent.grid_y / SECTOR_SIZE);
    const zone = sectorColor(sx, sy, agent.grid_x, agent.grid_y, 0.65);
    const role = new THREE.Color(ROLE_COLORS[agent.role] ?? 0x4dd0e1);
    this.colorHelper.copy(zone).lerp(role, 0.45);
    if (!agent.current_task_id) this.colorHelper.multiplyScalar(0.7);

    const active = Boolean(agent.current_task_id);
    const scale = agent.role === "worker" || agent.role === "generalist" ? 0.9 : 1.05;
    this.dummy.position.set(agent.grid_x * CELL + CELL / 2, CELL * 0.38, agent.grid_y * CELL + CELL / 2);
    this.dummy.scale.setScalar(active ? scale * 1.08 : scale);
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
  }

  applyLayers(): void {
    this.agentMesh.visible = this.layers.agents;
    this.connectionLines.forEach((l) => (l.visible = this.layers.connections));
    this.debateParticles.forEach((p) => (p.visible = this.layers.negotiations));
    if (this.conflictRing) this.conflictRing.visible = this.layers.conflictArena;
  }

  render(): void {
    const t = this.clock.getElapsedTime();
    const agentMat = this.agentMesh.material as THREE.MeshStandardMaterial;
    agentMat.emissiveIntensity = 0.38 + Math.sin(t * 2.5) * 0.08;

    for (const [id, idx] of this.agentIndex) {
      const agent = this.agents.get(id);
      if (!agent) continue;
      const pulsing = (this.agentPulseUntil.get(id) ?? 0) > t;
      const working = Boolean(agent.current_task_id) || pulsing;
      const bob = working ? Math.sin(t * 4 + idx * 0.3) * 0.06 : 0;
      const scale =
        (agent.role === "worker" || agent.role === "generalist" ? 0.9 : 1.05) *
        (pulsing ? 1.25 : working ? 1.08 : 1);
      this.dummy.position.set(
        agent.grid_x * CELL + CELL / 2,
        CELL * 0.38 + bob,
        agent.grid_y * CELL + CELL / 2,
      );
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.agentMesh.setMatrixAt(idx, this.dummy.matrix);
    }
    this.agentMesh.instanceMatrix.needsUpdate = true;

    this.zoneMat.emissiveIntensity = 0.1 + Math.sin(t * 1.2) * 0.04;
    (this.volWash.material as THREE.MeshBasicMaterial).opacity = 0.06 + Math.sin(t * 0.8) * 0.025;

    this.renderer.render(this.scene, this.camera);
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
    if ((STRENGTH_SCALE[entry.strength] ?? 0) <= 0) return;
    const color = KIND_COLORS[entry.kind] ?? 0xffffff;
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(from.grid_x * CELL + CELL / 2, 0.8, from.grid_y * CELL + CELL / 2),
        new THREE.Vector3(to.grid_x * CELL + CELL / 2, 0.8, to.grid_y * CELL + CELL / 2),
      ]),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 }),
    );
    this.scene.add(line);
    this.connectionLines.push(line);
    if (this.connectionLines.length > 200) {
      const old = this.connectionLines.shift()!;
      this.scene.remove(old);
      old.geometry.dispose();
      (old.material as THREE.Material).dispose();
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

  private flashBackdrop(color: number): void {
    const prev = this.renderer.getClearColor(new THREE.Color());
    this.renderer.setClearColor(color);
    setTimeout(() => this.renderer.setClearColor(ECO.sky), 300);
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

  private onPointerMove(e: PointerEvent, _canvas: HTMLCanvasElement): void {
    if (!this.dragging) return;
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