import type { TpChangeEvent } from "@tweakpane/core";
import { Pane } from "tweakpane";
import type { VoxelScene } from "../scene/VoxelScene";

export class Controls {
  private pane: Pane;

  constructor(
    scene: VoxelScene,
    callbacks: {
      onStart: () => void;
      onPause: () => void;
      onStep: () => void;
      onSpeed: (v: number) => void;
      onSeason: (macro: string, micro: string) => void;
      onScreenshot: () => void;
      onExport: () => void;
    }
  ) {
    this.pane = new Pane({ title: "ATTENTION AGENT", expanded: true });

    const sim = this.pane.addFolder({ title: "Simulation" });
    sim.addButton({ title: "Start" }).on("click", callbacks.onStart);
    sim.addButton({ title: "Pause/Resume" }).on("click", callbacks.onPause);
    sim.addButton({ title: "Step" }).on("click", callbacks.onStep);
    sim.addBinding({ speed: 1 }, "speed", { min: 0.1, max: 5, step: 0.1 }).on("change", (ev: TpChangeEvent<number>) => {
      callbacks.onSpeed(ev.value);
    });

    const season = this.pane.addFolder({ title: "Season" });
    const seasonState = { macro: "sharp", micro: "harvest" };
    season.addBinding(seasonState, "macro", {
      options: { Sharp: "sharp", Diffuse: "diffuse" },
    });
    season.addBinding(seasonState, "micro", {
      options: {
        Harvest: "harvest",
        Scarcity: "scarcity",
        Planting: "planting",
        Festival: "festival",
      },
    });
    season.addButton({ title: "Force Season" }).on("click", () => {
      callbacks.onSeason(seasonState.macro, seasonState.micro);
      scene.transitionSeason(seasonState.micro);
    });

    const layers = this.pane.addFolder({ title: "Layers", expanded: true });
    const layerKeys = Object.keys(scene.layers) as (keyof typeof scene.layers)[];
    for (const key of layerKeys) {
      layers
        .addBinding(scene.layers, key, { label: key })
        .on("change", () => scene.applyLayers());
    }

    const kinds = this.pane.addFolder({ title: "Dependency Kinds" });
    const kindState = {
      economic: true,
      kinship: true,
      prestige: true,
      conflict: true,
      sustenance: true,
      craft: true,
      ritual: true,
    };
    for (const kind of Object.keys(kindState) as (keyof typeof kindState)[]) {
      kinds.addBinding(kindState, kind).on("change", (ev: TpChangeEvent<boolean>) => {
        scene.connectionManager.toggleKind(kind, ev.value);
      });
    }

    const exportFolder = this.pane.addFolder({ title: "Export" });
    exportFolder.addButton({ title: "Screenshot" }).on("click", callbacks.onScreenshot);
    exportFolder.addButton({ title: "Export glTF" }).on("click", callbacks.onExport);
  }
}