import type { Agent } from "../types";

export class InspectPanel {
  private el: HTMLElement;

  constructor(elementId: string) {
    this.el = document.getElementById(elementId)!;
  }

  show(agent: Agent, incoming: unknown[], outgoing: unknown[]): void {
    this.el.classList.remove("hidden");
    this.el.innerHTML = `
      <h3>${agent.id}</h3>
      <div class="field"><span class="label">Verbs:</span> ${agent.verbs.join(", ")}</div>
      <div class="field"><span class="label">Nouns:</span> ${agent.nouns.join(", ")}</div>
      <div class="field"><span class="label">Adjectives:</span> ${agent.adjectives.join(", ")}</div>
      ${agent.institution_id ? `<div class="field"><span class="label">Institution:</span> ${agent.institution_id}</div>` : ""}
      ${agent.parent_ids.length ? `<div class="field"><span class="label">Parents:</span> ${agent.parent_ids.join(", ")}</div>` : ""}
      <div class="field"><span class="label">Incoming deps:</span> ${incoming.length}</div>
      ${this.renderDeps(incoming as Record<string, string>[])}
      <div class="field"><span class="label">Outgoing deps:</span> ${outgoing.length}</div>
      ${this.renderDeps(outgoing as Record<string, string>[])}
    `;
  }

  hide(): void {
    this.el.classList.add("hidden");
  }

  private renderDeps(deps: Record<string, string>[]): string {
    if (!deps.length) return "";
    return deps
      .slice(0, 5)
      .map(
        (d) =>
          `<div style="margin-left:8px;color:#aaa;font-size:10px;">${d.from_id ?? d.from ?? "?"} → ${d.to_id ?? d.to ?? "?"} [${d.kind}/${d.strength}]</div>`
      )
      .join("");
  }
}