import {
  emptyHead,
  fetchCatalogue,
  fetchDefaultPolicy,
  loadPolicyLocal,
  normalizePolicy,
  savePolicyLocal,
  type AttentionFunction,
  type AttentionHeadConfig,
  type AttentionPolicy,
  type PolicyPreview,
} from "../attentionPolicy";
import { getStoredApiKey, saveApiKey } from "../storage/apiKeyStorage";
import type { Agent, ColonyInfo, ComparisonMetrics, NegotiationRound, ProjectCanvas, SimEvent } from "../types";
import { DASHBOARD_ROLES, roleLabel } from "../agentRoles";
import type { ColonyScene } from "../scene/colony-scene";

export interface QwenModelEntry {
  id: string;
  label: string;
  category: string;
  best_for: string;
}

const FALLBACK_MODELS: QwenModelEntry[] = [
  { id: "qwen3.6-flash", label: "Qwen3.6 Flash", category: "fast", best_for: "Default for all roles" },
  { id: "qwen3.7-max", label: "Qwen3.7 Max", category: "flagship", best_for: "Reasoning" },
  { id: "qwen3.7-plus", label: "Qwen3.7 Plus", category: "balanced", best_for: "General use" },
  { id: "qwen3.6-plus", label: "Qwen3.6 Plus", category: "balanced", best_for: "Balanced agents" },
  { id: "qwen2.5-coder-32b-instruct", label: "Qwen2.5 Coder 32B", category: "coder", best_for: "Code" },
];

const CATEGORY_LABELS: Record<string, string> = {
  flagship: "Flagship",
  balanced: "Balanced",
  fast: "Fast",
  vision: "Vision",
  coder: "Coder",
  legacy: "Legacy",
};

export interface QwenStatus {
  provider: string;
  configured: boolean;
  key_valid?: boolean;
  validation_message?: string;
  api_key_masked: string;
  last_error?: string;
  status_message: string;
  default_model: string;
  available_models?: QwenModelEntry[];
  role_labels?: Record<string, string>;
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
  private streamStatusEl: HTMLElement;
  private qwenStatusEl: HTMLElement;
  private lastProgressKey = "";
  private qwenModelsEl: HTMLElement;
  private badgeEl: HTMLElement;
  private apiInput: HTMLInputElement;
  private rememberKeyInput: HTMLInputElement;
  private colonyStatsEl: HTMLElement;
  private sectorEl: HTMLElement;
  private registryEl: HTMLElement;
  private movementEl: HTMLElement;
  private minimapCanvas: HTMLCanvasElement;
  private minimapCtx: CanvasRenderingContext2D;
  private agentCountInput: HTMLInputElement;
  private maxTicksSelect: HTMLSelectElement;
  private headsEl: HTMLElement;
  private policyPreviewEl: HTMLElement;
  private activePolicyEl: HTMLElement;
  private catalogue: AttentionFunction[] = [];
  private policy: AttentionPolicy = { heads: {} };
  private headCounter = 0;

  constructor(private scene?: ColonyScene) {
    this.metricsEl = document.getElementById("metrics-content")!;
    this.negEl = document.getElementById("negotiation-log")!;
    this.taskEl = document.getElementById("task-tree")!;
    this.logEl = document.getElementById("log-content")!;
    this.streamStatusEl = document.getElementById("stream-status")!;
    this.qwenStatusEl = document.getElementById("qwen-status")!;
    this.qwenModelsEl = document.getElementById("qwen-models")!;
    this.badgeEl = document.getElementById("qwen-badge")!;
    this.apiInput = document.getElementById("api-key-input") as HTMLInputElement;
    this.rememberKeyInput = document.getElementById("api-key-remember") as HTMLInputElement;
    this.colonyStatsEl = document.getElementById("colony-stats")!;
    this.sectorEl = document.getElementById("sector-stats")!;
    this.registryEl = document.getElementById("agent-registry")!;
    this.movementEl = document.getElementById("movement-log")!;
    this.minimapCanvas = document.getElementById("colony-minimap") as HTMLCanvasElement;
    this.minimapCtx = this.minimapCanvas.getContext("2d")!;
    this.agentCountInput = document.getElementById("agent-count") as HTMLInputElement;
    this.maxTicksSelect = document.getElementById("max-ticks") as HTMLSelectElement;
    this.headsEl = document.getElementById("attention-heads")!;
    this.policyPreviewEl = document.getElementById("attention-policy-preview")!;
    this.activePolicyEl = document.getElementById("active-attention-policy")!;

    this.initTabs();
    this.initApiKey();
    this.initLayers();
    void this.initAttentionPolicy();
  }

