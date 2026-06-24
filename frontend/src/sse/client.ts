import type { SimEvent } from "../types";

export type EventHandler = (event: SimEvent) => void;

export class SSEClient {
  private source: EventSource | null = null;
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private globalHandlers: Set<EventHandler> = new Set();

  connect(url = "/api/stream"): void {
    this.disconnect();
    this.source = new EventSource(url);
    this.source.onmessage = (msg) => {
      try {
        const event: SimEvent = JSON.parse(msg.data);
        if (event.type === "heartbeat") return;
        this.globalHandlers.forEach((h) => h(event));
        const typed = this.handlers.get(event.type);
        typed?.forEach((h) => h(event));
        const wildcard = this.handlers.get("*");
        wildcard?.forEach((h) => h(event));
      } catch {
        /* ignore parse errors */
      }
    };
    this.source.onerror = () => {
      setTimeout(() => this.connect(url), 3000);
    };
  }

  disconnect(): void {
    this.source?.close();
    this.source = null;
  }

  on(type: string, handler: EventHandler): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
  }

  onAll(handler: EventHandler): void {
    this.globalHandlers.add(handler);
  }

  off(type: string, handler: EventHandler): void {
    this.handlers.get(type)?.delete(handler);
  }
}