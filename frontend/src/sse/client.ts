import type { SimEvent } from "../types";

export type EventHandler = (event: SimEvent) => void;
export type ConnectionHandler = (connected: boolean) => void;

export class SSEClient {
  private source: EventSource | null = null;
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private globalHandlers: Set<EventHandler> = new Set();
  private connectionHandlers: Set<ConnectionHandler> = new Set();
  private streamUrl = "/api/stream";
  private reconnectTimer: number | null = null;

  connect(url = "/api/stream"): void {
    this.streamUrl = url;
    this.disconnect();
    this.source = new EventSource(url);
    this.source.onopen = () => {
      this.notifyConnection(true);
    };
    this.source.onmessage = (msg) => {
      try {
        let raw = msg.data.trim();
        if (raw.startsWith("data:")) {
          raw = raw.slice(raw.indexOf(":") + 1).trim();
        }
        const event: SimEvent = JSON.parse(raw);
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
      this.notifyConnection(false);
      this.scheduleReconnect();
    };
  }

  reconnect(): void {
    this.connect(this.streamUrl);
  }

  isConnected(): boolean {
    return this.source?.readyState === EventSource.OPEN;
  }

  onConnection(handler: ConnectionHandler): void {
    this.connectionHandlers.add(handler);
  }

  private notifyConnection(connected: boolean): void {
    this.connectionHandlers.forEach((h) => h(connected));
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(this.streamUrl);
    }, 2000);
  }

  disconnect(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.source?.close();
    this.source = null;
    this.notifyConnection(false);
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