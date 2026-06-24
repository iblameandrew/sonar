import * as THREE from "three";
import type { DependencyEntry, LayerVisibility } from "../types";
import { KIND_COLORS, STRENGTH_SCALE } from "../types";

interface ConnectionRecord {
  key: string;
  mesh: THREE.Mesh;
  entry: DependencyEntry;
  particles: THREE.Points | null;
}

export class ConnectionManager {
  private scene: THREE.Scene;
  private connections = new Map<string, ConnectionRecord>();
  private agentPositions: Map<string, THREE.Vector3>;
  private visibleKinds = new Set(Object.keys(KIND_COLORS));

  constructor(scene: THREE.Scene, agentPositions: Map<string, THREE.Vector3>) {
    this.scene = scene;
    this.agentPositions = agentPositions;
  }

  add(entry: DependencyEntry, animate = true): void {
    const key = `${entry.from_id}->${entry.to_id}@${entry.tick}`;
    if (this.connections.has(key)) return;

    const from = this.agentPositions.get(entry.from_id);
    const to = this.agentPositions.get(entry.to_id);
    if (!from || !to) return;

    const color = KIND_COLORS[entry.kind] ?? 0xffffff;
    const thickness = STRENGTH_SCALE[entry.strength] ?? 0.1;
    if (thickness <= 0) return;

    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
    mid.y += 1;

    const geo = new THREE.BoxGeometry(thickness, thickness, len);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.5 + thickness,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(mid);
    mesh.lookAt(to.clone().setY(mid.y));
    mesh.rotateX(Math.PI / 2);

    if (animate) {
      mesh.scale.set(0.01, 0.01, 0.01);
      this.animateScale(mesh, thickness, len);
    }

    const speed = entry.qualitative_distance === "near" ? 2 : entry.qualitative_distance === "mid" ? 1 : 0.5;
    const particles = this.createParticles(from, to, color, speed);

    this.scene.add(mesh);
    if (particles) this.scene.add(particles);

    this.connections.set(key, { key, mesh, entry, particles });
  }

  removeByAgent(agentId: string): void {
    for (const [key, rec] of this.connections) {
      if (rec.entry.from_id === agentId || rec.entry.to_id === agentId) {
        this.disposeConnection(rec);
        this.connections.delete(key);
      }
    }
  }

  updatePositions(): void {
    for (const rec of this.connections.values()) {
      const from = this.agentPositions.get(rec.entry.from_id);
      const to = this.agentPositions.get(rec.entry.to_id);
      if (!from || !to) continue;

      const dir = new THREE.Vector3().subVectors(to, from);
      const len = dir.length();
      const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
      mid.y += 1;
      rec.mesh.position.copy(mid);
      rec.mesh.lookAt(to.clone().setY(mid.y));
      rec.mesh.rotateX(Math.PI / 2);
      rec.mesh.scale.z = len;
    }
  }

  setLayerVisibility(layers: LayerVisibility): void {
    const show = layers.connections;
    for (const rec of this.connections.values()) {
      const kindVisible = this.visibleKinds.has(rec.entry.kind);
      rec.mesh.visible = show && kindVisible;
      if (rec.particles) rec.particles.visible = show && kindVisible;
    }
  }

  toggleKind(kind: string, visible: boolean): void {
    if (visible) this.visibleKinds.add(kind);
    else this.visibleKinds.delete(kind);
    for (const rec of this.connections.values()) {
      if (rec.entry.kind === kind) {
        rec.mesh.visible = visible;
        if (rec.particles) rec.particles.visible = visible;
      }
    }
  }

  pulseForward(fromId: string): void {
    for (const rec of this.connections.values()) {
      if (rec.entry.from_id === fromId) {
        (rec.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
        setTimeout(() => {
          (rec.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7;
        }, 400);
      }
    }
  }

  pulseBackward(toId: string): void {
    for (const rec of this.connections.values()) {
      if (rec.entry.to_id === toId && rec.particles) {
        rec.particles.visible = true;
        setTimeout(() => {
          if (rec.particles) rec.particles.visible = true;
        }, 800);
      }
    }
  }

  private animateScale(mesh: THREE.Mesh, thickness: number, len: number): void {
    let t = 0;
    const animate = () => {
      t += 0.06;
      const s = Math.min(t, 1);
      mesh.scale.set(thickness / s * s || thickness, thickness, len * s);
      if (t < 1) requestAnimationFrame(animate);
      else mesh.scale.set(1, 1, len);
    };
    animate();
  }

  private createParticles(
    from: THREE.Vector3,
    to: THREE.Vector3,
    color: number,
    speed: number
  ): THREE.Points | null {
    const count = Math.floor(4 * speed);
    if (count < 2) return null;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const t = i / count;
      positions[i * 3] = from.x + (to.x - from.x) * t;
      positions[i * 3 + 1] = from.y + 1.5 + (to.y - from.y) * t;
      positions[i * 3 + 2] = from.z + (to.z - from.z) * t;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color, size: 0.15, transparent: true, opacity: 0.8 });
    return new THREE.Points(geo, mat);
  }

  private disposeConnection(rec: ConnectionRecord): void {
    this.scene.remove(rec.mesh);
    rec.mesh.geometry.dispose();
    (rec.mesh.material as THREE.Material).dispose();
    if (rec.particles) {
      this.scene.remove(rec.particles);
      rec.particles.geometry.dispose();
      (rec.particles.material as THREE.Material).dispose();
    }
  }
}