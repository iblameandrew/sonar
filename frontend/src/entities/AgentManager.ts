import * as THREE from "three";
import type { Agent } from "../types";
import { agentBaseColor, agentHeight, agentScale, getAccessories } from "../encoding/maps";

const BOX = new THREE.BoxGeometry(0.4, 0.4, 0.4);

export class AgentManager {
  private scene: THREE.Scene;
  private agents = new Map<string, Agent>();
  private meshes = new Map<string, THREE.Group>();
  private highlightMeshes = new Map<string, THREE.Mesh>();
  private positions = new Map<string, THREE.Vector3>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  upsert(agent: Agent): void {
    this.agents.set(agent.id, agent);
    let group = this.meshes.get(agent.id);
    if (!group) {
      group = this.buildAgentMesh(agent);
      this.meshes.set(agent.id, group);
      this.scene.add(group);
    } else {
      this.reconfigure(group, agent);
    }
    const pos = new THREE.Vector3(...agent.position);
    this.positions.set(agent.id, pos);
    group.position.copy(pos);
  }

  remove(id: string): void {
    const mesh = this.meshes.get(id);
    if (mesh) {
      this.scene.remove(mesh);
      mesh.traverse((c) => {
        if (c instanceof THREE.Mesh) {
          c.geometry.dispose();
          (c.material as THREE.Material).dispose();
        }
      });
    }
    this.meshes.delete(id);
    this.agents.delete(id);
    this.positions.delete(id);
    this.clearHighlight(id);
  }

  getPosition(id: string): THREE.Vector3 | undefined {
    return this.positions.get(id);
  }

  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  getAllAgents(): Agent[] {
    return [...this.agents.values()];
  }

  getMesh(id: string): THREE.Object3D | undefined {
    return this.meshes.get(id);
  }

  getPositionsMap(): Map<string, THREE.Vector3> {
    return this.positions;
  }

  flashAttention(fromId: string, toId: string): void {
    this.pulseHighlight(fromId, 0xf0c060);
    this.pulseHighlight(toId, 0xf0c060);
  }

  rippleReform(agentId: string): void {
    const mesh = this.meshes.get(agentId);
    if (!mesh) return;
    const startY = mesh.position.y;
    let t = 0;
    const animate = () => {
      t += 0.05;
      mesh.position.y = startY + Math.sin(t * Math.PI) * 0.5;
      if (t < 1) requestAnimationFrame(animate);
      else mesh.position.y = startY;
    };
    animate();
  }

  setVisible(visible: boolean): void {
    this.meshes.forEach((m) => (m.visible = visible));
  }

  private buildAgentMesh(agent: Agent): THREE.Group {
    const group = new THREE.Group();
    const color = agentBaseColor(agent);
    const h = agentHeight(agent);
    const scale = agentScale(agent);

    const bodyMat = new THREE.MeshLambertMaterial({ color });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5 * scale, h, 0.4 * scale), bodyMat);
    body.position.y = h / 2;
    group.add(body);

    const head = new THREE.Mesh(BOX, bodyMat);
    head.position.y = h + 0.25;
    head.scale.setScalar(0.7);
    group.add(head);

    for (const acc of getAccessories(agent)) {
      const block = new THREE.Mesh(
        BOX,
        new THREE.MeshLambertMaterial({ color: acc.color })
      );
      block.position.set(acc.offset[0], acc.offset[1] * h, acc.offset[2]);
      block.scale.setScalar(0.35);
      group.add(block);
    }

    return group;
  }

  private reconfigure(group: THREE.Group, agent: Agent): void {
    group.clear();
    const rebuilt = this.buildAgentMesh(agent);
    rebuilt.children.forEach((c) => group.add(c));
  }

  private pulseHighlight(id: string, color: number): void {
    const mesh = this.meshes.get(id);
    if (!mesh) return;
    this.clearHighlight(id);
    const glow = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 2.5, 1.2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4 })
    );
    glow.position.copy(mesh.position);
    glow.position.y += 0.5;
    this.scene.add(glow);
    this.highlightMeshes.set(id, glow);
    setTimeout(() => this.clearHighlight(id), 600);
  }

  private clearHighlight(id: string): void {
    const glow = this.highlightMeshes.get(id);
    if (glow) {
      this.scene.remove(glow);
      glow.geometry.dispose();
      (glow.material as THREE.Material).dispose();
      this.highlightMeshes.delete(id);
    }
  }
}