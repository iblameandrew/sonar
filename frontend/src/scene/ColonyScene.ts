import * as THREE from "three";
import type { Agent, DependencyEntry, LayerVisibility, SimEvent } from "../types";
import { KIND_COLORS, ROLE_COLORS, STRENGTH_SCALE } from "../types";

export const WORLD_SIZE = 96;
export const TREE_MARGIN = 4;
export const TREE_SPACING = 8;
export const MAX_AGENTS = 2048;
const CELL = 0.28;
const WORLD_EXTENT = WORLD_SIZE * CELL;

const PALETTE = {
  sky: 0xa8d8ea,
  meadow: 0x6dbb5e,
  meadowDark: 0x4a8f42,
  dirt: 0x8b6914,
  treeTrunk: 0x6d4c2e,
  treeLeaf: 0x2e7d32,
  lifeGlow: 0x66ffaa,
  lifeDim: 0x3ddc84,
};

export interface ColonyStats {
  agentCount: number;
  lifeAlive: number;
  walkableCells: number;
  sectors: Record<string, number>;
}

function isTreeCell(x: number, y: number): boolean {
  if (x < TREE_MARGIN || y < TREE_MARGIN || x >= WORLD_SIZE - TREE_MARGIN || y >= WORLD_SIZE - TREE_MARGIN) {
    return false;
  }
  const lx = x - TREE_MARGIN;
  const ly = y - TREE_MARGIN;
  return lx % TREE_SPACING === 0 && ly % TREE_SPACING === 0;
}

function isWalkable(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < WORLD_SIZE && y < WORLD_SIZE && !isTreeCell(x, y);
}

function sectorId(x: number, y: number): string {
  return `s${Math.floor(x / 12)}-${Math.floor(y / 12)}`;
}

function gridIndex(x: number, y: number): number {
  return y * WORLD_SIZE + x;
}

