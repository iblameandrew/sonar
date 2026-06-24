import type { Agent, ColonyInfo, ComparisonMetrics, NegotiationRound, ProjectCanvas, SimEvent } from "../types";
import type { ColonyScene } from "../scene/ColonyScene";

const MODELS = ["qwen-max", "qwen-plus", "qwen2.5-72b-instruct", "qwen2.5-coder-32b-instruct"];
const ROLES = [
  "auditor", "attention", "reformer", "confessor", "messenger",
  "decomposer", "negotiator", "conflict_resolver", "baseline",
  "voxel_architect", "orchestrator", "integrator",
];

export interface QwenStatus {
  provider: string;
  configured: boolean;
  api_key_masked: string;
  status_message: string;
  default_model: string;
  roles: Record<string, { model: string; temperature: number }>;
  usage: {
    total_calls: number;
    total_tokens: number;
    total_input_tokens: number;
    total_output_tokens: number;
  };
}

export class Dashboard {
  private metricsEl: HTMLElement;
  private negEl: HTMLElement;
  private taskEl: HTMLElement;
  private logEl: HTMLElement;
  private qwenStatusEl: HTMLElement;
  private qwenModelsEl: HTMLElement;
  private badgeEl: HTMLElement;
  private apiInput: HTMLInputElement;
  private colonyStatsEl: HTMLElement;
  private sectorEl: HTMLElement;
  private registryEl: HTMLElement;
  private movementEl: HTMLElement;
  private minimapCanvas: HTMLCanvasElement;
  private minimapCtx: CanvasRenderingContext2D;
  private agentCountInput: HTMLInputElement;

  constructor(private scene?: ColonyScene) {
    this.metricsEl = document.getElementById("metrics-content")!;
    this.negEl = document.getElementById("negotiation-log")!;
    this.taskEl = document.getElementById("task-tree")!;
    this.logEl = document.getElementById("log-content")!;
    this.qwenStatusEl = document.getElementById("qwen-status")!;
    this.qwenModelsEl = document.getElementById("qwen-models")!;
    this.badgeEl = document.getElementById("qwen-badge")!;
    this.apiInput = document.getElementById("api-key-input") as HTMLInputElement;
    this.colonyStatsEl = document.getElementById("colony-stats")!;
    this.sectorEl = document.getElementById("sector-stats")!;
    this.registryEl = document.getElementById("agent-registry")!;
    this.movementEl = document.getElementById("movement-log")!;
    this.minimapCanvas = document.getElementById("colony-minimap") as HTMLCanvasElement;
    this.minimapCtx = this.minimapCanvas.getContext("2d")!;
    this.agentCountInput = document.getElementById("agent-count") as HTMLInputElement;

    this.initTabs();
    this.initApiKey();
    this.initLayers();
  }

  getAgentCount(): number {
    const n = parseInt(this.agentCountInput?.value ?? "48", 10);
    return Number.isFinite(n) ? Math.max(6, Math.min(512, n)) : 48;
  }

