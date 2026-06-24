import { VoxelScene } from "./scene/VoxelScene";
import { SSEClient } from "./sse/client";
import { InspectPanel } from "./ui/InspectPanel";
import { Minimap } from "./ui/Minimap";
import { Controls } from "./ui/Controls";
import type { Agent, DependencyEntry, SimEvent, StateSnapshot } from "./types";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const tickLabel = document.getElementById("tick-label")!;
const seasonLabel = document.getElementById("season-label")!;
const regretLabel = document.getElementById("regret-label")!;

const scene = new VoxelScene(canvas);
const sse = new SSEClient();
const inspect = new InspectPanel("inspect-panel");
const minimap = new Minimap("minimap");

let connectionIndex: { from: string; to: string; color: string }[] = [];

async function fetchState(): Promise<StateSnapshot | null> {
  try {
    const res = await fetch("/api/state");
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchAgentDeps(agentId: string) {
  try {
    const res = await fetch(`/api/agents/${agentId}`);
    return await res.json();
  } catch {
    return { incoming: [], outgoing: [] };
  }
}

async function init() {
  const state = await fetchState();
  if (state?.agents?.length) {
    scene.loadSnapshot(
      state.agents,
      state.institutions ?? [],
      (state.playbook ?? []) as DependencyEntry[]
    );
    updateStatus(state);
  }

  sse.connect();
  sse.onAll((event: SimEvent) => {
    scene.handleEvent(event);
    if (event.type === "attention_judgment") {
      const p = event.payload as unknown as DependencyEntry;
      connectionIndex.push({
        from: p.from_id,
        to: p.to_id,
        color: p.kind,
      });
    }
    if (event.tick) {
      tickLabel.textContent = `Tick: ${event.tick}`;
    }
    if (event.type === "season_change") {
      seasonLabel.textContent = `Season: ${event.payload.macro_season}/${event.payload.micro_season}`;
    }
    if (event.type === "auditor_regret") {
      regretLabel.textContent = `Regret: ${(event.payload.regret as number).toFixed(2)}`;
    }
  });

  scene.onAgentSelect = async (agent: Agent | null) => {
    if (!agent) {
      inspect.hide();
      return;
    }
    const deps = await fetchAgentDeps(agent.id);
    inspect.show(agent, deps.incoming, deps.outgoing);
  };

  new Controls(scene, {
    onStart: async () => {
      await fetch("/api/sim/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_count: 10, max_ticks: 200, speed: 1 }),
      });
      const s = await fetchState();
      if (s) {
        scene.loadSnapshot(s.agents, s.institutions ?? [], (s.playbook ?? []) as DependencyEntry[]);
        updateStatus(s);
      }
    },
    onPause: () => fetch("/api/sim/pause", { method: "POST" }),
    onStep: () => fetch("/api/sim/step", { method: "POST" }),
    onSpeed: (v) =>
      fetch("/api/sim/speed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speed: v }),
      }),
    onSeason: (macro, micro) =>
      fetch("/api/season/force", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ macro_season: macro, micro_season: micro }),
      }),
    onScreenshot: () => {
      const url = scene.screenshot();
      const a = document.createElement("a");
      a.href = url;
      a.download = "attention-agent.png";
      a.click();
    },
    onExport: () => scene.exportGLTF(),
  });

  function animate() {
    requestAnimationFrame(animate);
    scene.render();
    if (scene.layers.minimap) {
      minimap.setVisible(true);
      minimap.update(scene.getAgentPositions(), connectionIndex);
    } else {
      minimap.setVisible(false);
    }
  }
  animate();
}

function updateStatus(state: StateSnapshot) {
  tickLabel.textContent = `Tick: ${state.tick}`;
  seasonLabel.textContent = `Season: ${state.macro_season ?? "—"}/${state.micro_season ?? "—"}`;
  regretLabel.textContent = `Regret: ${state.regret?.toFixed(2) ?? "—"}`;
}

init();