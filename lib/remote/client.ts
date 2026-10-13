import { Diagnostics } from "./diagnostics";
import { FileTransfer, type FileOffer } from "./files";
import { MAX_CLIPBOARD_BYTES, PROTOCOL_VERSION, type CommandStatus } from "./protocol";
import { PcmPlayer, ScreenRecording, downloadBlob, screenshot, timestamp } from "./media";
export type ToolsState = { features: string[]; result: string; clipboard: string; offer: FileOffer | null; fileStatus: string; recording: boolean; recordingAt: number; audio: boolean; audioStatus: string };
export class RemoteClient {
  readonly diagnostics: Diagnostics;
  readonly id = crypto.randomUUID();
  private pending = new Map<string, { timer: ReturnType<typeof setTimeout>; type: string }>();
  private sequence = 0;
  private helloSent = false;
  private listeners = new Set<(state: ToolsState) => void>();
  private state: ToolsState = { features: [], result: "구버전 앱은 처리 결과를 확인할 수 없습니다.", clipboard: "", offer: null, fileStatus: "", recording: false, recordingAt: 0, audio: false, audioStatus: "꺼짐" };
  private player = new PcmPlayer();
  private recording = new ScreenRecording(message => { this.update({ recording: false, result: message }); });
  private fileTransfer: FileTransfer | null = null;
  get files(): FileTransfer { if (!this.fileTransfer) throw new Error("파일 전송을 지원하는 앱이 필요합니다."); return this.fileTransfer; }
  constructor(private channel: RTCDataChannel, private peer: RTCPeerConnection, private video: () => HTMLVideoElement | null, private stream: () => MediaStream | null, diagnostics?: Diagnostics) {
    this.diagnostics = diagnostics ?? new Diagnostics();
    channel.onmessage = event => this.receive(String(event.data));
  }
  subscribe(listener: (state: ToolsState) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  private update(value: Partial<ToolsState>) { if (Object.entries(value).every(([k,v]) => this.state[k as keyof ToolsState] === v)) return; this.state = { ...this.state, ...value }; this.listeners.forEach(l => l(this.state)); }
  opened() { this.diagnostics.record("channel", { state: "open" }); }
  private raw(payload: Record<string, unknown>) { if (this.channel.readyState !== "open" || this.channel.bufferedAmount > 262144) return false; try { this.channel.send(JSON.stringify(payload)); return true; } catch { return false; } }
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
    const names: Record<string,string> = { tap:"터치", longPress:"길게 누르기", swipe:"스와이프", global:"휴대폰 버튼", text:"문자 입력", key:"키 입력", volume:"볼륨", quality:"화질", clipboardSet:"클립보드 전송", clipboardPaste:"붙여넣기", standby:"대기 모드", audio:"소리", diagnostics:"진단" };
    const errors: Record<string,string> = { ACCESSIBILITY_DISABLED:"휴대폰 접근성 권한을 켜 주세요", INPUT_UNAVAILABLE:"입력칸 또는 원격 키보드를 확인해 주세요", INPUT_OR_CLIPBOARD_UNAVAILABLE:"입력칸과 클립보드를 확인해 주세요", GESTURE_CANCELLED:"Android가 동작을 취소했습니다", GESTURE_REJECTED:"Android가 동작을 거절했습니다", UNSUPPORTED_COMMAND:"지원하지 않는 명령", CLIPBOARD_ACCESS_RESTRICTED:"Android가 클립보드 접근을 제한했습니다", STALE_COMMAND:"지난 명령의 재실행을 차단했습니다", TIMEOUT:"실행 여부를 확인하지 못했습니다", PROCESSING_TIMEOUT:"처리 결과를 확인하지 못했습니다", AUDIO_PERMISSION_REQUIRED:"휴대폰 앱에서 소리 캡처 권한을 허용해 주세요" };
    this.update({ result: `${names[type] ?? "명령"}: ${labels[status]}${code ? ` · ${errors[code] ?? "휴대폰에서 처리할 수 없습니다"} (${code})` : ""}` });
    this.diagnostics.record("command", { type, status, code: code ?? null });
  }
  private receive(text: string) {
    if (text.length > 100_000) return;
    try {
      const m = JSON.parse(text);
      if (m.type === "capabilities" && m.v === PROTOCOL_VERSION && Array.isArray(m.features)) {
        if (!this.helloSent) { this.helloSent = true; this.raw({ type: "hello", v: 1, features: ["commandAck", "clipboard", "files", "pcmAudio", "diagnostics"] }); }
        // Old Android builds treat any arriving DataChannel as control. Only
        // open extension channels after the peer explicitly supports them.
        if (!this.fileTransfer && m.features.includes("files")) {
          const files = this.peer.createDataChannel("files", { ordered: true });
          this.fileTransfer = new FileTransfer(files, status => { this.update({ fileStatus: status }); this.diagnostics.record("file", { state: status.startsWith("전송") ? "sending" : "event" }); }, offer => this.update({ offer }));
        }
        if (!this.state.features.includes("pcmAudio") && m.features.includes("pcmAudio")) {
          const audio = this.peer.createDataChannel("audio-pcm", { ordered: false, maxRetransmits: 0 });
          audio.binaryType = "arraybuffer"; audio.onmessage = (event: MessageEvent) => { if (event.data instanceof ArrayBuffer) this.player.receive(event.data); };
        }
        this.update({ features: m.features.filter((f: unknown) => typeof f === "string"), result: "처리 결과를 확인할 수 있습니다. 앱 화면의 버튼 동작까지 보장하지는 않습니다." });
      }
      if (m.type === "ack" && m.v === 1 && ["received","accepted","completed","failed"].includes(m.status)) {
        const pending = this.pending.get(m.id); if (!pending) return;
        this.result(pending.type, m.status, typeof m.code === "string" && /^[A-Z_]{1,50}$/.test(m.code) ? m.code : undefined);
        if (["completed","failed"].includes(m.status)) { clearTimeout(pending.timer); this.pending.delete(m.id); }
      }
      if (m.type === "clipboard" && typeof m.text === "string" && new TextEncoder().encode(m.text).length <= MAX_CLIPBOARD_BYTES) this.update({ clipboard: m.text });
      if (m.type === "audioState") this.update({ audio: m.state === "started", audioStatus: m.state === "started" ? "재생 소리 전송 중 · 보호된 앱은 무음일 수 있어요." : m.code === "AUDIO_PERMISSION_REQUIRED" ? "휴대폰 앱 → 전송·대기·진단 → 재생 소리 캡처 권한을 허용해 주세요." : m.code ? `오디오 캡처를 시작할 수 없습니다 (${String(m.code).slice(0,50)})` : "꺼짐" });
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
  async startRecording() {
    const stream = this.stream(); if (!stream) throw new Error("연결 후 녹화해 주세요.");
    const tracks = [...stream.getVideoTracks(), ...(this.state.audio ? this.player.destination?.stream.getAudioTracks() ?? [] : [])];
    if (await this.recording.start(new MediaStream(tracks))) this.update({ recording: true, recordingAt: Date.now() });
  }
  stopRecording() { this.recording.stop(); }
  async toggleAudio() {
    if (this.state.recording) throw new Error("녹화를 중지한 뒤 소리 설정을 바꿔 주세요.");
    if (this.state.audio) { this.send({ type: "audio", enabled: false }); this.player.close(); this.update({ audio: false, audioStatus: "꺼짐" }); }
    else { this.player.close(); await this.player.start(); if (!this.send({ type: "audio", enabled: true })) throw new Error("연결 종료"); this.update({ audioStatus: "휴대폰 오디오 캡처를 요청했습니다." }); }
  }
  audioVolume(value: number) { this.player.volume(value); }
  exportDiagnostics() { downloadBlob(new Blob([this.diagnostics.export()], { type: "application/json" }), `GalaxyRemote-diagnostics-${timestamp()}.json`); }
  close() { this.fileTransfer?.close(); this.recording.stop(); this.player.close(); this.pending.forEach(p => clearTimeout(p.timer)); this.pending.clear(); this.update({ features: [], clipboard: "", offer: null, audio: false, audioStatus: "꺼짐" }); this.diagnostics.record("channel", { state: "closed" }); }
}
