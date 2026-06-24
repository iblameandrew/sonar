import { SSEClient } from "./sse/client";
import { roleLabel } from "./agentRoles";
import type { Dashboard } from "./ui/Dashboard";
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

let scene: import("./scene/colony-scene").ColonyScene | null = null;
let dashboard: Dashboard;
const sse = new SSEClient();
let colonyRefreshTick = 0;
let deploying = false;

async function api<T = Record<string, unknown>>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text };
    }
  }
  if (!res.ok) {
    const detail =
      typeof data === "object" && data && "detail" in data
        ? String((data as { detail: unknown }).detail)
        : res.statusText;
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return data as T;
}

function getPrompt(): string {
  return promptInput.value.trim();
}

function setActiveGoal(goal: string): void {
  activeGoalEl.textContent = goal ? `Solving: ${goal}` : "";
}

function setDeployButtonsActive(active: boolean): void {
  deploying = active;
  for (const id of ["btn-solve", "btn-society"]) {
    const btn = document.getElementById(id) as HTMLButtonElement | null;
    if (!btn) continue;
    btn.disabled = active;
    btn.classList.toggle("is-deploying", active);
    btn.setAttribute("aria-busy", active ? "true" : "false");
  }
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

function wireSseHandlers(): void {
  sse.onAll((event: SimEvent) => {
    scene?.handleEvent(event);
    dashboard.logEvent(event);
    if (event.type === "negotiation_round" || event.type === "conflict_resolved") {
      dashboard.addNegotiation(event.payload as never);
    }
    if (event.type === "society_metrics" || event.type === "comparison_metrics") {
      dashboard.updateMetrics(event.payload as unknown as ComparisonMetrics);
    }
    if (event.type === "qwen_usage") dashboard.updateQwen(event.payload as never);
    if (event.type === "task_decomposed" || event.type === "messenger_propose") {
      api<ProjectCanvas>("/canvas").then((c) => dashboard.updateTasks(c));
    }
    if (event.type === "simulation_started") {
      modeLabel.textContent = "Society";
      setDeployButtonsActive(false);
      dashboard.switchTab("activity");
    }
    if (event.type === "tick_started") {
      activeGoalEl.textContent = `Tick ${event.tick} / ${event.payload.max_ticks ?? "?"} — agents computing…`;
    }
    if (event.tick !== undefined) tickLabel.textContent = `Tick ${event.tick}`;
    if (event.type === "phase_change") phaseLabel.textContent = String(event.payload.design_phase ?? "?");
    if (event.type === "auditor_regret") regretLabel.textContent = `Regret ${(event.payload.regret as number).toFixed(2)}`;
    if (event.type === "sim_complete") {
      modeLabel.textContent = String(event.payload.mode);
      setDeployButtonsActive(false);
      api<{ comparison?: ComparisonMetrics }>("/metrics").then((m) => {
        if (m.comparison) dashboard.updateMetrics(m.comparison);
      });
    }
    if (event.type === "sim_error") {
      activeGoalEl.textContent = `Simulation error: ${String(event.payload.message ?? "unknown")}`;
      modeLabel.textContent = "Error";
      setDeployButtonsActive(false);
    }
  });
}

async function deployColony() {
  if (deploying) return;

  const prompt = getPrompt();

  try {
    setDeployButtonsActive(true);
    modeLabel.textContent = "Starting…";
    activeGoalEl.textContent = prompt
      ? "Deploying colony…"
      : "Deploying colony with default goal…";

    const hasKey = await dashboard.ensureApiKey();
    if (!hasKey) {
      dashboard.logEvent({
        type: "qwen_offline",
        tick: 0,
        payload: { message: "No API key — running heuristic agents only. Connect in Settings for Qwen Cloud." },
      });
    }

    const agentCount = dashboard.getAgentCount();
    const started = await api<{ status?: string; goal?: string }>("/sim/society", "POST", {
      max_ticks: 80,
      speed: 1.5,
      agent_count: agentCount,
      prompt,
    });

    dashboard.switchTab("activity");
    dashboard.logEvent({
      type: "simulation_started",
      tick: 0,
      payload: { goal: started.goal ?? prompt, local: true },
    });

    const s = await api<{
      agents?: Agent[];
      canvas?: ProjectCanvas;
      colony?: ColonyInfo;
      tick?: number;
      design_phase?: string;
      regret?: number;
      execution_mode?: string;
      running?: boolean;
    }>("/state");

    scene?.loadAgents(s.agents ?? []);
    dashboard.updateTasks(s.canvas);
    dashboard.refreshColony(s.agents);
    if (s.colony) dashboard.updateColonyFromServer(s.colony);
    const goal = s.canvas?.goal ?? started.goal ?? prompt;
    if (goal) setActiveGoal(goal);
    updateStatus(s);
    modeLabel.textContent = s.running ? "Society" : String(s.execution_mode ?? "Society");
    activeGoalEl.textContent = goal ? `Solving: ${goal}` : "Colony running";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Deploy failed:", err);
    modeLabel.textContent = "Idle";
    activeGoalEl.textContent = `Deploy failed: ${msg}`;
    dashboard.logEvent({ type: "deploy_failed", tick: 0, payload: { message: msg } });
    dashboard.switchTab("activity");
    setDeployButtonsActive(false);
  }
}

function wireControls(): void {
  document.getElementById("btn-solve")!.onclick = () => void deployColony();
  document.getElementById("btn-society")!.onclick = () => void deployColony();
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

async function hydrateFromState(state: {
  qwen?: QwenStatus;
  agents?: Agent[];
  canvas?: ProjectCanvas;
  colony?: ColonyInfo;
  tick?: number;
  design_phase?: string;
  regret?: number;
  execution_mode?: string;
}): Promise<void> {
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
}

async function init() {
  const { Dashboard: DashboardCtor } = await import("./ui/Dashboard");
  try {
    const { ColonyScene: ColonySceneCtor } = await import("./scene/colony-scene");
    scene = new ColonySceneCtor(canvas);
    dashboard = new DashboardCtor(scene);
    startRenderLoop();
  } catch (err) {
    showBootError(err);
    dashboard = new DashboardCtor();
  }

  wireControls();
  wireSseHandlers();
  sse.connect();

  try {
    await dashboard.loadQwen();
  } catch (err) {
    console.error("Qwen status failed:", err);
  }

  try {
    const state = await api<{
      qwen?: QwenStatus;
      agents?: Agent[];
      canvas?: ProjectCanvas;
      colony?: ColonyInfo;
      tick?: number;
      design_phase?: string;
      regret?: number;
      execution_mode?: string;
    }>("/state");
    await hydrateFromState(state);
  } catch (err) {
    console.error("Initial state failed:", err);
    activeGoalEl.textContent = "Backend unreachable — start the API server on :8000.";
  }

  if (scene) {
    scene.onAgentSelect = (agent) => {
      if (!agent) { inspectPanel.classList.add("hidden"); return; }
      inspectPanel.classList.remove("hidden");
      api<{ incoming?: unknown[]; outgoing?: unknown[] }>(`/agents/${agent.id}`).then((deps) => {
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
}

function updateStatus(state: Record<string, unknown>) {
  tickLabel.textContent = `Tick ${state.tick ?? 0}`;
  phaseLabel.textContent = String(state.design_phase ?? "concept");
  regretLabel.textContent = typeof state.regret === "number" ? `Regret ${state.regret.toFixed(2)}` : "Regret —";
  modeLabel.textContent = String(state.execution_mode ?? "idle");
}

init();