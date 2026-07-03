import { SSEClient } from "./sse/client";
import { formatSystemPrompt } from "./agentPrompt";
import { roleLabel } from "./agentRoles";
import type { Dashboard } from "./ui/Dashboard";
import { AnswerModal } from "./ui/AnswerModal";
import type { PolicyPreview, AttentionPolicy } from "./attentionPolicy";
import type { Agent, ColonyInfo, ComparisonMetrics, ProjectCanvas, SimEvent } from "./types";
import type { QwenStatus } from "./ui/Dashboard";
import { saveAnswerMaxTokens } from "./storage/simSettings";

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
let answerModal: AnswerModal;
const sse = new SSEClient();
let colonyRefreshTick = 0;
let deployInFlight = false;
let colonyRunning = false;
let pollTimer: number | null = null;
let pollSnapshot = { tick: -1, playbookLen: 0, running: false };
let liveTick = 0;
let liveMaxTicks = 12;
/** Raw graph phase from API/SSE only — never a formatted display string. */
let livePhaseRaw = "idle";
let livePlaybookLen = 0;
let currentRunId = "";

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
  scene?.setColonyPurpose(goal);
}

function syncDeployButtons(): void {
  const blocked = deployInFlight || colonyRunning;
  for (const id of ["btn-solve", "btn-society"]) {
    const btn = document.getElementById(id) as HTMLButtonElement | null;
    if (!btn) continue;
    btn.disabled = blocked;
    btn.classList.toggle("is-deploying", deployInFlight);
    btn.classList.toggle("is-running", colonyRunning && !deployInFlight);
    btn.setAttribute("aria-busy", deployInFlight ? "true" : "false");
    btn.title = colonyRunning
      ? "Society simulation is running — wait for completion or refresh after it stops"
      : "";
  }
}

function isColonyActive(s: LiveState): boolean {
  return s.running === true;
}

function setColonyRunning(running: boolean): void {
  colonyRunning = running;
  scene?.setComputing(running);
  syncDeployButtons();
}

function showBootError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("QSA boot failed:", err);
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
  final_answer?: string;
};

function showFinalAnswer(markdown: string, opts?: { autoOpen?: boolean }): void {
  if (!markdown.trim()) return;
  answerModal.setMarkdown(markdown);
  answerModal.setViewAnswerButtonVisible(true);
  if (opts?.autoOpen) answerModal.show(markdown);
}

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

  const wasRunning = colonyRunning;
  const active = isColonyActive(s);
  const goal = s.canvas?.goal ?? "";
  const shouldFinalize = opts?.finalize === true || (wasRunning && !active);

  if (shouldFinalize) {
    dashboard.markRunComplete(liveTick, liveMaxTicks, playbookLen, goal);
    activeGoalEl.textContent = goal
      ? `Complete · tick ${liveTick}/${liveMaxTicks} · ${goal.slice(0, 64)}`
      : `Complete · tick ${liveTick}/${liveMaxTicks}`;
    modeLabel.textContent = "Complete";
    if (s.final_answer) showFinalAnswer(s.final_answer);
    setColonyRunning(false);
    return;
  }

  setColonyRunning(active);
  if (!active) return;

  if (s.live_phase) livePhaseRaw = s.live_phase;
  const phaseDetail = formatPhaseDetail(s);
  syncLiveHud(playbookLen, phaseDetail);
  if (goal) {
    activeGoalEl.textContent = `Tick ${liveTick}/${liveMaxTicks} · ${phaseDetail} · ${goal.slice(0, 56)}`;
  }
}

async function finalizeFromServer(force = false): Promise<void> {
  try {
    const s = await api<LiveState>("/state");
    await applyStateSnapshot(s, { finalize: force });
  } catch {
    setColonyRunning(false);
    dashboard.markRunComplete(liveTick, liveMaxTicks, livePlaybookLen);
  }
}

