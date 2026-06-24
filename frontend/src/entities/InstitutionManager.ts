import * as THREE from "three";
import type { Institution } from "../types";

export class InstitutionManager {
  private scene: THREE.Scene;
  private structures = new Map<string, THREE.Group>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  build(inst: Institution, animate = true): void {
    if (this.structures.has(inst.id)) return;

    const group = new THREE.Group();
    const [x, , z] = inst.position;
    group.position.set(x, 0, z);

    const floorMat = new THREE.MeshLambertMaterial({ color: 0x4a4060 });
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x6a5a80 });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x8a7090 });

    const floor = new THREE.Mesh(new THREE.BoxGeometry(6, 0.3, 6), floorMat);
    floor.position.y = 0.15;
    group.add(floor);

    const pillars = [
      [-2.5, 2.5], [2.5, 2.5], [-2.5, -2.5], [2.5, -2.5],
    ];
    for (const [px, pz] of pillars) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 3, 0.6), wallMat);
      pillar.position.set(px, 1.5, pz);
      group.add(pillar);
    }

    const roof = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.4, 6.5), roofMat);
    roof.position.y = 3.2;
    group.add(roof);

    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(3, 0.5, 0.2),
      new THREE.MeshBasicMaterial({ color: 0xf0c060 })
    );
    sign.position.set(0, 3.8, 3.1);
    group.add(sign);

    group.userData = { institution: inst };

    if (animate) {
      group.scale.set(0.01, 0.01, 0.01);
      this.animateBuild(group);
    }

    this.scene.add(group);
    this.structures.set(inst.id, group);
  }

  dissolve(institutionId: string): void {
    const group = this.structures.get(institutionId);
    if (!group) return;
    this.animateDissolve(group, () => {
      this.scene.remove(group);
      group.traverse((c) => {
        if (c instanceof THREE.Mesh) {
          c.geometry.dispose();
          (c.material as THREE.Material).dispose();
        }
      });
      this.structures.delete(institutionId);
    });
  }

  setVisible(visible: boolean): void {
    this.structures.forEach((g) => (g.visible = visible));
  }

  getAtPosition(point: THREE.Vector3): Institution | null {
    for (const group of this.structures.values()) {
      const inst = group.userData.institution as Institution;
      const dx = point.x - group.position.x;
      const dz = point.z - group.position.z;
      if (Math.abs(dx) < 4 && Math.abs(dz) < 4) return inst;
    }
    return null;
  }

  private animateBuild(group: THREE.Group): void {
    let t = 0;
    const animate = () => {
      t += 0.04;
      const s = Math.min(t, 1);
      group.scale.set(s, s, s);
      if (t < 1) requestAnimationFrame(animate);
    };
    animate();
  }

  private animateDissolve(group: THREE.Group, onDone: () => void): void {
    let t = 1;
    const animate = () => {
      t -= 0.05;
      group.scale.set(t, t, t);
      if (t > 0) requestAnimationFrame(animate);
      else onDone();
    };
    animate();
  }
}