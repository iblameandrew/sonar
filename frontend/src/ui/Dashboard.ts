import type { ComparisonMetrics, NegotiationRound, ProjectCanvas, SimEvent, Subtask } from "../types";

export class Dashboard {
  private metricsEl: HTMLElement;
  private negEl: HTMLElement;
  private taskEl: HTMLElement;
  private logEl: HTMLElement;

  constructor() {
    this.metricsEl = document.getElementById("metrics-content")!;
    this.negEl = document.getElementById("negotiation-log")!;
    this.taskEl = document.getElementById("task-tree")!;
    this.logEl = document.getElementById("log-content")!;
  }

  updateMetrics(metrics: ComparisonMetrics): void {
    const s = metrics.society;
    const b = metrics.baseline;
    this.metricsEl.innerHTML = `
      <div class="metric-row"><span>Society Quality</span><span class="${metrics.society_wins_quality ? "metric-win" : "metric-lose"}">${s.quality_score.toFixed(2)}</span></div>
      <div class="metric-row"><span>Baseline Quality</span><span>${b.quality_score.toFixed(2)}</span></div>
      <div class="metric-row"><span>Society Iterations</span><span>${s.iterations}</span></div>
      <div class="metric-row"><span>Baseline Iterations</span><span>${b.iterations}</span></div>
      <div class="metric-row"><span>Conflicts Resolved</span><span class="metric-win">${s.conflicts_resolved}</span></div>
      <div class="metric-row"><span>Negotiations</span><span class="metric-win">${s.negotiations}</span></div>
      <div class="metric-row"><span>Transparency Events</span><span class="metric-win">${s.transparency_events}</span></div>
      <div class="metric-row"><span>Tokens (est.)</span><span>S:${s.tokens_estimate} B:${b.tokens_estimate}</span></div>
      <div class="metric-row"><span>VoxForge Progress</span><span>${(s.features_complete * 100).toFixed(0)}%</span></div>
      <p style="margin-top:8px;color:#888">${metrics.summary}</p>
    `;
  }

  updateTasks(canvas: ProjectCanvas): void {
    this.taskEl.innerHTML = canvas.subtasks
      .map((t) => {
        const cls = t.status === "done" ? "task-done" : t.status === "in_progress" ? "task-active" : "task-pending";
        return `<div class="task-item ${cls}">${t.status === "done" ? "✓" : "○"} ${t.title}${t.assigned_to ? ` → ${t.assigned_to.slice(0, 8)}` : ""}</div>`;
      })
      .join("");
  }

  addNegotiation(neg: NegotiationRound): void {
    const div = document.createElement("div");
    div.className = "log-entry negotiation";
    div.textContent = `[${neg.outcome}] ${neg.topic}: ${neg.rationale.slice(0, 80)}`;
    this.negEl.prepend(div);
    while (this.negEl.children.length > 20) this.negEl.lastChild?.remove();
  }

  logEvent(event: SimEvent): void {
    const div = document.createElement("div");
    const cls =
      event.type.includes("negotiation") || event.type.includes("collaboration") ? "negotiation"
      : event.type.includes("conflict") ? "conflict"
      : event.type.includes("task") || event.type.includes("decomposed") ? "task"
      : event.type.includes("metrics") ? "metrics"
      : "";
    div.className = `log-entry ${cls}`;
    div.textContent = `t${event.tick} ${event.type}`;
    this.logEl.prepend(div);
    while (this.logEl.children.length > 40) this.logEl.lastChild?.remove();
  }

  showMetricsPanel(): void {
    document.getElementById("metrics-panel")?.scrollIntoView({ behavior: "smooth" });
  }
}