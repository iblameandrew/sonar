import { renderMarkdown } from "../markdown";

export class AnswerModal {
  private backdrop: HTMLElement;
  private body: HTMLElement;
  private lastMarkdown = "";

  constructor() {
    this.backdrop = document.getElementById("answer-modal")!;
    this.body = document.getElementById("answer-modal-body")!;

    document.getElementById("answer-modal-close")!.onclick = () => this.hide();
    document.getElementById("answer-modal-backdrop")!.onclick = (e) => {
      if (e.target === e.currentTarget) this.hide();
    };
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.backdrop.classList.contains("hidden")) this.hide();
    });
  }

  show(markdown: string): void {
    this.lastMarkdown = markdown;
    this.body.innerHTML = renderMarkdown(markdown);
    this.backdrop.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  hide(): void {
    this.backdrop.classList.add("hidden");
    document.body.style.overflow = "";
  }

  clearAndHide(): void {
    this.lastMarkdown = "";
    this.body.innerHTML = "";
    this.hide();
    this.setViewAnswerButtonVisible(false);
  }

  setMarkdown(markdown: string): void {
    this.lastMarkdown = markdown;
  }

  getLastMarkdown(): string {
    return this.lastMarkdown;
  }

  setViewAnswerButtonVisible(visible: boolean): void {
    const btn = document.getElementById("btn-view-answer") as HTMLButtonElement | null;
    if (!btn) return;
    btn.classList.toggle("hidden", !visible);
    btn.disabled = !visible || !this.lastMarkdown;
  }
}