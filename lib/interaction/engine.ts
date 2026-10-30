import { clampPoint, type InteractionProfile } from "./profiles";
export type Point = { x: number; y: number };
export type PointerSample = Point & { pointerId: string; phase: "down" | "move" | "up" | "cancel" };
export interface InteractionTransport { pointers(points: PointerSample[]): boolean; command(command: Record<string, unknown>): boolean; available(): boolean }
export type AutoState = "stopped" | "running" | "paused";
export interface StandardPad { connected: boolean; mapping: string; axes: readonly number[]; buttons: readonly { pressed: boolean; value: number }[] }
const vectorKeys: Record<string, [number,number]> = { KeyW:[0,-1],ArrowUp:[0,-1],KeyS:[0,1],ArrowDown:[0,1],KeyA:[-1,0],ArrowLeft:[-1,0],KeyD:[1,0],ArrowRight:[1,0] };
export function joystickPoint(profile: InteractionProfile, x: number, y: number): Point {
  const sx=x*profile.sensitivity,sy=y*profile.sensitivity,length = Math.max(1,Math.hypot(sx,sy));
  return clampPoint(profile.joystick.x + sx/length*profile.joystick.radius, profile.joystick.y+sy/length*profile.joystick.radius);
}
/** No timers hidden here: caller supplies monotonic tick, allowing deterministic cancellation tests. */
export class InteractionEngine {
  private active = new Map<string, Point & { expires: number }>();
  private keys = new Set<string>();
  private padButtons = new Set<string>();
  private padVector: [number,number] = [0,0];
  private wheelDelta = 0;
  private nextScroll = 0;
  private heartbeat = 0;
  private dirty = false;
  private now = 0;
  private scrollBusyUntil = 0;
  auto: AutoState = "stopped";
  error: string | null = null;
  constructor(public profile: InteractionProfile, private transport: InteractionTransport) {}
  time(now: number) { if(Number.isFinite(now)&&now>=this.now)this.now=now; }
  setTransport(transport: InteractionTransport) { this.transport=transport; }
  get pointerCount() { return this.active.size; }
  get autoState() { return this.auto; }
  private frame(changed?: PointerSample) {
    const points: PointerSample[] = [...this.active].map(([pointerId,p])=>({pointerId,x:p.x,y:p.y,phase:"move"}));
    if (changed) { const index=points.findIndex(p=>p.pointerId===changed.pointerId); if(index>=0)points[index]=changed; else points.push(changed); }
    if (!this.transport.available() || !this.transport.pointers(points)) { this.fail("입력 전송 실패 · 자동 동작 중지"); return false; }
    this.heartbeat = this.now; this.dirty=false; this.error=null; return true;
  }
  down(id: string, point: Point, duration = Infinity): boolean {
    if (!Number.isFinite(point.x)||!Number.isFinite(point.y)) { this.fail("잘못된 좌표"); return false; }
    if (this.active.has(id)) return true;
    if (this.active.size >= (this.profile.experimentalMulti ? 5 : 1)) { this.error="동시 입력은 멀티터치 실험 동의가 필요합니다 (최대 5개)."; return false; }
    const p=clampPoint(point.x,point.y);this.active.set(id,{...p,expires:this.now+duration});
    return this.frame({pointerId:id,phase:"down",...p});
  }
  move(id: string, point: Point) {
    if(!Number.isFinite(point.x)||!Number.isFinite(point.y)){this.fail("잘못된 좌표");return;}
    const old=this.active.get(id);if(!old)return;
    const p=clampPoint(point.x,point.y);if(old.x===p.x&&old.y===p.y)return;this.active.set(id,{...old,...p});
    this.dirty=true;
  }
  up(id: string, cancel=false) {
    const p=this.active.get(id);if(!p)return;
    this.active.delete(id);this.frame({pointerId:id,phase:cancel?"cancel":"up",x:p.x,y:p.y});
  }
  private fail(message: string) {
    const points: PointerSample[]=[...this.active].map(([pointerId,p])=>({pointerId,phase:"cancel",x:p.x,y:p.y}));
    this.active.clear();this.keys.clear();this.padButtons.clear();this.padVector=[0,0];this.wheelDelta=0;this.auto="stopped";this.error=message;this.dirty=false;
    if(points.length) this.transport.pointers(points); // one bounded best-effort release, never recursive
  }
  cancel(reason="사용자 중지") { this.fail(reason); }
  configure(profile: InteractionProfile) { this.cancel("프로필/모드 변경");this.profile=profile; }
  manual() { this.auto="stopped";this.wheelDelta=0; }
  private joystick() {
    let x=this.padVector[0],y=this.padVector[1];for(const key of this.keys){const v=vectorKeys[key];if(v){x+=v[0];y+=v[1];}}
    if(Math.hypot(x,y)<.08){this.up("joystick");return;}
    const p=joystickPoint(this.profile,x,y);if(this.active.has("joystick"))this.move("joystick",p);else if(this.down("joystick",this.profile.joystick))this.move("joystick",p);
  }
  button(key: string, pressed: boolean) {
    const mapping=this.profile.bindings.find(m=>m.key===key);if(!mapping)return false;
    const id=`mapped:${key}`;
    if(pressed) {
      this.manual();
      if(!this.active.has(id))this.down(id,mapping,mapping.action==="tap"?70:mapping.action==="longPress"?650:Infinity);
    } else if(mapping.action==="hold")this.up(id);
    return true;
  }
  key(code: string, pressed: boolean, repeat=false) {
    if(this.profile.mode!=="game") {
      if(!pressed || repeat)return false;
      if(code===this.profile.reading.shortcut){if(this.auto==="running")this.pauseAuto();else if(this.auto==="paused")this.resumeAuto();else this.startAuto();return true;}
      const backward=["PageUp","ArrowUp","ArrowLeft",this.profile.reading.previousKey].includes(code),forward=["PageDown","ArrowDown","ArrowRight","Space",this.profile.reading.nextKey].includes(code);
      if(!backward&&!forward)return false;
      this.manual();this.requestScroll(backward?-1:1);return true;
    }
    if(!this.profile.mappingEnabled)return false;
    if(repeat)return Boolean(vectorKeys[code] || this.profile.bindings.some(m=>m.key===code));
    if(vectorKeys[code]){this.manual();if(pressed)this.keys.add(code);else this.keys.delete(code);this.joystick();return true;}
    return this.button(code,pressed);
  }
  pad(pad: StandardPad | null) {
    if(this.profile.mode!=="game"||!this.profile.mappingEnabled||!this.profile.gamepadEnabled||!pad?.connected||pad.mapping!=="standard") {
      for(const key of this.padButtons)this.up(`mapped:${key}`,true);
      this.padButtons.clear();this.padVector=[0,0];this.up("look",true);this.joystick();return;
    }
    const axis=(n:number)=>Number.isFinite(pad.axes[n])&&Math.abs(pad.axes[n])>.18?Math.max(-1,Math.min(1,pad.axes[n])):0;
    const pressed=(n:number)=>pad.buttons[n]?.pressed||pad.buttons[n]?.value>.5;
    const direction=(n:number)=>pressed(n)&&!this.profile.bindings.some(m=>m.key===`Pad${n}`);
    const next: [number,number]=[axis(0)+(direction(15)?1:0)-(direction(14)?1:0),axis(1)+(direction(13)?1:0)-(direction(12)?1:0)];
    if(this.profile.lookStick.enabled&&Math.hypot(axis(2),axis(3))>.08){
      const point=joystickPoint({...this.profile,joystick:this.profile.lookStick},axis(2),axis(3));
      if(this.active.has("look"))this.move("look",point);else if(this.down("look",this.profile.lookStick))this.move("look",point);
    }else this.up("look");
    if(next[0]!==this.padVector[0]||next[1]!==this.padVector[1]){this.padVector=next;this.joystick();}
    const buttons=new Set<string>();for(let i=0;i<Math.min(17,pad.buttons.length);i++)if((![12,13,14,15].includes(i)||this.profile.bindings.some(m=>m.key===`Pad${i}`))&&pressed(i))buttons.add(`Pad${i}`);
    for(const key of buttons)if(!this.padButtons.has(key))this.button(key,true);
    for(const key of this.padButtons)if(!buttons.has(key))this.button(key,false);
    this.padButtons=buttons;
  }
  wheel(delta: number, deltaMode=0, viewportHeight=800) {
    if(!Number.isFinite(delta))return;
    this.auto="stopped";
    const pixels=delta*(deltaMode===1?16:deltaMode===2?Math.min(2000,viewportHeight):1);
    this.wheelDelta=Math.max(-2000,Math.min(2000,this.wheelDelta+pixels*this.profile.reading.speed));
  }
  pageClick(x: number) {
    if(!this.profile.reading.clickPages)return false;
    if(x<this.profile.reading.leftZone){this.manual();this.requestScroll(-1);return true;}
    if(x>this.profile.reading.rightZone){this.manual();this.requestScroll(1);return true;}
    return false;
  }
  private requestScroll(direction: number, scale=1) {
    if(this.now<this.scrollBusyUntil || this.active.size)return false;
    const r=this.profile.reading, sign=direction*(r.reverse?-1:1),distance=Math.max(.03,Math.min(.8,r.distance*scale));
    let command: Record<string,unknown>;
    if(r.navigation==="tap")command={type:"tap",x:sign>0?.85:.15,y:.5};
    else if(r.navigation==="horizontal")command={type:"swipe",fromX:.5+sign*distance/2,fromY:.5,toX:.5-sign*distance/2,toY:.5,durationMs:220};
    else command={type:"swipe",fromX:.5,fromY:.5+sign*distance/2,toX:.5,toY:.5-sign*distance/2,durationMs:220};
    this.scrollBusyUntil=this.now+300;
    if(!this.transport.available()||!this.transport.command(command)){this.fail("스크롤 입력 오류");return false;}this.error=null;return true;
  }
  startAuto() { if(this.profile.mode==="game"||!this.transport.available())return false;this.cancel("자동 스크롤 시작");this.auto="running";this.nextScroll=this.now;return true; }
  pauseAuto(){if(this.auto==="running")this.auto="paused";this.wheelDelta=0;}
  resumeAuto(){if(this.auto==="paused"&&this.transport.available()){this.auto="running";this.nextScroll=this.now;}}
  stopAuto(){this.auto="stopped";this.wheelDelta=0;}
  tick(now: number) {
    if(!Number.isFinite(now)||now<this.now)return;this.now=now;
    if(!this.transport.available()){if(this.active.size||this.auto!=="stopped")this.fail("연결 종료");return;}
    for(const [id,p] of this.active)if(now>=p.expires)this.up(id);
    if(this.active.size&&(now-this.heartbeat>=200||(this.dirty&&now-this.heartbeat>=32)))this.frame();
    if(Math.abs(this.wheelDelta)>=6&&now>=this.scrollBusyUntil){const sign=Math.sign(this.wheelDelta),scale=Math.max(.2,Math.min(1.75,Math.abs(this.wheelDelta)/120));this.wheelDelta=0;this.requestScroll(sign,scale);}
    if(this.auto==="running"&&now>=this.nextScroll){this.requestScroll(this.profile.reading.autoDirection);this.nextScroll=now+Math.max(350,1500/this.profile.reading.autoSpeed);}
  }
}
