import { SSEClient } from "./sse/client";
import { roleLabel } from "./agentRoles";
import type { Dashboard } from "./ui/Dashboard";
import type { ColonyScene } from "./scene/ColonyScene";
import type { Agent, ColonyInfo, ComparisonMetrics, ProjectCanvas, SimEvent } from "./types";
import type { QwenStatus } from "./ui/Dashboard";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const tickLabel = document.getElementById("tick-label")!;
const phaseLabel = document.getElementById("phase-label")!;
const regretLabel = document.getElementById("regret-label")!;
const modeLabel = document.getElementById("mode-label")!;
const inspectPanel = document.getElementById("inspect-panel")!;
const promptInput = document.getElementById("colony-prompt") as HTMLTextAreaElement;
const activeGoalEl = document.getElementById("active-goal")!;
const bootErrorEl = document.getElementById("boot-error");

let scene: ColonyScene | null = null;
let dashboard: Dashboard;
const sse = new SSEClient();
let colonyRefreshTick = 0;

async function api(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

function getPrompt(): string {
  return promptInput.value.trim();
}

function setActiveGoal(goal: string): void {
  activeGoalEl.textContent = goal ? `Solving: ${goal}` : "";
}

function showBootError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("Colony boot failed:", err);
  if (bootErrorEl) {
    bootErrorEl.classList.remove("hidden");
    bootErrorEl.textContent =
      `UI failed to load the 3D scene (${msg}). Hard-refresh (Ctrl+Shift+R) or restart \`npm run dev\`. Dashboard controls should still work.`;
  }
}

async function deployColony() {
  const prompt = getPrompt();
  if (!prompt) {
    promptInput.focus();
    activeGoalEl.textContent = "Enter a problem for the colony to solve.";
    return;
  }

  modeLabel.textContent = "Society";
  const agentCount = dashboard.getAgentCount();
  await api("/sim/society", "POST", {
    max_ticks: 80,
    speed: 1.5,
    agent_count: agentCount,
    prompt,
  });

  const s = await api("/state");
  scene?.loadAgents(s.agents);
  dashboard.updateTasks(s.canvas);
  dashboard.refreshColony(s.agents);
  if (s.colony) dashboard.updateColonyFromServer(s.colony);
  if (s.canvas?.goal) setActiveGoal(s.canvas.goal);
  updateStatus(s);
  dashboard.switchTab("colony");
}

function wireControls(): void {
  document.getElementById("btn-solve")!.onclick = () => deployColony();
  document.getElementById("btn-society")!.onclick = () => deployColony();
  document.getElementById("btn-baseline")!.onclick = async () => {
    modeLabel.textContent = "Baseline";
    await api("/sim/baseline", "POST", { max_ticks: 40, speed: 1, prompt: getPrompt() });
  };
  document.getElementById("btn-conflict")!.onclick = () => api("/sim/inject-conflict", "POST");
  document.getElementById("btn-step")!.onclick = () => api("/sim/step", "POST");
  document.getElementById("btn-phase")!.onclick = () => api("/sim/advance-phase", "POST");
  document.getElementById("btn-pause")!.onclick = () => api("/sim/pause", "POST");
}

function startRenderLoop(): void {
  if (!scene) return;
  (function animate() {
    requestAnimationFrame(animate);
    scene!.render();
    colonyRefreshTick++;
    if (colonyRefreshTick % 90 === 0) dashboard.refreshColony();
  })();
}

async function init() {
  const { Dashboard: DashboardCtor } = await import("./ui/Dashboard");
  try {
    const { ColonyScene: ColonySceneCtor } = await import("./scene/ColonyScene");
    scene = new ColonySceneCtor(canvas);
    dashboard = new DashboardCtor(scene);
    startRenderLoop();
  } catch (err) {
    showBootError(err);
    dashboard = new DashboardCtor();
  }

  wireControls();

  try {
    await dashboard.loadQwen();
  } catch (err) {
    console.error("Qwen status failed:", err);
  }

  let state: {
    qwen?: QwenStatus;
    agents?: Agent[];
    canvas?: ProjectCanvas;
    colony?: ColonyInfo;
    tick?: number;
    design_phase?: string;
    regret?: number;
    execution_mode?: string;
  } | null = null;
  try {
    state = await api("/state");
  } catch (err) {
    console.error("Initial state failed:", err);
    activeGoalEl.textContent = "Backend unreachable — start the API server on :8000.";
    return;
  }
  if (!state) return;
  if (state.qwen) dashboard.updateQwen(state.qwen);
  if (state.agents?.length) {
    scene?.loadAgents(state.agents);
    if (state.canvas?.colony_voxels) scene?.loadColonyVoxels(state.canvas.colony_voxels);
    dashboard.updateTasks(state.canvas);
    dashboard.refreshColony(state.agents);
    if (state.colony) dashboard.updateColonyFromServer(state.colony);
    if (state.canvas?.goal) {
      setActiveGoal(state.canvas.goal);
      if (!promptInput.value) promptInput.value = state.canvas.goal;
    }
    updateStatus(state);
  }

  if (scene) {
    scene.onAgentSelect = (agent) => {
      if (!agent) { inspectPanel.classList.add("hidden"); return; }
      inspectPanel.classList.remove("hidden");
      api(`/agents/${agent.id}`).then((deps) => {
        inspectPanel.innerHTML = `
          <strong>${agent.name}</strong> · ${roleLabel(agent.role)}<br/>
          Zone ${Math.floor(agent.grid_x / 12)}-${Math.floor(agent.grid_y / 12)}<br/>
          ${agent.verbs.join(" · ")}<br/>
          <em>${agent.adjectives.join(", ")}</em><br/>
          Deps: ${deps.incoming?.length ?? 0} in / ${deps.outgoing?.length ?? 0} out
        `;
      });
    };

    scene.onMovement = (agent, from) => dashboard.logMovement(agent, from);
  }

  sse.connect();
  sse.onAll((event: SimEvent) => {
    scene?.handleEvent(event);
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
}

function updateStatus(state: Record<string, unknown>) {
  tickLabel.textContent = `Tick ${state.tick ?? 0}`;
  phaseLabel.textContent = String(state.design_phase ?? "concept");
  regretLabel.textContent = typeof state.regret === "number" ? `Regret ${state.regret.toFixed(2)}` : "Regret —";
  modeLabel.textContent = String(state.execution_mode ?? "idle");
}

init();