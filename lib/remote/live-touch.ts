export type TouchPoint = { x: number; y: number };
export type TouchPacket = TouchPoint & { type: "touch"; v: 1; touchId: string; phase: "down" | "move" | "up" | "cancel" };
export interface TouchClock { setInterval(callback: () => void, ms: number): number; clearInterval(id: number): void }

/** One bounded sample every 40ms, with a heartbeat while stationary. */
export class LiveTouchSender {
  private timer: number | null = null;
  private active = false;
  private point: TouchPoint;
  constructor(private send: (packet: TouchPacket) => boolean, private clock: TouchClock, point: TouchPoint, private id: string, private failed: () => void) {
    this.point = point;
    this.active = this.packet("down");
    if (this.active) this.timer = clock.setInterval(() => {
      if (!this.packet("move")) { this.finish("cancel"); this.failed(); }
    }, 40);
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