export class ColonyScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  private lifeGrid: Uint8Array;
  private lifeMesh: THREE.InstancedMesh;
  private treeMesh: THREE.InstancedMesh;
  private agentMesh: THREE.InstancedMesh;
  private agentColors: Float32Array;
  private agentIndex = new Map<string, number>();
  private freeSlots: number[] = [];
  private agents = new Map<string, Agent>();
  private prevPositions = new Map<string, { x: number; y: number }>();
  private connectionLines: THREE.Line[] = [];
  private colonyMeshes: THREE.Mesh[] = [];
  private debateParticles: THREE.Points[] = [];
  private conflictRing: THREE.Mesh | null = null;
  private clock = new THREE.Clock();
  private lifeTick = 0;
  private walkableCount = 0;
  private panX = 0;
  private panZ = 0;
  private zoom = 1.1;
  private aspect = 1;
  private dragging = false;
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
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.setClearColor(PALETTE.sky, 1);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(PALETTE.sky, 60, 120);

    this.aspect = canvas.clientWidth / canvas.clientHeight;
    const frustum = 28;
    this.camera = new THREE.OrthographicCamera(
      (-frustum * this.aspect) / 2,
      (frustum * this.aspect) / 2,
      frustum / 2,
      -frustum / 2,
      0.1,
      200,
    );
    this.updateCamera();

    const hemi = new THREE.HemisphereLight(0xc8e6f5, PALETTE.meadow, 1.2);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff8e1, 1.1);
    sun.position.set(30, 50, 20);
    this.scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_EXTENT + 2, WORLD_EXTENT + 2),
      new THREE.MeshStandardMaterial({ color: PALETTE.meadow, roughness: 0.92 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(WORLD_EXTENT / 2, -0.02, WORLD_EXTENT / 2);
    this.scene.add(ground);

    const border = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_EXTENT + 4, WORLD_EXTENT + 4),
      new THREE.MeshStandardMaterial({ color: PALETTE.dirt, roughness: 1 }),
    );
    border.rotation.x = -Math.PI / 2;
    border.position.set(WORLD_EXTENT / 2, -0.06, WORLD_EXTENT / 2);
    this.scene.add(border);

    this.lifeGrid = new Uint8Array(WORLD_SIZE * WORLD_SIZE);
    this.seedLifeGrid();
    this.walkableCount = this.countWalkable();

    const lifeGeo = new THREE.BoxGeometry(CELL * 0.82, CELL * 0.35, CELL * 0.82);
    const lifeMat = new THREE.MeshStandardMaterial({
      color: PALETTE.lifeDim,
      emissive: PALETTE.lifeGlow,
      emissiveIntensity: 0.45,
      roughness: 0.55,
      vertexColors: true,
    });
    this.lifeMesh = new THREE.InstancedMesh(lifeGeo, lifeMat, WORLD_SIZE * WORLD_SIZE);
    this.lifeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.lifeMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(WORLD_SIZE * WORLD_SIZE * 3),
      3,
    );
    this.updateLifeMesh();
    this.scene.add(this.lifeMesh);

    const treePositions: { x: number; y: number }[] = [];
    for (let y = 0; y < WORLD_SIZE; y++) {
      for (let x = 0; x < WORLD_SIZE; x++) {
        if (isTreeCell(x, y)) treePositions.push({ x, y });
      }
    }
    const treeGeo = new THREE.BoxGeometry(CELL * 1.1, CELL * 2.2, CELL * 1.1);
    const treeMat = new THREE.MeshStandardMaterial({
      color: PALETTE.treeLeaf,
      emissive: 0x388e3c,
      emissiveIntensity: 0.08,
      roughness: 0.85,
    });
    this.treeMesh = new THREE.InstancedMesh(treeGeo, treeMat, treePositions.length);
    treePositions.forEach((p, i) => {
      this.dummy.position.set(p.x * CELL + CELL / 2, CELL * 1.1, p.y * CELL + CELL / 2);
      this.dummy.updateMatrix();
      this.treeMesh.setMatrixAt(i, this.dummy.matrix);
    });
    this.treeMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.treeMesh);

    const agentGeo = new THREE.BoxGeometry(CELL * 0.75, CELL * 1.1, CELL * 0.75);
    const agentMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.35,
      roughness: 0.45,
      vertexColors: true,
    });
    this.agentMesh = new THREE.InstancedMesh(agentGeo, agentMat, MAX_AGENTS);
    this.agentMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.agentColors = new Float32Array(MAX_AGENTS * 3);
    this.agentMesh.instanceColor = new THREE.InstancedBufferAttribute(this.agentColors, 3);
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
      lifeGrid: true,
      agents: true,
      connections: true,
      negotiations: true,
      institutions: true,
      colony: true,
      conflictArena: true,
      metrics: true,
      birthDeath: true,
      attention: true,
      auditor: true,
      reformer: true,
      confessor: true,
      messenger: true,
    };

    canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e, canvas));
    canvas.addEventListener("pointermove", (e) => this.onPointerMove(e, canvas));
    canvas.addEventListener("pointerup", () => { this.dragging = false; });
    canvas.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener("click", (e) => this.onClick(e, canvas));
    window.addEventListener("resize", () => this.onResize(canvas));
  }

  handleEvent(event: SimEvent): void {
    const p = event.payload;
    switch (event.type) {
      case "attention_judgment":
        if (this.layers.attention) this.addConnection(p as unknown as DependencyEntry);
        break;
      case "messenger_propose":
      case "reformer_update":
      case "task_decomposed":
        if (this.layers.agents || this.layers.messenger) {
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
        if (this.layers.auditor) this.flashSky(0xffccbc);
        break;
      case "colony_voxel":
        if (this.layers.colony) this.placeColonyVoxel(p as { x: number; y: number; color: string });
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
        this.flashSky(0xe1f5fe);
        break;
    }
  }

  loadAgents(agents: Agent[]): void {
    for (const a of agents) this.upsertAgent(a);
  }

  loadColonyVoxels(voxels: { x: number; y: number; color: string }[]): void {
    for (const v of voxels) this.placeColonyVoxel(v);
  }

  getAgents(): Agent[] {
    return [...this.agents.values()];
  }

  getColonyStats(): ColonyStats {
    let lifeAlive = 0;
    for (let i = 0; i < this.lifeGrid.length; i++) {
      if (this.lifeGrid[i]) lifeAlive++;
    }
    const sectors: Record<string, number> = {};
    for (const a of this.agents.values()) {
      const sid = sectorId(a.grid_x, a.grid_y);
      sectors[sid] = (sectors[sid] ?? 0) + 1;
    }
    return {
      agentCount: this.agents.size,
      lifeAlive,
      walkableCells: this.walkableCount,
      sectors,
    };
  }

  drawMinimap(ctx: CanvasRenderingContext2D, size: number): void {
    const scale = size / WORLD_SIZE;
    ctx.fillStyle = "#4a8f42";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#2e5c28";
    for (let y = 0; y < WORLD_SIZE; y += TREE_SPACING) {
      for (let x = 0; x < WORLD_SIZE; x += TREE_SPACING) {
        if (isTreeCell(x, y)) ctx.fillRect(x * scale, y * scale, scale * 2, scale * 2);
      }
    }
    ctx.fillStyle = "rgba(102,255,170,0.35)";
    for (let y = 0; y < WORLD_SIZE; y++) {
      for (let x = 0; x < WORLD_SIZE; x++) {
        if (this.lifeGrid[gridIndex(x, y)]) ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    for (const a of this.agents.values()) {
      const hex = ROLE_COLORS[a.role] ?? 0x4dd0e1;
      const c = new THREE.Color(hex);
      ctx.fillStyle = `rgb(${Math.floor(c.r * 255)},${Math.floor(c.g * 255)},${Math.floor(c.b * 255)})`;
      ctx.fillRect(a.grid_x * scale, a.grid_y * scale, Math.max(2, scale * 1.5), Math.max(2, scale * 1.5));
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

    const color = ROLE_COLORS[agent.role] ?? 0x7ec8e3;
    this.dummy.position.set(agent.grid_x * CELL + CELL / 2, CELL * 0.55, agent.grid_y * CELL + CELL / 2);
    this.dummy.scale.setScalar(1);
    this.dummy.updateMatrix();
    this.agentMesh.setMatrixAt(idx, this.dummy.matrix);
    this.colorHelper.setHex(color);
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
    this.lifeMesh.visible = this.layers.lifeGrid;
    this.agentMesh.visible = this.layers.agents;
    this.treeMesh.visible = true;
    this.connectionLines.forEach((l) => (l.visible = this.layers.connections));
    this.colonyMeshes.forEach((m) => (m.visible = this.layers.colony));
    this.debateParticles.forEach((p) => (p.visible = this.layers.negotiations));
    if (this.conflictRing) this.conflictRing.visible = this.layers.conflictArena;
  }

  render(): void {
    const t = this.clock.getElapsedTime();
    this.lifeTick++;
    if (this.lifeTick % 12 === 0 && this.layers.lifeGrid) {
      this.stepConway();
      this.updateLifeMesh();
    }

    const lifeMat = this.lifeMesh.material as THREE.MeshStandardMaterial;
    lifeMat.emissiveIntensity = 0.38 + Math.sin(t * 2) * 0.1;

    const agentMat = this.agentMesh.material as THREE.MeshStandardMaterial;
    agentMat.emissiveIntensity = 0.3 + Math.sin(t * 3) * 0.08;

    this.renderer.render(this.scene, this.camera);
  }

  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  private countWalkable(): number {
    let n = 0;
    for (let y = 0; y < WORLD_SIZE; y++) {
      for (let x = 0; x < WORLD_SIZE; x++) {
        if (isWalkable(x, y)) n++;
      }
    }
    return n;
  }

  private seedLifeGrid(): void {
    for (let y = 0; y < WORLD_SIZE; y++) {
      for (let x = 0; x < WORLD_SIZE; x++) {
        const i = gridIndex(x, y);
        if (!isWalkable(x, y)) {
          this.lifeGrid[i] = 0;
        } else {
          this.lifeGrid[i] = Math.random() < 0.18 ? 1 : 0;
        }
      }
    }
  }

  private stepConway(): void {
    const next = new Uint8Array(WORLD_SIZE * WORLD_SIZE);
    for (let y = 0; y < WORLD_SIZE; y++) {
      for (let x = 0; x < WORLD_SIZE; x++) {
        if (!isWalkable(x, y)) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < WORLD_SIZE && ny < WORLD_SIZE && isWalkable(nx, ny)) {
              n += this.lifeGrid[gridIndex(nx, ny)];
            }
          }
        }
        const alive = this.lifeGrid[gridIndex(x, y)];
        next[gridIndex(x, y)] = alive ? (n === 2 || n === 3 ? 1 : 0) : n === 3 ? 1 : 0;
      }
    }
    this.lifeGrid = next;
  }

  private updateLifeMesh(): void {
    let i = 0;
    for (let y = 0; y < WORLD_SIZE; y++) {
      for (let x = 0; x < WORLD_SIZE; x++) {
        const alive = this.lifeGrid[gridIndex(x, y)] === 1;
        if (alive) {
          this.dummy.position.set(x * CELL + CELL / 2, CELL * 0.2, y * CELL + CELL / 2);
          this.dummy.scale.setScalar(1);
          this.colorHelper.setHex(PALETTE.lifeGlow);
        } else {
          this.dummy.position.set(x * CELL, -5, y * CELL);
          this.dummy.scale.setScalar(0.001);
          this.colorHelper.setHex(PALETTE.lifeDim);
        }
        this.dummy.updateMatrix();
        this.lifeMesh.setMatrixAt(i, this.dummy.matrix);
        this.lifeMesh.setColorAt(i, this.colorHelper);
        i++;
      }
    }
    this.lifeMesh.instanceMatrix.needsUpdate = true;
    if (this.lifeMesh.instanceColor) this.lifeMesh.instanceColor.needsUpdate = true;
  }

  private addConnection(entry: DependencyEntry): void {
    const from = this.agents.get(entry.from_id);
    const to = this.agents.get(entry.to_id);
    if (!from || !to) return;
    const thickness = STRENGTH_SCALE[entry.strength] ?? 0.1;
    if (thickness <= 0) return;
    const color = KIND_COLORS[entry.kind] ?? 0xffffff;
    const fx = from.grid_x * CELL + CELL / 2;
    const fy = from.grid_y * CELL + CELL / 2;
    const tx = to.grid_x * CELL + CELL / 2;
    const ty = to.grid_y * CELL + CELL / 2;
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(fx, 1.4, fy),
        new THREE.Vector3(tx, 1.4, ty),
      ]),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75 }),
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

  private placeColonyVoxel(v: { x: number; y: number; color: string }): void {
    const col = new THREE.Color(v.color);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(CELL * 0.9, CELL * 1.4, CELL * 0.9),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.5, roughness: 0.4 }),
    );
    mesh.position.set(v.x * CELL, CELL * 0.7, v.y * CELL);
    this.scene.add(mesh);
    this.colonyMeshes.push(mesh);
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
      positions[i * 3 + 1] = 1.8 + Math.sin(t * Math.PI) * 1.2;
      positions[i * 3 + 2] = fy + (ty - fy) * t;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xffeb3b,
        size: 0.25,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
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
    const idx = this.agentIndex.get(id);
    const agent = this.agents.get(id);
    if (idx === undefined || !agent) return;
    this.dummy.position.set(agent.grid_x * CELL + CELL / 2, CELL * 1.0, agent.grid_y * CELL + CELL / 2);
    this.dummy.scale.setScalar(1.25);
    this.dummy.updateMatrix();
    this.agentMesh.setMatrixAt(idx, this.dummy.matrix);
    this.agentMesh.instanceMatrix.needsUpdate = true;
    setTimeout(() => this.upsertAgent(agent), 180);
  }

  private flashConflictArena(): void {
    const cx = WORLD_SIZE / 2;
    const cy = WORLD_SIZE / 2;
    if (!this.conflictRing) {
      this.conflictRing = new THREE.Mesh(
        new THREE.RingGeometry(1.5, 3.5, 32),
        new THREE.MeshBasicMaterial({ color: 0xff5252, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
      );
      this.conflictRing.rotation.x = -Math.PI / 2;
      this.scene.add(this.conflictRing);
    }
    this.conflictRing.position.set(cx * CELL, 0.25, cy * CELL);
    this.conflictRing.visible = true;
    setTimeout(() => {
      if (this.conflictRing) this.conflictRing.visible = this.layers.conflictArena;
    }, 1200);
  }

  private flashSky(color: number): void {
    const prev = this.renderer.getClearColor(new THREE.Color());
    this.renderer.setClearColor(color);
    setTimeout(() => this.renderer.setClearColor(prev), 350);
  }

  private updateCamera(): void {
    const cx = WORLD_EXTENT / 2 + this.panX;
    const cz = WORLD_EXTENT / 2 + this.panZ;
    this.camera.position.set(cx + 22, 38, cz + 22);
    this.camera.lookAt(cx, 0, cz);
    const base = 28 / this.zoom;
    this.camera.left = -base * this.aspect;
    this.camera.right = base * this.aspect;
    this.camera.top = base;
    this.camera.bottom = -base;
    this.camera.updateProjectionMatrix();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.zoom = Math.max(0.5, Math.min(3.5, this.zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
    this.updateCamera();
  }

  private onPointerDown(e: PointerEvent, canvas: HTMLCanvasElement): void {
    if (e.button === 1 || e.button === 2 || e.shiftKey) {
      this.dragging = true;
      this.dragStart = { x: e.clientX, y: e.clientY, panX: this.panX, panZ: this.panZ };
      canvas.setPointerCapture(e.pointerId);
    }
  }

  private onPointerMove(e: PointerEvent, _canvas: HTMLCanvasElement): void {
    if (!this.dragging) return;
    const dx = (e.clientX - this.dragStart.x) * 0.04 / this.zoom;
    const dy = (e.clientY - this.dragStart.y) * 0.04 / this.zoom;
    this.panX = this.dragStart.panX - dx;
    this.panZ = this.dragStart.panZ - dy;
    this.updateCamera();
  }

  private onClick(e: MouseEvent, canvas: HTMLCanvasElement): void {
    if (this.dragging) return;
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObject(this.agentMesh);
    if (hits.length && hits[0].instanceId !== undefined) {
      const idx = hits[0].instanceId;
      for (const [id, slot] of this.agentIndex) {
        if (slot === idx) {
          this.onAgentSelect?.(this.agents.get(id) ?? null);
          return;
        }
      }
    }
    this.onAgentSelect?.(null);
  }

  private onResize(canvas: HTMLCanvasElement): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    this.renderer.setSize(w, h);
    this.aspect = w / h;
    const base = 28 / this.zoom;
    this.camera.left = -base * this.aspect;
    this.camera.right = base * this.aspect;
    this.camera.top = base;
    this.camera.bottom = -base;
    this.camera.updateProjectionMatrix();
  }
}