  private initTabs(): void {
    document.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = (btn as HTMLElement).dataset.tab!;
        document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById(`tab-${tab}`)?.classList.add("active");
        if (tab === "colony") this.refreshColony();
      });
    });
  }

  private initApiKey(): void {
    document.getElementById("btn-save-key")!.addEventListener("click", async () => {
      const key = this.apiInput.value.trim();
      if (!key) return;
      const res = await fetch("/api/qwen/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: key }),
      });
      const status: QwenStatus = await res.json();
      this.renderQwen(status);
      this.apiInput.value = "";
      this.switchTab("settings");
    });
  }

  private initLayers(): void {
    if (!this.scene) return;
    const container = document.getElementById("layer-toggles")!;
    const keys = Object.keys(this.scene.layers) as (keyof typeof this.scene.layers)[];
    container.innerHTML = keys
      .map(
        (k) =>
          `<label><input type="checkbox" data-layer="${k}" ${this.scene!.layers[k] ? "checked" : ""}/> ${k}</label>`
      )
      .join("");
    container.querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("change", (e) => {
        const target = e.target as HTMLInputElement;
        const layer = target.dataset.layer as keyof typeof this.scene.layers;
        this.scene!.layers[layer] = target.checked;
        this.scene!.applyLayers();
      });
    });
  }

  switchTab(name: string): void {
    document.querySelector(`.tab[data-tab="${name}"]`)?.dispatchEvent(new Event("click"));
  }

  async loadQwen(): Promise<void> {
    const res = await fetch("/api/qwen/status");
    this.renderQwen(await res.json());
  }

  updateQwen(status: QwenStatus): void {
    this.renderQwen(status);
  }

  private renderQwen(status: QwenStatus): void {
    const ok = status.configured;
    this.badgeEl.textContent = ok ? "Qwen Cloud ✓" : "Qwen offline";
    this.badgeEl.className = `badge ${ok ? "badge-ok" : "badge-warn"}`;

    const u = status.usage;
    this.qwenStatusEl.innerHTML = `
      <strong>${status.status_message}</strong><br/>
      ${status.api_key_masked ? `Key: <code>${status.api_key_masked}</code><br/>` : ""}
      Calls: ${u.total_calls} · Tokens: ${u.total_tokens}<br/>
      In: ${u.total_input_tokens} · Out: ${u.total_output_tokens}
    `;

    if (!this.qwenModelsEl.dataset.built) {
      this.qwenModelsEl.innerHTML = ROLES.map((role) => {
        const cfg = status.roles[role];
        const opts = MODELS.map(
          (m) => `<option value="${m}" ${cfg?.model === m ? "selected" : ""}>${m}</option>`
        ).join("");
        return `<div class="model-row"><label>${role}</label><select data-role="${role}">${opts}</select></div>`;
      }).join("");
      this.qwenModelsEl.dataset.built = "1";
      this.qwenModelsEl.querySelectorAll("select").forEach((sel) => {
        sel.addEventListener("change", async (e) => {
          const t = e.target as HTMLSelectElement;
          await fetch("/api/qwen/configure", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: t.dataset.role, model: t.value }),
          });
        });
      });
    }
  }

  updateMetrics(metrics: ComparisonMetrics): void {
    const s = metrics.society;
    const b = metrics.baseline;
    this.metricsEl.innerHTML = `
      <div class="metric-row"><span>Quality (Society)</span><span class="${metrics.society_wins_quality ? "metric-win" : "metric-lose"}">${s.quality_score.toFixed(2)}</span></div>
      <div class="metric-row"><span>Quality (Baseline)</span><span>${b.quality_score.toFixed(2)}</span></div>
      <div class="metric-row"><span>Iterations</span><span>${s.iterations} / ${b.iterations}</span></div>
      <div class="metric-row"><span>Conflicts Resolved</span><span class="metric-win">${s.conflicts_resolved}</span></div>
      <div class="metric-row"><span>Negotiations</span><span class="metric-win">${s.negotiations}</span></div>
      <div class="metric-row"><span>Transparency</span><span class="metric-win">${s.transparency_events}</span></div>
      <div class="metric-row"><span>Tokens</span><span>S:${s.tokens_estimate} B:${b.tokens_estimate}</span></div>
      <div class="metric-row"><span>VoxForge</span><span>${(s.features_complete * 100).toFixed(0)}%</span></div>
      <p style="margin-top:10px;font-size:11px;color:var(--text-muted)">${metrics.summary}</p>
    `;
  }

  updateTasks(canvas: ProjectCanvas): void {
    this.taskEl.innerHTML = canvas.subtasks
      .map((t) => {
        const cls = t.status === "done" ? "task-done" : t.status === "in_progress" ? "task-active" : "task-pending";
        return `<div class="task-item ${cls}">${t.status === "done" ? "✓" : "○"} ${t.title}</div>`;
      })
      .join("");
  }

  updateColonyFromServer(info?: ColonyInfo): void {
    if (!info) return;
    const sceneStats = this.scene?.getColonyStats();
    this.colonyStatsEl.innerHTML = `
      <div class="metric-row"><span>Agents</span><span>${info.agent_count}</span></div>
      <div class="metric-row"><span>Grid</span><span>${info.world_size}×${info.world_size}</span></div>
      <div class="metric-row"><span>Walkable</span><span>${info.walkable_cells.toLocaleString()}</span></div>
      <div class="metric-row"><span>Life cells</span><span>${sceneStats?.lifeAlive.toLocaleString() ?? "—"}</span></div>
    `;
    const sectors = info.sectors ?? sceneStats?.sectors ?? {};
    const sorted = Object.entries(sectors).sort((a, b) => b[1] - a[1]).slice(0, 12);
    this.sectorEl.innerHTML = sorted.length
      ? sorted.map(([s, n]) => `<div class="metric-row"><span>${s}</span><span>${n}</span></div>`).join("")
      : "<p class='hint'>No sector data yet.</p>";
  }

  refreshColony(agents?: Agent[]): void {
    const list = agents ?? this.scene?.getAgents() ?? [];
    this.registryEl.innerHTML = list
      .slice(0, 80)
      .map(
        (a) =>
          `<div class="registry-row"><span class="registry-name">${a.name}</span><span class="registry-pos">(${a.grid_x},${a.grid_y})</span><span class="registry-role">${a.role}</span></div>`
      )
      .join("") || "<p class='hint'>No agents loaded.</p>";
    if (list.length > 80) {
      this.registryEl.innerHTML += `<p class="hint">+${list.length - 80} more agents</p>`;
    }
    if (this.scene) {
      this.scene.drawMinimap(this.minimapCtx, this.minimapCanvas.width);
    }
    const stats = this.scene?.getColonyStats();
    if (stats) {
      this.colonyStatsEl.innerHTML = `
        <div class="metric-row"><span>Agents</span><span>${stats.agentCount}</span></div>
        <div class="metric-row"><span>Grid</span><span>96×96</span></div>
        <div class="metric-row"><span>Walkable</span><span>${stats.walkableCells.toLocaleString()}</span></div>
        <div class="metric-row"><span>Life cells</span><span>${stats.lifeAlive.toLocaleString()}</span></div>
      `;
      const sorted = Object.entries(stats.sectors).sort((a, b) => b[1] - a[1]).slice(0, 12);
      this.sectorEl.innerHTML = sorted
        .map(([s, n]) => `<div class="metric-row"><span>${s}</span><span>${n}</span></div>`)
        .join("");
    }
  }

  logMovement(agent: Agent, from: { x: number; y: number }): void {
    const div = document.createElement("div");
    div.className = "log-entry movement";
    div.textContent = `${agent.name} (${from.x},${from.y}) → (${agent.grid_x},${agent.grid_y})`;
    this.movementEl.prepend(div);
    while (this.movementEl.children.length > 30) this.movementEl.lastChild?.remove();
  }

  addNegotiation(neg: NegotiationRound): void {
    const div = document.createElement("div");
    div.className = "log-entry negotiation";
    div.textContent = `[${neg.outcome}] ${neg.topic}`;
    this.negEl.prepend(div);
    while (this.negEl.children.length > 15) this.negEl.lastChild?.remove();
  }

  logEvent(event: SimEvent): void {
    const div = document.createElement("div");
    const cls =
      event.type.includes("negotiation") ? "negotiation"
      : event.type.includes("conflict") ? "conflict"
      : event.type.includes("task") ? "task"
      : event.type.includes("metrics") ? "metrics"
      : event.type.includes("birth") || event.type.includes("death") ? "movement"
      : "";
    div.className = `log-entry ${cls}`;
    div.textContent = `t${event.tick} · ${event.type}`;
    this.logEl.prepend(div);
    while (this.logEl.children.length > 50) this.logEl.lastChild?.remove();

    if (event.type === "agent_birth" || event.type === "agent_death") {
      this.refreshColony();
    }
  }
}