async function pollSimulationState(): Promise<void> {
  try {
    const s = await api<LiveState>("/state");
    if (!isColonyActive(s)) {
      await applyStateSnapshot(s, { finalize: colonyRunning });
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
    currentRunId = String(event.payload.run_id ?? "");
    liveTick = 0;
    livePhaseRaw = "STARTING";
    livePlaybookLen = 0;
    liveMaxTicks = Number(event.payload.max_ticks ?? 12);
    modeLabel.textContent = "Society";
    setColonyRunning(true);
    deployInFlight = false;
    syncDeployButtons();
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
    const runId = String(event.payload.run_id ?? "");
    if (runId && currentRunId && runId !== currentRunId) return;
    liveTick = Math.max(liveTick, event.tick);
    livePhaseRaw = "complete";
    setColonyRunning(false);
    const edges = Number(event.payload.playbook_edges ?? 0);
    const answer = String(event.payload.final_answer ?? "");
    if (answer && edges > 0) showFinalAnswer(answer, { autoOpen: true });
    stopStatePolling();
    void finalizeFromServer(true);
    api<{ comparison?: ComparisonMetrics }>("/metrics").then((m) => {
      if (m.comparison) dashboard.updateMetrics(m.comparison);
    });
  }
  if (event.type === "sim_error") {
    activeGoalEl.textContent = `Simulation error: ${String(event.payload.message ?? "unknown")}`;
    modeLabel.textContent = "Error";
    setColonyRunning(false);
    stopStatePolling();
  }
}

function wireSseHandlers(): void {
  sse.onConnection((connected) => {
    if (connected) void dashboard.ensureAttentionPolicyLoaded();
    dashboard.updateStreamStatus(connected);
  });
  sse.onAll((event: SimEvent) => {
    applyLiveEvent(event);
  });
}

async function deployColony() {
  if (deployInFlight || colonyRunning) return;

  const prompt = getPrompt();

  try {
    deployInFlight = true;
    syncDeployButtons();
    scene?.setCaActive(true);
    modeLabel.textContent = "Starting…";
    activeGoalEl.textContent = prompt
      ? "Deploying colony…"
      : "Deploying colony with default goal…";

    const hasKey = await dashboard.ensureApiKey();
    if (!hasKey) {
      dashboard.logEvent({
        type: "qwen_offline",
        tick: 0,
        payload: { message: "No API key — running heuristic agents only. Connect in Settings (DashScope or OpenRouter)." },
      });
    }

    sse.reconnect();
    answerModal.clearAndHide();
    currentRunId = "";
    liveTick = 0;
    livePlaybookLen = 0;
    livePhaseRaw = "STARTING";
    dashboard.switchTab("activity");
    dashboard.updateStreamStatus(false, "awaiting events");

    const agentCount = dashboard.getAgentCount();
    const maxTicks = dashboard.getMaxTicks();
    const answerMaxTokens = dashboard.getAnswerMaxTokens();
    saveAnswerMaxTokens(answerMaxTokens);
    const attentionPolicy = dashboard.getAttentionPolicy();
    const started = await api<{ status?: string; goal?: string }>("/sim/society", "POST", {
      max_ticks: maxTicks,
      speed: 1.5,
      agent_count: agentCount,
      prompt,
      attention_policy: attentionPolicy,
      answer_max_tokens: answerMaxTokens,
    });

    startStatePolling();

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
    setColonyRunning(isColonyActive(s));
    if (isColonyActive(s)) {
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
    setColonyRunning(false);
    scene?.setCaActive(false);
  } finally {
    deployInFlight = false;
    syncDeployButtons();
  }
}

async function resetColony(): Promise<void> {
  if (deployInFlight) return;

  stopStatePolling();
  currentRunId = "";
  liveTick = 0;
  livePhaseRaw = "idle";
  livePlaybookLen = 0;
  pollSnapshot = { tick: -1, playbookLen: 0, running: false };

  answerModal.clearAndHide();
  setColonyRunning(false);
  inspectPanel.classList.add("hidden");

  try {
    await api("/sim/reset", "POST");
    const state = await api<LiveState & {
      qwen?: QwenStatus;
      attention_policy?: AttentionPolicy;
      attention_policy_preview?: PolicyPreview[];
    }>("/state");

    scene?.resetColony();
    dashboard.resetColonyUi();
    await hydrateFromState(state);

    tickLabel.textContent = "Tick 0";
    phaseLabel.textContent = "concept";
    regretLabel.textContent = "Regret —";
    modeLabel.textContent = "Idle";
    setActiveGoal("");
    updateStatus(state);
    dashboard.updateStreamStatus(sse.isConnected(), "colony reset");
    dashboard.logEvent({ type: "colony_reset", tick: 0, payload: { message: "Society reset to idle" } }, { force: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    modeLabel.textContent = "Error";
    activeGoalEl.textContent = `Reset failed: ${msg}`;
    setColonyRunning(false);
  }
}

function wireControls(): void {
  document.getElementById("btn-recenter")!.onclick = () => scene?.recenter();
  document.getElementById("btn-view-answer")!.onclick = () => {
    const md = answerModal.getLastMarkdown();
    if (md) answerModal.show(md);
  };
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
  document.getElementById("btn-reset")!.onclick = () => void resetColony();
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
  answerModal = new AnswerModal();
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
    let state = await api<LiveState & {
      qwen?: QwenStatus;
      attention_policy?: AttentionPolicy;
      attention_policy_preview?: PolicyPreview[];
    }>("/state");

    if (
      isColonyActive(state) &&
      (state.tick ?? 0) === 0 &&
      (!state.live_phase || state.live_phase === "idle")
    ) {
      await api("/sim/stop", "POST").catch(() => {});
      state = await api<typeof state>("/state");
    }

    await hydrateFromState(state);
    void dashboard.ensureAttentionPolicyLoaded();
    if (state.final_answer && !isColonyActive(state)) {
      showFinalAnswer(state.final_answer, { autoOpen: false });
    }
    setColonyRunning(isColonyActive(state));
    if (isColonyActive(state)) {
      scene?.setCaActive(true);
      startStatePolling();
    }
  } catch (err) {
    console.error("Initial state failed:", err);
    activeGoalEl.textContent = "Backend unreachable — start the API server on :8001.";
    void dashboard.ensureAttentionPolicyLoaded();
  }

  if (scene) {
    scene.onAgentSelect = (agent) => {
      if (!agent) { inspectPanel.classList.add("hidden"); return; }
      inspectPanel.classList.remove("hidden");
      api<{ incoming?: unknown[]; outgoing?: unknown[] }>(`/agents/${agent.id}`).then((deps) => {
        const prompt = formatSystemPrompt(agent, activeGoalEl.textContent.replace(/^Solving: /, ""));
        inspectPanel.innerHTML = `
          <strong>${agent.name}</strong> · ${roleLabel(agent.role)}<br/>
          Zone ${Math.floor(agent.grid_x / 12)}-${Math.floor(agent.grid_y / 12)}<br/>
          <pre class="inspect-prompt">${prompt.replace(/</g, "&lt;")}</pre>
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