  getAgentCount(): number {
    const n = parseInt(this.agentCountInput?.value ?? "48", 10);
    return Number.isFinite(n) ? Math.max(4, Math.min(512, n)) : 48;
  }

  getMaxTicks(): number {
    const n = parseInt(this.maxTicksSelect?.value ?? "12", 10);
    return Number.isFinite(n) ? Math.max(4, Math.min(500, n)) : 12;
  }

  getAttentionPolicy(): AttentionPolicy {
    return this.policy;
  }

  private async initAttentionPolicy(): Promise<void> {
    try {
      this.catalogue = await fetchCatalogue();
      const stored = loadPolicyLocal();
      this.policy = stored ?? (await fetchDefaultPolicy());
      this.headCounter = Object.keys(this.policy.heads).length;
      this.renderAttentionHeads();
      await this.refreshPolicyPreview();
    } catch {
      this.policyPreviewEl.textContent = "Could not load attention catalogue.";
    }

    document.getElementById("btn-add-head")?.addEventListener("click", () => {
      this.headCounter += 1;
      const id = `attention_head_${this.headCounter}`;
      this.policy.heads[id] = emptyHead();
      this.renderAttentionHeads();
      void this.refreshPolicyPreview();
    });

    document.getElementById("btn-reset-policy")?.addEventListener("click", async () => {
      this.policy = await fetchDefaultPolicy();
      this.headCounter = Object.keys(this.policy.heads).length;
      this.renderAttentionHeads();
      await this.refreshPolicyPreview();
    });
  }

  private renderAttentionHeads(): void {
    const fns = this.catalogue;
    this.headsEl.innerHTML = Object.entries(this.policy.heads)
      .map(([headId, head]) => this.renderHeadCard(headId, head, fns))
      .join("");

    this.headsEl.querySelectorAll("[data-head-id]").forEach((card) => {
      const headId = (card as HTMLElement).dataset.headId!;
      const desc = card.querySelector(".head-desc") as HTMLInputElement;
      desc?.addEventListener("input", () => {
        this.policy.heads[headId].description = desc.value;
        void this.refreshPolicyPreview();
      });

      card.querySelectorAll("[data-fn]").forEach((row) => {
        const fn = (row as HTMLElement).dataset.fn!;
        const check = row.querySelector("input[type=checkbox]") as HTMLInputElement;
        const slider = row.querySelector("input[type=range]") as HTMLInputElement;
        const val = row.querySelector(".fn-weight-val") as HTMLElement;

        const sync = () => {
          const w = parseFloat(slider.value) / 100;
          val.textContent = `${Math.round(w * 100)}%`;
          if (check.checked) {
            this.policy.heads[headId].weight_distribution[fn] = w;
            if (!this.policy.heads[headId].primary_focus.includes(fn)) {
              this.policy.heads[headId].primary_focus.push(fn);
            }
          } else {
            delete this.policy.heads[headId].weight_distribution[fn];
            this.policy.heads[headId].primary_focus =
              this.policy.heads[headId].primary_focus.filter((x) => x !== fn);
          }
          void this.refreshPolicyPreview();
        };
        check?.addEventListener("change", sync);
        slider?.addEventListener("input", () => {
          if (check.checked) sync();
        });
      });

      card.querySelector(".btn-remove-head")?.addEventListener("click", () => {
        delete this.policy.heads[headId];
        this.renderAttentionHeads();
        void this.refreshPolicyPreview();
      });
    });
  }

  private renderHeadCard(headId: string, head: AttentionHeadConfig, fns: AttentionFunction[]): string {
    const fnRows = fns
      .map((fn) => {
        const w = head.weight_distribution[fn.id] ?? 0.25;
        const on = fn.id in head.weight_distribution;
        return `<label class="fn-row" data-fn="${fn.id}">
          <input type="checkbox" ${on ? "checked" : ""}/>
          <span class="fn-label">${fn.label}</span>
          <input type="range" min="5" max="100" value="${Math.round(w * 100)}"/>
          <span class="fn-weight-val">${Math.round(w * 100)}%</span>
        </label>`;
      })
      .join("");
    return `<div class="head-card" data-head-id="${headId}">
      <div class="head-card-top">
        <strong>${headId.replace(/_/g, " ")}</strong>
        <button type="button" class="btn btn-warn btn-remove-head">Remove</button>
      </div>
      <input class="head-desc" type="text" placeholder="Description for this head…" value="${head.description ?? ""}"/>
      <div class="fn-grid">${fnRows}</div>
    </div>`;
  }

