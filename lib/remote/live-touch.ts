export type TouchPoint = { x: number; y: number };
export type TouchPacket = TouchPoint & { type: "touch"; v: 1; touchId: string; phase: "down" | "move" | "up" | "cancel" };
export interface TouchClock { setInterval(callback: () => void, ms: number): number; clearInterval(id: number): void }

/** Latest movement at 32ms; stationary heartbeat only every 512ms. */
export class LiveTouchSender {
  private timer: number | null = null;
  private active = false;
  private point: TouchPoint;
  private lastPoint: TouchPoint;
  private elapsed = 0;
  private sentAt = 0;
  constructor(private send: (packet: TouchPacket) => boolean, private clock: TouchClock, point: TouchPoint, private id: string, private failed: () => void) {
    this.point = point;
    this.lastPoint = point;
    this.active = this.packet("down");
    if (this.active) this.timer = clock.setInterval(() => {
      if (!this.active) return;
      this.elapsed += 32;
      const changed = this.point.x !== this.lastPoint.x || this.point.y !== this.lastPoint.y;
      if (!changed && this.elapsed - this.sentAt < 500) return;
      if (!this.packet("move")) { this.finish("cancel"); this.failed(); }
      else { this.lastPoint = this.point; this.sentAt = this.elapsed; }
    }, 32);
  }
  get started() { return this.active; }
  move(point: TouchPoint) { this.point = point; }
  finish(phase: "up" | "cancel", point = this.point) {
    if (this.timer !== null) this.clock.clearInterval(this.timer);
    this.timer = null;
    this.point = point;
    if (this.active) this.packet(phase);
    this.active = false;
  }
  private packet(phase: TouchPacket["phase"]) {
    return this.send({ type: "touch", v: 1, touchId: this.id, phase, x: Math.max(0, Math.min(1, this.point.x)), y: Math.max(0, Math.min(1, this.point.y)) });
  }
}
