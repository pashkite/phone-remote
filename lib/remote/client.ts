import { Diagnostics } from "./diagnostics";
import { FileTransfer, type FileOffer } from "./files";
import { MAX_CLIPBOARD_BYTES, PROTOCOL_VERSION, type CommandStatus } from "./protocol";
import { PcmPlayer, ScreenRecording, downloadBlob, screenshot, timestamp } from "./media";
export type ToolsState = { features: string[]; result: string; clipboard: string; offer: FileOffer | null; fileStatus: string; recording: boolean; recordingAt: number; audio: boolean; audioStatus: string };
export class RemoteClient {
  readonly diagnostics = new Diagnostics();
  readonly id = crypto.randomUUID();
  private pending = new Map<string, { timer: ReturnType<typeof setTimeout>; type: string }>();
  private sequence = 0;
  private listeners = new Set<(state: ToolsState) => void>();
  private state: ToolsState = { features: [], result: "구버전 앱은 처리 결과를 확인할 수 없습니다.", clipboard: "", offer: null, fileStatus: "", recording: false, recordingAt: 0, audio: false, audioStatus: "꺼짐" };
  private player = new PcmPlayer();
  private recording = new ScreenRecording(message => { this.update({ recording: false, result: message }); });
  readonly files: FileTransfer;
  constructor(private channel: RTCDataChannel, files: RTCDataChannel, audio: RTCDataChannel, private video: () => HTMLVideoElement | null, private stream: () => MediaStream | null) {
    this.files = new FileTransfer(files, status => { this.update({ fileStatus: status }); this.diagnostics.record("file", { state: status.startsWith("전송") ? "sending" : "event" }); }, offer => this.update({ offer }));
    audio.binaryType = "arraybuffer"; audio.onmessage = event => { if (event.data instanceof ArrayBuffer) this.player.receive(event.data); };
    channel.onmessage = event => this.receive(String(event.data));
  }
  subscribe(listener: (state: ToolsState) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  private update(value: Partial<ToolsState>) { if (Object.entries(value).every(([k,v]) => this.state[k as keyof ToolsState] === v)) return; this.state = { ...this.state, ...value }; this.listeners.forEach(l => l(this.state)); }
  opened() { this.raw({ type: "hello", v: PROTOCOL_VERSION, features: ["commandAck", "clipboard", "files", "pcmAudio", "diagnostics"] }); this.diagnostics.record("channel", { state: "open" }); }
  private raw(payload: Record<string, unknown>) { if (this.channel.readyState !== "open") return false; try { this.channel.send(JSON.stringify(payload)); return true; } catch { return false; } }
  send(payload: Record<string, unknown>) {
    if (!this.state.features.includes("commandAck")) return this.raw(payload);
    if (this.pending.size >= 256) { this.update({ result: "명령 응답이 밀리고 있습니다. 잠시 기다려 주세요." }); return false; }
    const id = crypto.randomUUID(), type = String(payload.type);
    const timer = setTimeout(() => { this.pending.delete(id); this.result(type, "timeout", "TIMEOUT"); }, 6000);
    this.pending.set(id, { timer, type });
    if (!this.raw({ ...payload, v: PROTOCOL_VERSION, id, seq: ++this.sequence })) { clearTimeout(timer); this.pending.delete(id); return false; }
    return true;
  }
  private result(type: string, status: CommandStatus, code?: string) {
    const labels = { received: "휴대폰 수신", accepted: "처리 수락", completed: "Android 처리 완료", failed: "처리 실패", timeout: "응답 시간 초과" };
    this.update({ result: `${type}: ${labels[status]}${code ? ` (${code})` : ""}` });
    this.diagnostics.record("command", { type, status, code: code ?? null });
  }
  private receive(text: string) {
    if (text.length > 100_000) return;
    try {
      const m = JSON.parse(text);
      if (m.type === "capabilities" && m.v === PROTOCOL_VERSION && Array.isArray(m.features)) this.update({ features: m.features.filter((f: unknown) => typeof f === "string"), result: "처리 결과를 확인할 수 있습니다. 앱 화면의 버튼 동작까지 보장하지는 않습니다." });
      if (m.type === "ack" && m.v === 1 && ["received","accepted","completed","failed"].includes(m.status)) {
        const pending = this.pending.get(m.id); if (!pending) return;
        this.result(pending.type, m.status, typeof m.code === "string" && /^[A-Z_]{1,50}$/.test(m.code) ? m.code : undefined);
        if (["completed","failed"].includes(m.status)) { clearTimeout(pending.timer); this.pending.delete(m.id); }
      }
      if (m.type === "clipboard" && typeof m.text === "string" && new TextEncoder().encode(m.text).length <= MAX_CLIPBOARD_BYTES) this.update({ clipboard: m.text });
      if (m.type === "audioState") this.update({ audio: m.state === "started", audioStatus: m.state === "started" ? "재생 소리 전송 중 · 보호된 앱은 무음일 수 있어요." : String(m.code ?? "꺼짐") });
      if (m.type === "notice" && typeof m.message === "string") this.update({ result: m.message.slice(0, 300) });
      if (m.type === "diagnostic" && m.data && typeof m.data === "object") this.diagnostics.record("android", m.data);
    } catch { this.diagnostics.record("protocol", { code: "INVALID_MESSAGE" }); }
  }
  async sendClipboard(text?: string) {
    const value = text ?? await navigator.clipboard.readText();
    if (new TextEncoder().encode(value).length > MAX_CLIPBOARD_BYTES) throw new Error("클립보드는 UTF-8 기준 최대 64KiB입니다.");
    if (!this.send({ type: "clipboardSet", text: value })) throw new Error("연결이 닫혔습니다.");
  }
  async copyClipboard() { await navigator.clipboard.writeText(this.state.clipboard); }
  capture() { return screenshot(this.video()); }
  startRecording() {
    const stream = this.stream(); if (!stream) throw new Error("연결 후 녹화해 주세요.");
    const tracks = [...stream.getVideoTracks(), ...(this.state.audio ? this.player.destination?.stream.getAudioTracks() ?? [] : [])];
    this.recording.start(new MediaStream(tracks)); this.update({ recording: true, recordingAt: Date.now() });
  }
  stopRecording() { this.recording.stop(); }
  async toggleAudio() {
    if (this.state.recording) throw new Error("녹화를 중지한 뒤 소리 설정을 바꿔 주세요.");
    if (this.state.audio) { this.send({ type: "audio", enabled: false }); this.player.close(); this.update({ audio: false, audioStatus: "꺼짐" }); }
    else { this.player.close(); await this.player.start(); if (!this.send({ type: "audio", enabled: true })) throw new Error("연결 종료"); this.update({ audioStatus: "휴대폰 오디오 캡처를 요청했습니다." }); }
  }
  audioVolume(value: number) { this.player.volume(value); }
  exportDiagnostics() { downloadBlob(new Blob([this.diagnostics.export()], { type: "application/json" }), `GalaxyRemote-diagnostics-${timestamp()}.json`); }
  close() { this.files.close(); this.recording.stop(); this.player.close(); this.pending.forEach(p => clearTimeout(p.timer)); this.pending.clear(); this.update({ features: [], clipboard: "", offer: null, audio: false, audioStatus: "꺼짐" }); this.diagnostics.record("channel", { state: "closed" }); }
}
