import * as THREE from "three";

export class ParticleEffects {
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  birthBurst(position: THREE.Vector3): void {
    this.burst(position, 0x60ff80, 30);
  }

  deathBurst(position: THREE.Vector3): void {
    this.burst(position, 0xff4060, 25);
  }

  auditorAura(center: THREE.Vector3): void {
    const geo = new THREE.RingGeometry(2, 8, 32);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff2020,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(center);
    ring.position.y = 0.2;
    this.scene.add(ring);

    let t = 0;
    const animate = () => {
      t += 0.03;
      ring.scale.setScalar(1 + t * 0.5);
      mat.opacity = 0.3 * (1 - t);
      if (t < 1) requestAnimationFrame(animate);
      else {
        this.scene.remove(ring);
        geo.dispose();
        mat.dispose();
      }
    };
    animate();
  }

  private burst(position: THREE.Vector3, color: number, count: number): void {
    const positions = new Float32Array(count * 3);
    const velocities: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = position.x;
      positions[i * 3 + 1] = position.y + 1;
      positions[i * 3 + 2] = position.z;
      velocities.push(
        new THREE.Vector3(
          (Math.random() - 0.5) * 3,
          Math.random() * 4,
          (Math.random() - 0.5) * 3
        )
      );
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color, size: 0.2, transparent: true });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);

    let frame = 0;
    const animate = () => {
      frame++;
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < count; i++) {
        pos.setX(i, pos.getX(i) + velocities[i].x * 0.02);
        pos.setY(i, pos.getY(i) + velocities[i].y * 0.02);
        pos.setZ(i, pos.getZ(i) + velocities[i].z * 0.02);
        velocities[i].y -= 0.05;
      }
      pos.needsUpdate = true;
      mat.opacity = 1 - frame / 40;
      if (frame < 40) requestAnimationFrame(animate);
      else {
        this.scene.remove(points);
        geo.dispose();
        mat.dispose();
      }
    };
    animate();
  }
}