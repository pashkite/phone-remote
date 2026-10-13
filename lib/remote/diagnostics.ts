const SAFE_KEYS = new Set(["state", "type", "status", "code", "mode", "battery", "pollMs", "requests", "bytes", "width", "height", "fps", "latency", "packetLoss", "path", "bitrateKbps", "appVersion"]);
export class Diagnostics {
  private events: { at: string; event: string; data: Record<string, string | number | boolean | null> }[] = [];
  record(event: string, data: Record<string, unknown> = {}) {
    const clean: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(data)) {
      if (SAFE_KEYS.has(key) && (typeof value === "number" || typeof value === "boolean" || value === null || (typeof value === "string" && /^[a-zA-Z0-9_.-]{0,80}$/.test(value)))) clean[key] = value as string | number | boolean | null;
    }
    this.events.push({ at: new Date().toISOString(), event: event.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 60), data: clean });
    this.events = this.events.filter(item => Date.now() - Date.parse(item.at) < 24 * 60 * 60 * 1000).slice(-500);
  }
  export() { return JSON.stringify({ format: 1, platform: "web", events: this.events }, null, 2); }
}