  private async refreshPolicyPreview(): Promise<void> {
    savePolicyLocal(this.policy);
    try {
      const { preview } = await normalizePolicy(this.policy);
      this.policyPreviewEl.innerHTML =
        preview
          .map(
            (p: PolicyPreview) =>
              `<div class="metric-row"><span>${p.label}</span><span>${(p.weight * 100).toFixed(0)}%</span></div>
               <p class="hint" style="margin:0 0 8px">${p.bias}</p>`,
          )
          .join("") || "<p class='hint'>Enable at least one function per head.</p>";
    } catch {
      this.policyPreviewEl.textContent = "Preview unavailable.";
    }
  }

  updateActiveAttentionPolicy(policy: AttentionPolicy, preview?: PolicyPreview[]): void {
    const heads = Object.entries(policy.heads ?? {});
    this.activePolicyEl.innerHTML = `
      <strong>${heads.length} attention head(s) active</strong><br/>
      ${heads.map(([id, h]) => `${id}: ${h.description || "—"}`).join("<br/>")}
      ${preview?.length ? `<br/><br/>Top biases: ${preview.map((p) => p.label).join(", ")}` : ""}`;
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
    this.rememberKeyInput.checked = true;
    this.rememberKeyInput.disabled = true;

    document.getElementById("btn-save-key")!.addEventListener("click", async () => {
      const key = this.apiInput.value.trim();
      if (!key) return;
      await this.submitApiKey(key);
    });
  }

  private async submitApiKey(key: string, opts?: { silent?: boolean }): Promise<QwenStatus | null> {
    const res = await fetch("/api/qwen/api-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key }),
    });
    if (!res.ok) return null;

    const status: QwenStatus = await res.json();
    this.renderQwen(status);
    if (status.key_valid) {
      saveApiKey(key);
      this.apiInput.placeholder = status.api_key_masked
        ? `Saved ${status.api_key_masked} — paste to replace`
        : "sk-… DashScope API key";
    } else {
      const msg = status.validation_message ?? status.last_error ?? "Invalid API key";
      this.logEvent({
        type: "qwen_auth_failed",
        tick: 0,
        payload: { message: msg },
      });
      if (!opts?.silent) {
        alert(`DashScope rejected this API key.\n\n${msg}\n\nSimulation will use heuristic agents until you connect a valid key.`);
      }
    }

