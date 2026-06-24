import { SSEClient } from "./sse/client";
import { roleLabel } from "./agentRoles";
import type { Dashboard } from "./ui/Dashboard";
import type { PolicyPreview, AttentionPolicy } from "./attentionPolicy";
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
let pollTimer: number | null = null;
let pollSnapshot = { tick: -1, playbookLen: 0, running: false };
let liveTick = 0;
let liveMaxTicks = 80;
/** Raw graph phase from API/SSE only — never a formatted display string. */
let livePhaseRaw = "idle";
let livePlaybookLen = 0;

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

type LiveState = {
  tick?: number;
  max_ticks?: number;
  running?: boolean;
  design_phase?: string;
  regret?: number;
  execution_mode?: string;
  agents?: Agent[];
  canvas?: ProjectCanvas;
  colony?: ColonyInfo;
  playbook?: unknown[];
  live_phase?: string;
  live_attention?: { done?: number; total?: number; matched?: number };
};

function formatPhaseDetail(s: LiveState): string {
  const phase = s.live_phase ?? livePhaseRaw;
  const att = s.live_attention;
  if (phase === "ATTEND" && att?.total) {
    return `ATTEND ${att.done ?? 0}/${att.total}`;
  }
  return phase;
}

function stopStatePolling(): void {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
  pollSnapshot = { tick: -1, playbookLen: 0, running: false };
}

function syncLiveHud(playbookLen = livePlaybookLen, phaseDetail = livePhaseRaw): void {
  const tick = Math.max(liveTick, pollSnapshot.tick);
  dashboard.updateRunProgress(tick, liveMaxTicks, playbookLen, phaseDetail, { force: true });
  tickLabel.textContent = `Tick ${tick}`;
  if (phaseDetail && phaseDetail !== "idle") {
    phaseLabel.textContent = phaseDetail;
  }
}

async function applyStateSnapshot(s: LiveState, opts?: { finalize?: boolean }): Promise<void> {
  const playbookLen = Array.isArray(s.playbook) ? s.playbook.length : livePlaybookLen;
  livePlaybookLen = playbookLen;
  liveMaxTicks = s.max_ticks ?? liveMaxTicks;
  liveTick = Math.max(liveTick, s.tick ?? 0);
  pollSnapshot.tick = s.tick ?? pollSnapshot.tick;
  pollSnapshot.playbookLen = playbookLen;

  scene?.loadAgents(s.agents ?? []);
  dashboard.updateTasks(s.canvas);
  dashboard.refreshColony(s.agents);
  if (s.colony) dashboard.updateColonyFromServer(s.colony);
  updateStatus({ ...s, tick: liveTick });

  const goal = s.canvas?.goal ?? "";
  if (opts?.finalize || !s.running) {
    dashboard.markRunComplete(liveTick, liveMaxTicks, playbookLen, goal);
    activeGoalEl.textContent = goal
      ? `Complete · tick ${liveTick}/${liveMaxTicks} · ${goal.slice(0, 64)}`
      : `Complete · tick ${liveTick}/${liveMaxTicks}`;
    modeLabel.textContent = "Complete";
    setDeployButtonsActive(false);
    return;
  }

  if (s.live_phase) livePhaseRaw = s.live_phase;
  const phaseDetail = formatPhaseDetail(s);
  syncLiveHud(playbookLen, phaseDetail);
  if (goal) {
    activeGoalEl.textContent = `Tick ${liveTick}/${liveMaxTicks} · ${phaseDetail} · ${goal.slice(0, 56)}`;
  }
}

async function finalizeFromServer(): Promise<void> {
  try {
    const s = await api<LiveState>("/state");
    await applyStateSnapshot(s, { finalize: !s.running });
  } catch {
    dashboard.markRunComplete(liveTick, liveMaxTicks, livePlaybookLen);
  }
}

async function pollSimulationState(): Promise<void> {
  try {
    const s = await api<LiveState>("/state");
    if (!s.running) {
      await applyStateSnapshot(s, { finalize: true });
      stopStatePolling();
      return;
    }

    await applyStateSnapshot(s);
  } catch {
    dashboard.updateStreamStatus(sse.isConnected(), "state poll failed");
  }
}

function startStatePolling(): void {
  stopStatePolling();
  pollSnapshot.running = true;
  void pollSimulationState();
  pollTimer = window.setInterval(() => void pollSimulationState(), 1000);
}

