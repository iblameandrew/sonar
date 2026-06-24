import { ColonyScene } from "./scene/ColonyScene";
import { SSEClient } from "./sse/client";
import { Dashboard } from "./ui/Dashboard";
import type { Agent, ColonyInfo, ComparisonMetrics, ProjectCanvas, SimEvent } from "./types";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const tickLabel = document.getElementById("tick-label")!;
const phaseLabel = document.getElementById("phase-label")!;
const regretLabel = document.getElementById("regret-label")!;
const modeLabel = document.getElementById("mode-label")!;
const inspectPanel = document.getElementById("inspect-panel")!;

const scene = new ColonyScene(canvas);
const sse = new SSEClient();
const dashboard = new Dashboard(scene);

let colonyRefreshTick = 0;

async function api(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function init() {
  await dashboard.loadQwen();
  const state = await api("/state");
  if (state.qwen) dashboard.updateQwen(state.qwen);
  if (state.agents?.length) {
    scene.loadAgents(state.agents as Agent[]);
    if (state.canvas?.voxforge_voxels) scene.loadVoxForge(state.canvas.voxforge_voxels);
    dashboard.updateTasks(state.canvas as ProjectCanvas);
    dashboard.refreshColony(state.agents as Agent[]);
    if (state.colony) dashboard.updateColonyFromServer(state.colony as ColonyInfo);
    updateStatus(state);
  }

  scene.onAgentSelect = (agent) => {
    if (!agent) { inspectPanel.classList.add("hidden"); return; }
    inspectPanel.classList.remove("hidden");
    api(`/agents/${agent.id}`).then((deps) => {
      inspectPanel.innerHTML = `
        <strong>${agent.name}</strong> · ${agent.role}<br/>
        Position (${agent.grid_x}, ${agent.grid_y})<br/>
        ${agent.verbs.join(" · ")}<br/>
        <em>${agent.adjectives.join(", ")}</em><br/>
        Deps: ${deps.incoming?.length ?? 0} in / ${deps.outgoing?.length ?? 0} out
      `;
    });
  };

  scene.onMovement = (agent, from) => dashboard.logMovement(agent, from);

  sse.connect();
  sse.onAll((event: SimEvent) => {
    scene.handleEvent(event);
    dashboard.logEvent(event);
    if (event.type === "negotiation_round" || event.type === "conflict_resolved") {
      dashboard.addNegotiation(event.payload as never);
    }
    if (event.type === "society_metrics" || event.type === "comparison_metrics") {
      dashboard.updateMetrics(event.payload as unknown as ComparisonMetrics);
      dashboard.switchTab("metrics");
    }
    if (event.type === "qwen_usage") dashboard.updateQwen(event.payload as never);
    if (event.type === "task_decomposed" || event.type === "messenger_propose") {
      api("/canvas").then((c) => dashboard.updateTasks(c));
    }
    if (event.tick) tickLabel.textContent = `Tick ${event.tick}`;
    if (event.type === "phase_change") phaseLabel.textContent = String(event.payload.design_phase ?? "?");
    if (event.type === "auditor_regret") regretLabel.textContent = `Regret ${(event.payload.regret as number).toFixed(2)}`;
    if (event.type === "sim_complete") {
      modeLabel.textContent = String(event.payload.mode);
      api("/metrics").then((m) => { if (m.comparison) dashboard.updateMetrics(m.comparison); });
    }
  });

  document.getElementById("btn-society")!.onclick = async () => {
    modeLabel.textContent = "Society";
    const agentCount = dashboard.getAgentCount();
    await api("/sim/society", "POST", { max_ticks: 80, speed: 1.5, agent_count: agentCount });
    const s = await api("/state");
    scene.loadAgents(s.agents);
    dashboard.updateTasks(s.canvas);
    dashboard.refreshColony(s.agents);
    if (s.colony) dashboard.updateColonyFromServer(s.colony);
    updateStatus(s);
    dashboard.switchTab("colony");
  };
  document.getElementById("btn-baseline")!.onclick = async () => {
    modeLabel.textContent = "Baseline";
    await api("/sim/baseline", "POST", { max_ticks: 40, speed: 1 });
  };
  document.getElementById("btn-conflict")!.onclick = () => api("/sim/inject-conflict", "POST");
  document.getElementById("btn-step")!.onclick = () => api("/sim/step", "POST");
  document.getElementById("btn-phase")!.onclick = () => api("/sim/advance-phase", "POST");
  document.getElementById("btn-pause")!.onclick = () => api("/sim/pause", "POST");

  (function animate() {
    requestAnimationFrame(animate);
    scene.render();
    colonyRefreshTick++;
    if (colonyRefreshTick % 90 === 0) dashboard.refreshColony();
  })();
}

function updateStatus(state: Record<string, unknown>) {
  tickLabel.textContent = `Tick ${state.tick ?? 0}`;
  phaseLabel.textContent = String(state.design_phase ?? "concept");
  regretLabel.textContent = typeof state.regret === "number" ? `Regret ${state.regret.toFixed(2)}` : "Regret —";
  modeLabel.textContent = String(state.execution_mode ?? "idle");
}

init();