import * as THREE from "three";

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private visible = false;

  constructor(canvasId: string) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    this.ctx = this.canvas.getContext("2d")!;
    this.canvas.width = 160;
    this.canvas.height = 160;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.canvas.classList.toggle("hidden", !v);
  }

  update(positions: Map<string, THREE.Vector3>, connections: { from: string; to: string; color: string }[]): void {
    if (!this.visible) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.fillStyle = "rgba(10,10,18,0.8)";
    ctx.fillRect(0, 0, w, h);

    const pts = [...positions.values()];
    if (!pts.length) return;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const rangeX = maxX - minX || 1;
    const rangeZ = maxZ - minZ || 1;
    const pad = 10;

    const toScreen = (p: THREE.Vector3) => ({
      x: pad + ((p.x - minX) / rangeX) * (w - 2 * pad),
      y: pad + ((p.z - minZ) / rangeZ) * (h - 2 * pad),
    });

    ctx.strokeStyle = "rgba(100,100,150,0.3)";
    ctx.lineWidth = 1;
    for (const conn of connections) {
      const from = positions.get(conn.from);
      const to = positions.get(conn.to);
      if (!from || !to) continue;
      const a = toScreen(from);
      const b = toScreen(to);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    for (const [id, pos] of positions) {
      const s = toScreen(pos);
      ctx.fillStyle = "#60c080";
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}