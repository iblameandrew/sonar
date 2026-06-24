import { PixelLifeScene } from "./scene/PixelLifeScene";
import { SSEClient } from "./sse/client";
import { Dashboard } from "./ui/Dashboard";
import { LayerControls } from "./ui/Controls";
import type { Agent, ComparisonMetrics, ProjectCanvas, SimEvent } from "./types";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const tickLabel = document.getElementById("tick-label")!;
const phaseLabel = document.getElementById("phase-label")!;
const regretLabel = document.getElementById("regret-label")!;
const modeLabel = document.getElementById("mode-label")!;
const inspectPanel = document.getElementById("inspect-panel")!;

const scene = new PixelLifeScene(canvas);
const sse = new SSEClient();
const dashboard = new Dashboard();

async function api(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function init() {
  const state = await api("/state");
  if (state.agents?.length) {
    scene.loadAgents(state.agents as Agent[]);
    if (state.canvas?.voxforge_voxels) {
      scene.loadVoxForge(state.canvas.voxforge_voxels);
    }
    dashboard.updateTasks(state.canvas as ProjectCanvas);
    updateStatus(state);
  }

  sse.connect();
  sse.onAll((event: SimEvent) => {
    scene.handleEvent(event);
    dashboard.logEvent(event);

    if (event.type === "negotiation_round" || event.type === "conflict_resolved") {
      dashboard.addNegotiation(event.payload as never);
    }
    if (event.type === "society_metrics" || event.type === "comparison_metrics") {
      dashboard.updateMetrics(event.payload as unknown as ComparisonMetrics);
    }
    if (event.type === "task_decomposed" || event.type === "messenger_propose") {
      api("/canvas").then((c) => dashboard.updateTasks(c));
    }
    if (event.tick) tickLabel.textContent = `Tick: ${event.tick}`;
    if (event.type === "phase_change") {
      phaseLabel.textContent = `Phase: ${(event.payload.design_phase as string) || "?"}`;
    }
    if (event.type === "auditor_regret") {
      regretLabel.textContent = `Regret: ${(event.payload.regret as number).toFixed(2)}`;
    }
    if (event.type === "sim_complete") {
      modeLabel.textContent = `Mode: ${event.payload.mode} complete`;
      api("/metrics").then((m) => {
        if (m.comparison) dashboard.updateMetrics(m.comparison);
      });
    }
  });

  scene.onAgentSelect = (agent) => {
    if (!agent) {
      inspectPanel.classList.add("hidden");
      return;
    }
    inspectPanel.classList.remove("hidden");
    api(`/agents/${agent.id}`).then((deps) => {
      inspectPanel.innerHTML = `
        <strong>${agent.name}</strong> (${agent.role})<br/>
        Verbs: ${agent.verbs.join(", ")}<br/>
        Nouns: ${agent.nouns.join(", ")}<br/>
        Adjectives: ${agent.adjectives.join(", ")}<br/>
        Task: ${agent.current_task_id ?? "none"}<br/>
        Deps in: ${deps.incoming?.length ?? 0} out: ${deps.outgoing?.length ?? 0}
      `;
    });
  };

  document.getElementById("btn-society")!.onclick = async () => {
    modeLabel.textContent = "Mode: society";
    await api("/sim/society", "POST", { max_ticks: 80, speed: 1.5 });
    const s = await api("/state");
    scene.loadAgents(s.agents);
    dashboard.updateTasks(s.canvas);
    updateStatus(s);
  };

  document.getElementById("btn-baseline")!.onclick = async () => {
    modeLabel.textContent = "Mode: baseline";
    await api("/sim/baseline", "POST", { max_ticks: 40, speed: 1 });
  };

  document.getElementById("btn-conflict")!.onclick = () => api("/sim/inject-conflict", "POST");
  document.getElementById("btn-step")!.onclick = () => api("/sim/step", "POST");
  document.getElementById("btn-phase")!.onclick = () => api("/sim/advance-phase", "POST");
  document.getElementById("btn-metrics")!.onclick = () => {
    api("/metrics").then((m) => {
      if (m.comparison) dashboard.updateMetrics(m.comparison);
      dashboard.showMetricsPanel();
    });
  };
  document.getElementById("btn-pause")!.onclick = () => api("/sim/pause", "POST");

  new LayerControls(scene);

  function animate() {
    requestAnimationFrame(animate);
    scene.render();
  }
  animate();
}

function updateStatus(state: Record<string, unknown>) {
  tickLabel.textContent = `Tick: ${state.tick ?? 0}`;
  phaseLabel.textContent = `Phase: ${state.design_phase ?? "concept"}`;
  regretLabel.textContent = `Regret: ${typeof state.regret === "number" ? state.regret.toFixed(2) : "—"}`;
  modeLabel.textContent = `Mode: ${state.execution_mode ?? "idle"}`;
}

init();