    if (!opts?.silent) this.switchTab("settings");
    return status;
  }

  async restoreStoredApiKey(status?: QwenStatus): Promise<void> {
    if (status?.configured) {
      if (status.api_key_masked) {
        this.apiInput.placeholder = `Saved ${status.api_key_masked} — paste to replace`;
      }
      return;
    }

    const stored = getStoredApiKey();
    if (!stored) return;

    await this.submitApiKey(stored, { silent: true });
  }

  async ensureApiKey(): Promise<boolean> {
    const res = await fetch("/api/qwen/status");
    const status: QwenStatus = await res.json();
    if (status.configured && status.key_valid !== false) {
      this.renderQwen(status);
      return true;
    }
    const stored = getStoredApiKey();
    if (!stored) return false;
    const restored = await this.submitApiKey(stored, { silent: true });
    return Boolean(restored?.configured && restored?.key_valid);
  }

  private initLayers(): void {
    if (!this.scene) return;
    const container = document.getElementById("layer-toggles")!;
    const keys = Object.keys(this.scene.layers) as (keyof typeof this.scene.layers)[];
    container.innerHTML = keys
      .map(
        (k) =>
          `<label><input type="checkbox" data-layer="${k}" ${this.scene!.layers[k] ? "checked" : ""}/> ${roleLabel(k)}</label>`
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
    const status: QwenStatus = await res.json();
    this.renderQwen(status);
    await this.restoreStoredApiKey(status);
  }

  updateQwen(status: QwenStatus): void {
    this.renderQwen(status);
  }

  private renderQwen(status: QwenStatus): void {
    const ok = status.configured;
    this.badgeEl.textContent = ok ? "Qwen Cloud ✓" : "Qwen offline";
    this.badgeEl.className = `badge ${ok ? "badge-ok" : "badge-warn"}`;

    const u = status.usage;
    const errLine = status.last_error
      ? `<div class="qwen-error">Last error: ${status.last_error}</div>`
      : "";
    this.qwenStatusEl.innerHTML = `
      <strong>${status.status_message}</strong><br/>
      ${status.api_key_masked ? `Key: <code>${status.api_key_masked}</code><br/>` : ""}
      ${errLine}
      Calls: ${u.total_calls} · Tokens: ${u.total_tokens}<br/>
      In: ${u.total_input_tokens} · Out: ${u.total_output_tokens}
    `;

    if (!this.qwenModelsEl.dataset.built) {
      const labels = status.role_labels ?? {};
      this.qwenModelsEl.innerHTML = DASHBOARD_ROLES.map((role) => {
        const cfg = status.roles[role];
        const opts = this.buildModelOptions(status, cfg?.model);
        const label = labels[role] ?? roleLabel(role);
        return `<div class="model-row"><label>${label}</label><select data-role="${role}">${opts}</select></div>`;
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

  private buildModelOptions(status: QwenStatus, current?: string): string {
    const catalog = status.available_models?.length ? status.available_models : FALLBACK_MODELS;
    const ids = new Set(catalog.map((m) => m.id));
    const byCategory = new Map<string, QwenModelEntry[]>();
    for (const m of catalog) {
      const list = byCategory.get(m.category) ?? [];
      list.push(m);
      byCategory.set(m.category, list);
    }

    let html = "";
    for (const [category, models] of byCategory) {
      const label = CATEGORY_LABELS[category] ?? category;
      html += `<optgroup label="${label}">`;
      for (const m of models) {
        const selected = current === m.id ? " selected" : "";
        html += `<option value="${m.id}"${selected}>${m.label}</option>`;
      }
      html += "</optgroup>";
    }
    if (current && !ids.has(current)) {
      html += `<optgroup label="Custom"><option value="${current}" selected>${current}</option></optgroup>`;
    }
    return html;
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
      <div class="metric-row"><span>Colony progress</span><span>${(s.features_complete * 100).toFixed(0)}%</span></div>
      <p style="margin-top:10px;font-size:11px;color:var(--text-muted)">${metrics.summary}</p>
    `;
  }

  updateTasks(canvas?: ProjectCanvas): void {
    if (!canvas?.subtasks?.length) {
      this.taskEl.innerHTML = "<p class='hint'>No tasks yet — deploy a colony to decompose your prompt.</p>";
      return;
    }
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
      <div class="metric-row"><span>On task</span><span>${sceneStats?.activeAgents?.toLocaleString() ?? "—"}</span></div>
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
          `<div class="registry-row"><span class="registry-name">${a.name}</span><span class="registry-pos">(${a.grid_x},${a.grid_y})</span><span class="registry-role">${roleLabel(a.role)}</span></div>`
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
        <div class="metric-row"><span>On task</span><span>${stats.activeAgents.toLocaleString()}</span></div>
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

  addNegotiation(payload: Record<string, unknown>): void {
    const nested = payload.negotiation as NegotiationRound | undefined;
    const outcome = String(nested?.outcome ?? payload.outcome ?? "resolved");
    const topic = String(
      nested?.topic ?? payload.topic ?? payload.message ?? "Conflict resolution",
    );
    const div = document.createElement("div");
    div.className = "log-entry negotiation";
    div.textContent = `[${outcome}] ${topic}`;
    this.negEl.prepend(div);
    while (this.negEl.children.length > 15) this.negEl.lastChild?.remove();
  }

  updateStreamStatus(connected: boolean, detail = ""): void {
    const suffix = detail ? ` · ${detail}` : "";
    this.streamStatusEl.textContent = connected
      ? `Stream: live${suffix}`
      : `Stream: reconnecting…${suffix}`;
    this.streamStatusEl.classList.toggle("status-live", connected);
    this.streamStatusEl.classList.toggle("status-warn", !connected);
  }

  updateRunProgress(
    tick: number,
    maxTicks: number,
    playbookEdges: number,
    detail = "",
    opts?: { force?: boolean },
  ): void {
    const key = `${tick}:${maxTicks}:${playbookEdges}:${detail}`;
    if (!opts?.force && key === this.lastProgressKey) return;
    this.lastProgressKey = key;
    const extra = detail ? ` · ${detail}` : "";
    this.streamStatusEl.textContent =
      `Tick ${tick}/${maxTicks} · ${playbookEdges} playbook edges${extra}`;
    this.streamStatusEl.classList.add("status-live");
    this.streamStatusEl.classList.toggle("status-warn", detail.includes("reconnect"));
  }

  markRunComplete(tick: number, maxTicks: number, playbookEdges: number, goal = ""): void {
    const summary = goal ? ` · ${goal.slice(0, 48)}` : "";
    this.streamStatusEl.textContent =
      `Complete · tick ${tick}/${maxTicks} · ${playbookEdges} edges${summary}`;
    this.streamStatusEl.classList.add("status-live");
    this.streamStatusEl.classList.remove("status-warn");
    this.lastProgressKey = `done:${tick}`;
  }

  resetColonyUi(): void {
    this.streamStatusEl.textContent = "Stream: idle";
    this.streamStatusEl.classList.remove("status-live", "status-warn");
    this.lastProgressKey = "";
    this.taskEl.innerHTML = "";
    this.negEl.innerHTML = "";
    this.logEl.innerHTML = "";
    this.movementEl.innerHTML = "";
    if (this.activePolicyEl) {
      this.activePolicyEl.textContent =
        "Not deployed yet — configure heads above, then Deploy Colony.";
    }
  }

  private formatEventLine(event: SimEvent): string {
    const p = event.payload ?? {};
    switch (event.type) {
      case "simulation_started":
        return `t${event.tick} · colony deployed · ${p.agent_count ?? "?"} agents · ${String(p.goal ?? "default goal").slice(0, 72)}`;
      case "tick_started":
        return `t${event.tick} · tick started · ${p.agent_count ?? "?"} agents · max ${p.max_ticks ?? "?"}`;
      case "tick_phase":
        return `t${event.tick} · phase ${p.phase ?? "?"}`;
      case "attention_progress":
        if (p.source === "poll") return "";
        return `t${event.tick} · attention ${p.done}/${p.total} pairs scored · ${p.matched} edges`;
      case "heartbeat":
        return `t${event.tick} · still computing…`;
      case "attention_policy_configured":
        return `t${event.tick} · attention policy applied · ${(p.preview as unknown[] | undefined)?.length ?? 0} weighted functions`;
      case "auditor_regret":
        return `t${event.tick} · regret ${Number(p.regret ?? 0).toFixed(2)}`;
      case "sim_complete":
        return `t${event.tick} · simulation complete · ${p.mode ?? "society"}`;
      case "sim_error":
        return `t${event.tick} · error · ${String(p.message ?? "unknown")}`;
      case "deploy_failed":
        return `t${event.tick} · deploy failed · ${String(p.message ?? "unknown")}`;
      case "qwen_offline":
        return `t${event.tick} · ${String(p.message ?? "Qwen offline")}`;
      case "qwen_auth_failed":
        return `t${event.tick} · API key rejected · ${String(p.message ?? "invalid key")}`;
      default:
        return `t${event.tick} · ${event.type}`;
    }
  }

  private static readonly QUIET_EVENTS = new Set([
    "attention_judgment",
    "collaboration_pod",
    "confessor_flow",
    "reformer_update",
    "qwen_usage",
    "heartbeat",
  ]);

  logEvent(event: SimEvent, opts?: { force?: boolean }): void {
    if (!opts?.force && Dashboard.QUIET_EVENTS.has(event.type)) {
      return;
    }

    const line = this.formatEventLine(event);
    if (!line) return;
    const top = this.logEl.firstElementChild as HTMLElement | null;
    if (
      !opts?.force
      && top
      && (event.type === "attention_progress" || event.type === "heartbeat")
      && top.dataset?.eventType === event.type
      && top.dataset?.tick === String(event.tick)
    ) {
      top.textContent = line;
      return;
    }

    const div = document.createElement("div");
    const cls =
      event.type.includes("negotiation") ? "negotiation"
      : event.type.includes("conflict") ? "conflict"
      : event.type.includes("task") ? "task"
      : event.type.includes("metrics") ? "metrics"
      : event.type === "tick_started" || event.type === "tick_phase" || event.type === "attention_progress" ? "metrics"
      : event.type.includes("birth") || event.type.includes("death") ? "movement"
      : event.type === "sim_error" || event.type === "deploy_failed" ? "conflict"
      : "";
    div.className = `log-entry ${cls}`;
    div.textContent = line;
    div.dataset.eventType = event.type;
    div.dataset.tick = String(event.tick);
    this.logEl.prepend(div);
    while (this.logEl.children.length > 80) this.logEl.lastChild?.remove();

    if (event.type === "agent_birth" || event.type === "agent_death") {
      this.refreshColony();
    }
  }
}