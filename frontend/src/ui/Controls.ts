import type { TpChangeEvent } from "@tweakpane/core";
import { Pane } from "tweakpane";
import type { PixelLifeScene } from "../scene/PixelLifeScene";

export class LayerControls {
  private pane: Pane;

  constructor(scene: PixelLifeScene) {
    this.pane = new Pane({ title: "Layers", expanded: false });
    const keys = Object.keys(scene.layers) as (keyof typeof scene.layers)[];
    for (const key of keys) {
      this.pane
        .addBinding(scene.layers, key, { label: key })
        .on("change", () => scene.applyLayers());
    }
    this.pane.addBinding({ speed: 1 }, "speed", { min: 0.1, max: 5, step: 0.1 }).on("change", (ev: TpChangeEvent<number>) => {
      fetch("/api/sim/speed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speed: ev.value }),
      });
    });
  }
}