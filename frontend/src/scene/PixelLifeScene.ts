import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Agent, DependencyEntry, LayerVisibility, SimEvent } from "../types";
import { KIND_COLORS, ROLE_COLORS, STRENGTH_SCALE } from "../types";

const GRID_W = 40;
const GRID_H = 28;
const CELL = 0.5;

const ECO_COLORS = {
  grass: 0x5dbb63,
  grassBright: 0x7fd87f,
  dirt: 0x8b6914,
  water: 0x4fc3f7,
  moss: 0x3ddc84,
  mossGlow: 0x66ffaa,
  wood: 0x8d6e63,
  leaves: 0x43a047,
  sky: 0x87ceeb,
};

interface AgentVisual {
  group: THREE.Group;
  glow: THREE.PointLight;
  halo: THREE.Sprite;
  pulse: number;
}

export class PixelLifeScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  private lifeGrid: Uint8Array;
  private lifeMeshes: THREE.InstancedMesh;
  private lifeColors: Float32Array;
  private groundMesh: THREE.Mesh;
  private agentVisuals = new Map<string, AgentVisual>();
  private connectionLines: THREE.Line[] = [];
  private voxforgeMeshes: THREE.Mesh[] = [];
  private debateParticles: THREE.Points[] = [];
  private agents = new Map<string, Agent>();
  private trees: THREE.Group[] = [];
  private waterMesh: THREE.Mesh;
  private conflictRing: THREE.Mesh | null = null;
  private clock = new THREE.Clock();
  layers: LayerVisibility;
  onAgentSelect: ((agent: Agent | null) => void) | null = null;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private lifeTick = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.setClearColor(0x87ceeb, 1);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xb8e6f5, 35, 90);

    this.camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 200);
    this.camera.position.set(GRID_W * CELL * 0.5, 22, GRID_H * CELL * 1.2);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(GRID_W * CELL * 0.4, 0, GRID_H * CELL * 0.45);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2.2;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 55;

    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x5dbb63, 1.4);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff8e1, 1.6);
    sun.position.set(20, 40, 15);
    this.scene.add(sun);

    const groundGeo = new THREE.BoxGeometry(GRID_W * CELL + 2, 0.4, GRID_H * CELL + 2);
    const groundMat = new THREE.MeshStandardMaterial({ color: ECO_COLORS.dirt, roughness: 0.9 });
    this.groundMesh = new THREE.Mesh(groundGeo, groundMat);
    this.groundMesh.position.set((GRID_W * CELL) / 2, -0.25, (GRID_H * CELL) / 2);
    this.scene.add(this.groundMesh);

    const grassGeo = new THREE.BoxGeometry(GRID_W * CELL + 2, 0.15, GRID_H * CELL + 2);
    const grassMat = new THREE.MeshStandardMaterial({
      color: ECO_COLORS.grass,
      emissive: ECO_COLORS.grassBright,
      emissiveIntensity: 0.08,
      roughness: 0.85,
    });
    const grass = new THREE.Mesh(grassGeo, grassMat);
    grass.position.set((GRID_W * CELL) / 2, 0.05, (GRID_H * CELL) / 2);
    this.scene.add(grass);

    const waterGeo = new THREE.BoxGeometry(8 * CELL, 0.2, 6 * CELL);
    const waterMat = new THREE.MeshStandardMaterial({
      color: ECO_COLORS.water,
      emissive: 0x29b6f6,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.85,
      roughness: 0.1,
      metalness: 0.3,
    });
    this.waterMesh = new THREE.Mesh(waterGeo, waterMat);
    this.waterMesh.position.set(6 * CELL, 0.12, 4 * CELL);
    this.scene.add(this.waterMesh);

    this.lifeGrid = new Uint8Array(GRID_W * GRID_H);
    this.seedLifeGrid();
    this.seedTrees();

    const blockGeo = new THREE.BoxGeometry(CELL * 0.88, CELL * 0.88, CELL * 0.88);
    const blockMat = new THREE.MeshStandardMaterial({
      color: ECO_COLORS.moss,
      emissive: ECO_COLORS.mossGlow,
      emissiveIntensity: 0.4,
      roughness: 0.6,
      vertexColors: true,
    });
    this.lifeMeshes = new THREE.InstancedMesh(blockGeo, blockMat, GRID_W * GRID_H);
    this.lifeMeshes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.lifeColors = new Float32Array(GRID_W * GRID_H * 3);
    this.lifeMeshes.instanceColor = new THREE.InstancedBufferAttribute(this.lifeColors, 3);
    this.updateLifeMesh();
    this.scene.add(this.lifeMeshes);

    this.layers = {
      lifeGrid: true, agents: true, connections: true, negotiations: true,
      institutions: true, voxforge: true, conflictArena: true, metrics: true,
      birthDeath: true, attention: true, auditor: true, reformer: true,
      confessor: true, messenger: true,
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
      case "voxforge_voxel":
        if (this.layers.voxforge) this.placeVoxForgeVoxel(p as { x: number; y: number; color: string });
        break;
      case "agent_birth":
        if (this.layers.birthDeath) this.upsertAgent({
          id: p.child_id as string, name: "Spawnling", role: "generalist",
          verbs: p.verbs as string[], nouns: p.nouns as string[],
          adjectives: p.adjectives as string[], parent_ids: [],
          institution_id: null,
          grid_x: (p.grid_x as number) ?? 10, grid_y: (p.grid_y as number) ?? 10,
          current_task_id: null,
        });
        break;
      case "agent_death":
        if (this.layers.birthDeath) this.removeAgent(p.agent_id as string);
        break;
      case "phase_change":
        this.flashSky(0xe1f5fe);
        break;
    }
  }

  loadAgents(agents: Agent[]): void { for (const a of agents) this.upsertAgent(a); }
  loadVoxForge(voxels: { x: number; y: number; color: string }[]): void {
    for (const v of voxels) this.placeVoxForgeVoxel(v);
  }

  upsertAgent(agent: Agent): void {
    this.agents.set(agent.id, agent);
    let vis = this.agentVisuals.get(agent.id);
    const color = ROLE_COLORS[agent.role] ?? 0x4dd0e1;

    if (!vis) {
      const group = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 0.45, roughness: 0.5,
      });
      const headMat = bodyMat.clone();
      headMat.emissiveIntensity = 0.6;

      const body = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.9, CELL * 1.1, CELL * 0.7), bodyMat);
      body.position.y = CELL * 0.75;
      const head = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.75, CELL * 0.75, CELL * 0.75), headMat);
      head.position.y = CELL * 1.6;

      const glow = new THREE.PointLight(color, 1.2, 4);
      glow.position.y = CELL * 1.2;

      const haloTex = this.makeGlowTexture(color);
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: haloTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      halo.scale.set(2.5, 2.5, 1);
      halo.position.y = CELL * 1.5;

      group.add(body, head, halo);
      this.scene.add(group, glow);
      vis = { group, glow, halo, pulse: Math.random() * Math.PI * 2 };
      this.agentVisuals.set(agent.id, vis);
    }

    vis.group.position.set(agent.grid_x * CELL, 0, agent.grid_y * CELL);
    vis.glow.position.set(agent.grid_x * CELL, CELL * 1.2, agent.grid_y * CELL);
  }

  removeAgent(id: string): void {
    const vis = this.agentVisuals.get(id);
    if (vis) {
      this.scene.remove(vis.group, vis.glow);
      vis.group.traverse((c) => {
        if (c instanceof THREE.Mesh) {
          c.geometry.dispose();
          (c.material as THREE.Material).dispose();
        }
      });
      (vis.halo.material as THREE.Material).dispose();
    }
    this.agentVisuals.delete(id);
    this.agents.delete(id);
  }

  applyLayers(): void {
    this.lifeMeshes.visible = this.layers.lifeGrid;
    this.agentVisuals.forEach((v) => { v.group.visible = this.layers.agents; v.glow.visible = this.layers.agents; });
    this.connectionLines.forEach((l) => (l.visible = this.layers.connections));
    this.voxforgeMeshes.forEach((m) => (m.visible = this.layers.voxforge));
    this.debateParticles.forEach((p) => (p.visible = this.layers.negotiations));
    if (this.conflictRing) this.conflictRing.visible = this.layers.conflictArena;
  }

  render(): void {
    const t = this.clock.getElapsedTime();
    this.controls.update();

    this.lifeTick++;
    if (this.lifeTick % 10 === 0 && this.layers.lifeGrid) {
      this.stepConway();
      this.updateLifeMesh();
    }

    const blockMat = this.lifeMeshes.material as THREE.MeshStandardMaterial;
    blockMat.emissiveIntensity = 0.35 + Math.sin(t * 2) * 0.12;

    this.waterMesh.position.y = 0.12 + Math.sin(t * 1.5) * 0.03;
    (this.waterMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + Math.sin(t * 2) * 0.15;

    for (const [, vis] of this.agentVisuals) {
      const pulse = 0.8 + Math.sin(t * 3 + vis.pulse) * 0.35;
      vis.glow.intensity = pulse * 1.4;
      vis.halo.material.opacity = 0.35 + Math.sin(t * 2.5 + vis.pulse) * 0.2;
      vis.halo.scale.setScalar(2.2 + Math.sin(t * 2 + vis.pulse) * 0.4);
    }

    for (const mesh of this.voxforgeMeshes) {
      const m = mesh.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 0.5 + Math.sin(t * 4 + mesh.position.x) * 0.3;
    }

    this.renderer.render(this.scene, this.camera);
  }

  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  private makeGlowTexture(color: number): THREE.Texture {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const c = new THREE.Color(color);
    const r = Math.floor(c.r * 255), g = Math.floor(c.g * 255), b = Math.floor(c.b * 255);
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, `rgba(${r},${g},${b},0.9)`);
    grad.addColorStop(0.4, `rgba(${r},${g},${b},0.3)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }

  private seedTrees(): void {
    const positions = [[3, 20], [8, 22], [15, 24], [5, 18], [22, 6], [18, 10]];
    for (const [x, y] of positions) {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.BoxGeometry(CELL * 0.5, CELL * 1.5, CELL * 0.5),
        new THREE.MeshStandardMaterial({ color: ECO_COLORS.wood, roughness: 0.9 })
      );
      trunk.position.y = CELL * 0.9;
      const foliage = new THREE.Mesh(
        new THREE.BoxGeometry(CELL * 1.4, CELL * 1.2, CELL * 1.4),
        new THREE.MeshStandardMaterial({
          color: ECO_COLORS.leaves, emissive: 0x66bb6a, emissiveIntensity: 0.15, roughness: 0.8,
        })
      );
      foliage.position.y = CELL * 2.2;
      tree.add(trunk, foliage);
      tree.position.set(x * CELL, 0, y * CELL);
      this.scene.add(tree);
      this.trees.push(tree);
    }
  }

  private seedLifeGrid(): void {
    for (let i = 0; i < GRID_W * GRID_H; i++) this.lifeGrid[i] = Math.random() < 0.22 ? 1 : 0;
    for (let x = 28; x < GRID_W; x++)
      for (let y = 0; y < GRID_H; y++) this.lifeGrid[y * GRID_W + x] = 0;
    for (let x = 4; x < 12; x++)
      for (let y = 2; y < 8; y++) this.lifeGrid[y * GRID_W + x] = 0;
  }

  private stepConway(): void {
    const next = new Uint8Array(GRID_W * GRID_H);
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        if (x >= 28 || (x >= 4 && x < 12 && y >= 2 && y < 8)) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            n += this.lifeGrid[((y + dy + GRID_H) % GRID_H) * GRID_W + ((x + dx + GRID_W) % GRID_W)];
          }
        const alive = this.lifeGrid[y * GRID_W + x];
        next[y * GRID_W + x] = alive ? (n === 2 || n === 3 ? 1 : 0) : n === 3 ? 1 : 0;
      }
    }
    this.lifeGrid = next;
  }

  private updateLifeMesh(): void {
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    let i = 0;
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const alive = this.lifeGrid[y * GRID_W + x] && x < 28;
        if (alive) {
          dummy.position.set(x * CELL, CELL * 0.55, y * CELL);
          dummy.scale.set(1, 1, 1);
          col.setHex(ECO_COLORS.mossGlow);
        } else {
          dummy.position.set(x * CELL, -2, y * CELL);
          dummy.scale.set(0.001, 0.001, 0.001);
          col.setHex(ECO_COLORS.moss);
        }
        dummy.updateMatrix();
        this.lifeMeshes.setMatrixAt(i, dummy.matrix);
        this.lifeMeshes.setColorAt(i, col);
        i++;
      }
    }
    this.lifeMeshes.instanceMatrix.needsUpdate = true;
    if (this.lifeMeshes.instanceColor) this.lifeMeshes.instanceColor.needsUpdate = true;
  }

  private addConnection(entry: DependencyEntry): void {
    const from = this.agents.get(entry.from_id);
    const to = this.agents.get(entry.to_id);
    if (!from || !to) return;
    const thickness = STRENGTH_SCALE[entry.strength] ?? 0.1;
    if (thickness <= 0) return;
    const color = KIND_COLORS[entry.kind] ?? 0xffffff;
    const points = [
      new THREE.Vector3(from.grid_x * CELL, 1.8, from.grid_y * CELL),
      new THREE.Vector3(to.grid_x * CELL, 1.8, to.grid_y * CELL),
    ];
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color, linewidth: 2, transparent: true, opacity: 0.85 })
    );
    this.scene.add(line);
    this.connectionLines.push(line);
    if (this.connectionLines.length > 150) {
      const old = this.connectionLines.shift()!;
      this.scene.remove(old);
      old.geometry.dispose();
      (old.material as THREE.Material).dispose();
    }
  }

  private placeVoxForgeVoxel(v: { x: number; y: number; color: string }): void {
    const col = new THREE.Color(v.color);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(CELL * 0.95, CELL * 1.2, CELL * 0.95),
      new THREE.MeshStandardMaterial({
        color: col, emissive: col, emissiveIntensity: 0.55, roughness: 0.4, metalness: 0.2,
      })
    );
    mesh.position.set(v.x * CELL, CELL * 0.8, v.y * CELL);
    this.scene.add(mesh);
    this.voxforgeMeshes.push(mesh);
  }

  private showDebate(fromId: string, toId: string): void {
    const from = this.agents.get(fromId);
    const to = this.agents.get(toId);
    if (!from || !to) return;
    const positions = new Float32Array(15);
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      positions[i * 3] = from.grid_x * CELL + (to.grid_x - from.grid_x) * CELL * t;
      positions[i * 3 + 1] = 2 + Math.sin(t * Math.PI) * 1.5;
      positions[i * 3 + 2] = from.grid_y * CELL + (to.grid_y - from.grid_y) * CELL * t;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xffeb3b, size: 0.35, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.scene.add(pts);
    this.debateParticles.push(pts);
    setTimeout(() => { this.scene.remove(pts); geo.dispose(); (pts.material as THREE.Material).dispose(); }, 2500);
  }

  private pulseAgent(id: string): void {
    const vis = this.agentVisuals.get(id);
    if (!vis) return;
    vis.glow.intensity = 3;
    setTimeout(() => { vis.glow.intensity = 1.2; }, 200);
  }

  private flashConflictArena(): void {
    if (!this.conflictRing) {
      this.conflictRing = new THREE.Mesh(
        new THREE.RingGeometry(2, 4, 32),
        new THREE.MeshBasicMaterial({ color: 0xff5252, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
      );
      this.conflictRing.rotation.x = -Math.PI / 2;
      this.conflictRing.position.set(14 * CELL, 0.3, 12 * CELL);
      this.scene.add(this.conflictRing);
    }
    this.conflictRing.visible = true;
    setTimeout(() => { if (this.conflictRing) this.conflictRing.visible = this.layers.conflictArena; }, 1200);
  }

  private flashSky(color: number): void {
    const prev = this.renderer.getClearColor(new THREE.Color());
    this.renderer.setClearColor(color);
    setTimeout(() => this.renderer.setClearColor(prev), 350);
  }

  private onClick(e: MouseEvent, canvas: HTMLCanvasElement): void {
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const groups = [...this.agentVisuals.values()].map((v) => v.group);
    const hits = this.raycaster.intersectObjects(groups, true);
    if (hits.length) {
      for (const [id, vis] of this.agentVisuals) {
        if (vis.group === hits[0].object.parent || vis.group === hits[0].object) {
          this.onAgentSelect?.(this.agents.get(id) ?? null);
          return;
        }
      }
    }
    this.onAgentSelect?.(null);
  }

  private onResize(canvas: HTMLCanvasElement): void {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
}