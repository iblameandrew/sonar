import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { Agent, DependencyEntry, Institution, LayerVisibility, SimEvent } from "../types";
import { SEASON_PALETTES } from "../encoding/maps";
import { AgentManager } from "../entities/AgentManager";
import { ConnectionManager } from "../entities/ConnectionManager";
import { InstitutionManager } from "../entities/InstitutionManager";
import { ParticleEffects } from "../effects/Particles";

export class VoxelScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  agentManager: AgentManager;
  connectionManager: ConnectionManager;
  institutionManager: InstitutionManager;
  particles: ParticleEffects;
  layers: LayerVisibility;
  private ground: THREE.Mesh;
  private ambient: THREE.AmbientLight;
  private raptorMonolith: THREE.Mesh | null = null;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  onAgentSelect: ((agent: Agent | null) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.shadowMap.enabled = true;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x1a1a2a, 20, 80);

    this.camera = new THREE.PerspectiveCamera(
      50,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      200
    );
    this.camera.position.set(15, 18, 20);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2.1;

    this.ambient = new THREE.AmbientLight(0x888899, 0.6);
    this.scene.add(this.ambient);
    const sun = new THREE.DirectionalLight(0xfff0d0, 1.0);
    sun.position.set(10, 20, 10);
    sun.castShadow = true;
    this.scene.add(sun);

    const groundGeo = new THREE.PlaneGeometry(120, 120, 30, 30);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x2a3040 });
    this.ground = new THREE.Mesh(groundGeo, groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    const grid = new THREE.GridHelper(120, 60, 0x3a3a5a, 0x2a2a3a);
    this.scene.add(grid);

    this.agentManager = new AgentManager(this.scene);
    this.connectionManager = new ConnectionManager(
      this.scene,
      this.agentManager.getPositionsMap()
    );
    this.institutionManager = new InstitutionManager(this.scene);
    this.particles = new ParticleEffects(this.scene);

    this.layers = {
      agents: true,
      connections: true,
      institutions: true,
      birthDeath: true,
      attention: true,
      auditor: true,
      reformer: true,
      confessor: true,
      messenger: true,
      raptor: true,
      minimap: false,
      labels: true,
    };

    canvas.addEventListener("click", (e) => this.onClick(e, canvas));
    window.addEventListener("resize", () => this.onResize(canvas));
  }

  handleEvent(event: SimEvent): void {
    const p = event.payload;

    switch (event.type) {
      case "attention_judgment":
        if (this.layers.attention) {
          const entry = p as unknown as DependencyEntry;
          this.connectionManager.add(entry);
          this.agentManager.flashAttention(entry.from_id, entry.to_id);
        }
        break;

      case "messenger_perform":
        if (this.layers.messenger) {
          this.agentManager.upsert({
            id: p.agent_id as string,
            verbs: p.verbs as string[],
            nouns: p.nouns as string[],
            adjectives: p.adjectives as string[],
            parent_ids: [],
            institution_id: null,
            position: this.agentManager.getAgent(p.agent_id as string)?.position ?? [0, 0, 0],
          });
          this.connectionManager.pulseForward(p.agent_id as string);
        }
        break;

      case "auditor_regret":
        if (this.layers.auditor) {
          const center = this.societyCenter();
          this.particles.auditorAura(center);
        }
        break;

      case "reformer_update":
        if (this.layers.reformer) {
          this.agentManager.rippleReform(p.agent_id as string);
        }
        break;

      case "confessor_flow":
        if (this.layers.confessor) {
          this.connectionManager.pulseBackward(p.to_id as string);
        }
        break;

      case "agent_birth":
        if (this.layers.birthDeath) {
          const pos = new THREE.Vector3(...(p.position as [number, number, number]));
          this.particles.birthBurst(pos);
          this.agentManager.upsert({
            id: p.child_id as string,
            verbs: p.verbs as string[],
            nouns: p.nouns as string[],
            adjectives: p.adjectives as string[],
            parent_ids: [p.parent_id as string],
            institution_id: null,
            position: p.position as [number, number, number],
          });
        }
        break;

      case "agent_death":
        if (this.layers.birthDeath) {
          const pos = this.agentManager.getPosition(p.agent_id as string);
          if (pos) this.particles.deathBurst(pos);
          this.connectionManager.removeByAgent(p.agent_id as string);
          this.agentManager.remove(p.agent_id as string);
        }
        break;

      case "institution_formed":
        if (this.layers.institutions) {
          this.institutionManager.build(p as unknown as Institution);
        }
        break;

      case "institution_dissolved":
        if (this.layers.institutions) {
          this.institutionManager.dissolve(p.institution_id as string);
        }
        break;

      case "season_change":
        this.transitionSeason(
          (p.micro_season as string) || (p.macro_season as string)
        );
        break;

      case "raptor_node_created":
        if (this.layers.raptor) {
          this.updateRaptorMonolith();
        }
        break;
    }
  }

  loadSnapshot(agents: Agent[], institutions: Institution[], playbook: DependencyEntry[]): void {
    for (const agent of agents) {
      this.agentManager.upsert(agent);
    }
    for (const inst of institutions) {
      this.institutionManager.build(inst, false);
    }
    for (const entry of playbook) {
      this.connectionManager.add(entry, false);
    }
    this.connectionManager.updatePositions();
  }

  transitionSeason(season: string): void {
    const palette = SEASON_PALETTES[season] ?? SEASON_PALETTES.diffuse;
    const targetFog = new THREE.Color(palette.fog);
    const targetAmbient = new THREE.Color(palette.ambient);
    const targetGround = new THREE.Color(palette.ground);

    const startFog = (this.scene.fog as THREE.Fog).color.clone();
    const startAmbient = this.ambient.color.clone();
    const startGround = (this.ground.material as THREE.MeshLambertMaterial).color.clone();

    let t = 0;
    const animate = () => {
      t += 0.02;
      const s = Math.min(t, 1);
      (this.scene.fog as THREE.Fog).color.lerpColors(startFog, targetFog, s);
      this.ambient.color.lerpColors(startAmbient, targetAmbient, s);
      (this.ground.material as THREE.MeshLambertMaterial).color.lerpColors(
        startGround,
        targetGround,
        s
      );
      if (t < 1) requestAnimationFrame(animate);
    };
    animate();
  }

  applyLayers(): void {
    this.agentManager.setVisible(this.layers.agents);
    this.connectionManager.setLayerVisibility(this.layers);
    this.institutionManager.setVisible(this.layers.institutions);
    if (this.raptorMonolith) {
      this.raptorMonolith.visible = this.layers.raptor;
    }
  }

  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  exportGLTF(): void {
    const exporter = new GLTFExporter();
    exporter.parse(
      this.scene,
      (gltf) => {
        const blob = new Blob([JSON.stringify(gltf)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "attention-agent-society.gltf";
        a.click();
        URL.revokeObjectURL(url);
      },
      () => {},
      { binary: false }
    );
  }

  render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  getAgentPositions(): Map<string, THREE.Vector3> {
    const map = new Map<string, THREE.Vector3>();
    for (const agent of this.agentManager.getAllAgents()) {
      const pos = this.agentManager.getPosition(agent.id);
      if (pos) map.set(agent.id, pos.clone());
    }
    return map;
  }

  private societyCenter(): THREE.Vector3 {
    const agents = this.agentManager.getAllAgents();
    if (!agents.length) return new THREE.Vector3();
    const c = new THREE.Vector3();
    for (const a of agents) {
      const p = this.agentManager.getPosition(a.id);
      if (p) c.add(p);
    }
    c.divideScalar(agents.length);
    return c;
  }

  private updateRaptorMonolith(): void {
    if (this.raptorMonolith) {
      this.scene.remove(this.raptorMonolith);
      this.raptorMonolith.geometry.dispose();
      (this.raptorMonolith.material as THREE.Material).dispose();
    }
    const geo = new THREE.BoxGeometry(1.5, 12, 1.5);
    const mat = new THREE.MeshLambertMaterial({
      color: 0x4060a0,
      emissive: 0x102040,
    });
    this.raptorMonolith = new THREE.Mesh(geo, mat);
    this.raptorMonolith.position.set(-25, 6, -25);
    this.raptorMonolith.visible = this.layers.raptor;
    this.scene.add(this.raptorMonolith);
  }

  private onClick(e: MouseEvent, canvas: HTMLCanvasElement): void {
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const meshes: THREE.Object3D[] = [];
    for (const agent of this.agentManager.getAllAgents()) {
      const m = this.agentManager.getMesh(agent.id);
      if (m) meshes.push(m);
    }

    const hits = this.raycaster.intersectObjects(meshes, true);
    if (hits.length > 0) {
      let node: THREE.Object3D | null = hits[0].object;
      while (node) {
        for (const agent of this.agentManager.getAllAgents()) {
          if (this.agentManager.getMesh(agent.id) === node) {
            this.onAgentSelect?.(agent);
            return;
          }
        }
        node = node.parent;
      }
    }
    this.onAgentSelect?.(null);
  }

  private onResize(canvas: HTMLCanvasElement): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
}