function applyLiveEvent(event: SimEvent): void {
  scene?.handleEvent(event);
  dashboard.logEvent(event);

  if (event.type === "negotiation_round" || event.type === "conflict_resolved") {
    dashboard.addNegotiation(event.payload as Record<string, unknown>);
  }
  if (event.type === "society_metrics" || event.type === "comparison_metrics") {
    dashboard.updateMetrics(event.payload as unknown as ComparisonMetrics);
  }
  if (event.type === "qwen_usage") dashboard.updateQwen(event.payload as never);
  if (event.type === "task_decomposed" || event.type === "messenger_propose") {
    api<ProjectCanvas>("/canvas").then((c) => dashboard.updateTasks(c));
  }
  if (event.type === "attention_policy_configured") {
    dashboard.updateActiveAttentionPolicy(
      event.payload.policy as never,
      event.payload.preview as never,
    );
  }
  if (event.type === "simulation_started") {
    liveTick = 0;
    livePhaseRaw = "STARTING";
    livePlaybookLen = 0;
    liveMaxTicks = Number(event.payload.max_ticks ?? 80);
    modeLabel.textContent = "Society";
    setDeployButtonsActive(false);
    dashboard.switchTab("activity");
    startStatePolling();
    syncLiveHud(0, "deployed");
  }
  if (event.type === "tick_started") {
    liveTick = event.tick;
    liveMaxTicks = Number(event.payload.max_ticks ?? liveMaxTicks);
    livePlaybookLen = Number(event.payload.playbook_edges ?? livePlaybookLen);
    livePhaseRaw = "STARTING";
    syncLiveHud(livePlaybookLen, livePhaseRaw);
  }
  if (event.type === "tick_phase") {
    liveTick = Math.max(liveTick, event.tick);
    livePhaseRaw = String(event.payload.phase ?? livePhaseRaw);
    syncLiveHud(livePlaybookLen, formatPhaseDetail({ live_phase: livePhaseRaw }));
  }
  if (event.type === "attention_progress" && event.payload.source !== "poll") {
    liveTick = Math.max(liveTick, event.tick);
    livePlaybookLen = Number(event.payload.matched ?? livePlaybookLen);
    livePhaseRaw = "ATTEND";
    syncLiveHud(
      livePlaybookLen,
      `ATTEND ${event.payload.done}/${event.payload.total}`,
    );
  }
  if (event.tick !== undefined) {
    liveTick = Math.max(liveTick, event.tick);
    tickLabel.textContent = `Tick ${liveTick}`;
  }
  if (event.type === "phase_change") phaseLabel.textContent = String(event.payload.design_phase ?? "?");
  if (event.type === "auditor_regret") regretLabel.textContent = `Regret ${(event.payload.regret as number).toFixed(2)}`;
  if (event.type === "sim_complete") {
    liveTick = Math.max(liveTick, event.tick);
    livePhaseRaw = "complete";
    stopStatePolling();
    void finalizeFromServer();
    api<{ comparison?: ComparisonMetrics }>("/metrics").then((m) => {
      if (m.comparison) dashboard.updateMetrics(m.comparison);
    });
  }
  if (event.type === "sim_error") {
    activeGoalEl.textContent = `Simulation error: ${String(event.payload.message ?? "unknown")}`;
    modeLabel.textContent = "Error";
    setDeployButtonsActive(false);
    stopStatePolling();
  }
}

function wireSseHandlers(): void {
  sse.onConnection((connected) => {
    dashboard.updateStreamStatus(connected);
  });
  sse.onAll((event: SimEvent) => {
    applyLiveEvent(event);
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

    sse.reconnect();
    dashboard.switchTab("activity");
    dashboard.updateStreamStatus(false, "awaiting events");

    const agentCount = dashboard.getAgentCount();
    const attentionPolicy = dashboard.getAttentionPolicy();
    const started = await api<{ status?: string; goal?: string }>("/sim/society", "POST", {
      max_ticks: 80,
      speed: 1.5,
      agent_count: agentCount,
      prompt,
      attention_policy: attentionPolicy,
    });

    startStatePolling();
    setDeployButtonsActive(false);

    const s = await api<LiveState>("/state");

    scene?.loadAgents(s.agents ?? []);
    dashboard.updateTasks(s.canvas);
    dashboard.refreshColony(s.agents);
    if (s.colony) dashboard.updateColonyFromServer(s.colony);
    const goal = s.canvas?.goal ?? started.goal ?? prompt;
    if (goal) setActiveGoal(goal);
    updateStatus(s);
    modeLabel.textContent = s.running ? "Society" : String(s.execution_mode ?? "Society");
    if (goal) setActiveGoal(goal);
    if (s.running) {
      liveMaxTicks = s.max_ticks ?? liveMaxTicks;
      liveTick = s.tick ?? liveTick;
      if (s.live_phase) livePhaseRaw = s.live_phase;
      syncLiveHud(
        Array.isArray(s.playbook) ? s.playbook.length : 0,
        formatPhaseDetail(s),
      );
    }
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
  attention_policy?: AttentionPolicy;
  attention_policy_preview?: PolicyPreview[];
}): Promise<void> {
    if (state.qwen) dashboard.updateQwen(state.qwen);
    if (state.attention_policy) {
      dashboard.updateActiveAttentionPolicy(
        state.attention_policy as never,
        state.attention_policy_preview as never,
      );
    }
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
    const state = await api<LiveState & {
      qwen?: QwenStatus;
      attention_policy?: AttentionPolicy;
      attention_policy_preview?: PolicyPreview[];
    }>("/state");
    await hydrateFromState(state);
    if (state.running) startStatePolling();
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