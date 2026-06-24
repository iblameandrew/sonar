import * as THREE from "three";
import type { Agent, DependencyEntry, LayerVisibility, SimEvent } from "../types";
import { KIND_COLORS, ROLE_COLORS, STRENGTH_SCALE } from "../types";

const GRID_W = 48;
const GRID_H = 32;
const CELL = 0.45;

export class PixelLifeScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  private lifeGrid: Uint8Array;
  private lifeMesh: THREE.InstancedMesh;
  private agentMeshes = new Map<string, THREE.Mesh>();
  private connectionLines: THREE.Line[] = [];
  private voxforgeMeshes: THREE.Mesh[] = [];
  private debateParticles: THREE.Points[] = [];
  private agents = new Map<string, Agent>();
  private conflictRing: THREE.Mesh | null = null;
  layers: LayerVisibility;
  onAgentSelect: ((agent: Agent | null) => void) | null = null;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private lifeTick = 0;

  constructor(canvas: HTMLCanvasElement) {
    const aspect = canvas.clientWidth / canvas.clientHeight;
    const viewH = GRID_H * CELL + 4;
    const viewW = viewH * aspect;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.setClearColor(0x0c0c18);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(
      -viewW / 2, viewW / 2, viewH / 2, -viewH / 2, 0.1, 100
    );
    this.camera.position.set(GRID_W * CELL / 2 - viewW / 2 + GRID_W * CELL / 2, 30, GRID_H * CELL / 2);
    this.camera.lookAt(GRID_W * CELL / 2, 0, GRID_H * CELL / 2);

    this.lifeGrid = new Uint8Array(GRID_W * GRID_H);
    this.seedLifeGrid();

    const geo = new THREE.BoxGeometry(CELL * 0.92, CELL * 0.15, CELL * 0.92);
    const mat = new THREE.MeshLambertMaterial({ color: 0x1a3a2a });
    this.lifeMesh = new THREE.InstancedMesh(geo, mat, GRID_W * GRID_H);
    this.lifeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.updateLifeMesh();
    this.scene.add(this.lifeMesh);

    const amb = new THREE.AmbientLight(0x808090, 1.2);
    this.scene.add(amb);

    this.layers = {
      lifeGrid: true,
      agents: true,
      connections: true,
      negotiations: true,
      institutions: true,
      voxforge: true,
      conflictArena: true,
      metrics: true,
      birthDeath: true,
      attention: true,
      auditor: true,
      reformer: true,
      confessor: true,
      messenger: true,
    };

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
        if (this.layers.messenger) {
          const agent = this.agents.get(p.agent_id as string);
          if (agent) this.pulseAgent(agent.id);
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
        if (this.layers.auditor) this.flashRegret();
        break;
      case "reformer_update":
        if (this.layers.reformer) this.pulseAgent(p.agent_id as string);
        break;
      case "task_decomposed":
        if (this.layers.agents) {
          const a = this.agents.get(p.assigned_to as string);
          if (a) this.pulseAgent(a.id);
        }
        break;
      case "voxforge_voxel":
        if (this.layers.voxforge) this.placeVoxForgeVoxel(p as { x: number; y: number; color: string });
        break;
      case "agent_birth":
        if (this.layers.birthDeath) this.upsertAgent({
          id: p.child_id as string,
          name: "New Agent",
          role: "generalist",
          verbs: p.verbs as string[],
          nouns: p.nouns as string[],
          adjectives: p.adjectives as string[],
          parent_ids: [],
          institution_id: null,
          grid_x: (p.grid_x as number) ?? 10,
          grid_y: (p.grid_y as number) ?? 10,
          current_task_id: null,
        });
        break;
      case "agent_death":
        if (this.layers.birthDeath) this.removeAgent(p.agent_id as string);
        break;
      case "phase_change":
        this.setPhasePalette((p.design_phase as string) || "concept");
        break;
    }
  }

  loadAgents(agents: Agent[]): void {
    for (const a of agents) this.upsertAgent(a);
  }

  loadVoxForge(voxels: { x: number; y: number; color: string }[]): void {
    for (const v of voxels) this.placeVoxForgeVoxel(v);
  }

  upsertAgent(agent: Agent): void {
    this.agents.set(agent.id, agent);
    let mesh = this.agentMeshes.get(agent.id);
    const color = ROLE_COLORS[agent.role] ?? 0x00ffcc;
    if (!mesh) {
      const geo = new THREE.BoxGeometry(CELL * 1.1, CELL * 0.8, CELL * 1.1);
      const mat = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.15 });
      mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = CELL * 0.5;
      this.scene.add(mesh);
      this.agentMeshes.set(agent.id, mesh);
    }
    mesh.position.x = agent.grid_x * CELL;
    mesh.position.z = agent.grid_y * CELL;
    (mesh.material as THREE.MeshLambertMaterial).color.setHex(color);
  }

  removeAgent(id: string): void {
    const mesh = this.agentMeshes.get(id);
    if (mesh) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.agentMeshes.delete(id);
    this.agents.delete(id);
  }

  applyLayers(): void {
    this.lifeMesh.visible = this.layers.lifeGrid;
    this.agentMeshes.forEach((m) => (m.visible = this.layers.agents));
    this.connectionLines.forEach((l) => (l.visible = this.layers.connections));
    this.voxforgeMeshes.forEach((m) => (m.visible = this.layers.voxforge));
    this.debateParticles.forEach((p) => (p.visible = this.layers.negotiations));
    if (this.conflictRing) this.conflictRing.visible = this.layers.conflictArena;
  }

  render(): void {
    this.lifeTick++;
    if (this.lifeTick % 8 === 0 && this.layers.lifeGrid) {
      this.stepConway();
      this.updateLifeMesh();
    }
    this.renderer.render(this.scene, this.camera);
  }

  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  private seedLifeGrid(): void {
    for (let i = 0; i < GRID_W * GRID_H; i++) {
      this.lifeGrid[i] = Math.random() < 0.18 ? 1 : 0;
    }
    for (let x = 28; x < GRID_W; x++)
      for (let y = 0; y < 12; y++) this.lifeGrid[y * GRID_W + x] = 0;
  }

  private stepConway(): void {
    const next = new Uint8Array(GRID_W * GRID_H);
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        if (x >= 28) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = (x + dx + GRID_W) % GRID_W;
            const ny = (y + dy + GRID_H) % GRID_H;
            if (nx >= 28) continue;
            n += this.lifeGrid[ny * GRID_W + nx];
          }
        const alive = this.lifeGrid[y * GRID_W + x];
        next[y * GRID_W + x] = alive ? (n === 2 || n === 3 ? 1 : 0) : n === 3 ? 1 : 0;
      }
    }
    this.lifeGrid = next;
  }

  private updateLifeMesh(): void {
    const dummy = new THREE.Object3D();
    let i = 0;
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        if (x >= 28) {
          dummy.position.set(x * CELL, -1, y * CELL);
          dummy.scale.set(0.001, 0.001, 0.001);
        } else {
          const alive = this.lifeGrid[y * GRID_W + x];
          dummy.position.set(x * CELL, alive ? 0.05 : -0.1, y * CELL);
          dummy.scale.set(1, alive ? 1 : 0.01, 1);
        }
        dummy.updateMatrix();
        this.lifeMesh.setMatrixAt(i++, dummy.matrix);
      }
    }
    this.lifeMesh.instanceMatrix.needsUpdate = true;
  }

  private addConnection(entry: DependencyEntry): void {
    const from = this.agents.get(entry.from_id);
    const to = this.agents.get(entry.to_id);
    if (!from || !to) return;
    const thickness = STRENGTH_SCALE[entry.strength] ?? 0.1;
    if (thickness <= 0) return;
    const color = KIND_COLORS[entry.kind] ?? 0xffffff;
    const points = [
      new THREE.Vector3(from.grid_x * CELL, 0.6, from.grid_y * CELL),
      new THREE.Vector3(to.grid_x * CELL, 0.6, to.grid_y * CELL),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color, linewidth: thickness * 10 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.connectionLines.push(line);
    if (this.connectionLines.length > 200) {
      const old = this.connectionLines.shift()!;
      this.scene.remove(old);
      old.geometry.dispose();
      (old.material as THREE.Material).dispose();
    }
  }

  private placeVoxForgeVoxel(v: { x: number; y: number; color: string }): void {
    const geo = new THREE.BoxGeometry(CELL, CELL * 1.5, CELL);
    const col = new THREE.Color(v.color);
    const mat = new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.3 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(v.x * CELL, CELL * 0.75, v.y * CELL);
    this.scene.add(mesh);
    this.voxforgeMeshes.push(mesh);
  }

  private showDebate(fromId: string, toId: string): void {
    const from = this.agents.get(fromId);
    const to = this.agents.get(toId);
    if (!from || !to) return;
    const positions = new Float32Array(12);
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      positions[i * 3] = from.grid_x * CELL + (to.grid_x - from.grid_x) * CELL * t;
      positions[i * 3 + 1] = 1.2 + Math.sin(i) * 0.3;
      positions[i * 3 + 2] = from.grid_y * CELL + (to.grid_y - from.grid_y) * CELL * t;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xff80ff, size: 0.25 }));
    this.scene.add(pts);
    this.debateParticles.push(pts);
    setTimeout(() => {
      this.scene.remove(pts);
      geo.dispose();
      (pts.material as THREE.Material).dispose();
    }, 2000);
  }

  private pulseAgent(id: string): void {
    const mesh = this.agentMeshes.get(id);
    if (!mesh) return;
    const base = mesh.scale.y;
    mesh.scale.y = base * 1.8;
    setTimeout(() => { mesh.scale.y = base; }, 300);
  }

  private flashConflictArena(): void {
    if (!this.conflictRing) {
      const geo = new THREE.RingGeometry(3, 5, 4);
      const mat = new THREE.MeshBasicMaterial({ color: 0xff2040, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
      this.conflictRing = new THREE.Mesh(geo, mat);
      this.conflictRing.rotation.x = -Math.PI / 2;
      this.conflictRing.position.set(14 * CELL, 0.2, 12 * CELL);
      this.scene.add(this.conflictRing);
    }
    if (this.conflictRing) {
      this.conflictRing.visible = true;
      setTimeout(() => { if (this.conflictRing) this.conflictRing.visible = this.layers.conflictArena; }, 1500);
    }
  }

  private flashRegret(): void {
    this.renderer.setClearColor(0x2a0810);
    setTimeout(() => this.renderer.setClearColor(0x0c0c18), 400);
  }

  private setPhasePalette(phase: string): void {
    const colors: Record<string, number> = {
      concept: 0x0c0c18,
      technical: 0x0a1020,
      polish: 0x100818,
      validation: 0x081018,
    };
    this.renderer.setClearColor(colors[phase] ?? 0x0c0c18);
  }

  private onClick(e: MouseEvent, canvas: HTMLCanvasElement): void {
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const meshes = [...this.agentMeshes.values()];
    const hits = this.raycaster.intersectObjects(meshes);
    if (hits.length) {
      for (const [id, mesh] of this.agentMeshes) {
        if (mesh === hits[0].object) {
          this.onAgentSelect?.(this.agents.get(id) ?? null);
          return;
        }
      }
    }
    this.onAgentSelect?.(null);
  }

  private onResize(canvas: HTMLCanvasElement): void {
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  }
}