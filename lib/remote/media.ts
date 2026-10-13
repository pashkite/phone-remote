export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export function timestamp() { return new Date().toISOString().replace(/[:.]/g, "-"); }
export async function screenshot(video: HTMLVideoElement | null) {
  if (!video || !video.videoWidth || video.readyState < 2) throw new Error("아직 화면을 받지 못했습니다.");
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지를 만들 수 없습니다.");
  ctx.drawImage(video, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("PNG 저장 실패")), "image/png"));
  downloadBlob(blob, `GalaxyRemote-${timestamp()}.png`);
}
export class ScreenRecording {
  private recorder: MediaRecorder | null = null;
  private parts: Blob[] = [];
  private bytes = 0;
  private onDone: (message: string) => void;
  constructor(onDone: (message: string) => void) { this.onDone = onDone; }
  start(stream: MediaStream) {
    if (this.recorder || !stream.getVideoTracks().some(t => t.readyState === "live")) throw new Error("녹화할 화면이 없습니다.");
    if (typeof MediaRecorder === "undefined") throw new Error("이 브라우저는 녹화를 지원하지 않습니다.");
    const mime = ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find(m => MediaRecorder.isTypeSupported(m));
    if (!mime) throw new Error("지원되는 녹화 형식이 없습니다.");
    this.parts = []; this.bytes = 0;
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    this.recorder = recorder;
    recorder.ondataavailable = e => {
      if (e.data.size) { this.parts.push(e.data); this.bytes += e.data.size; }
      // Bounded fallback on browsers without a streaming file writer. Stop,
      // retain the playable segment, and let the user start the next segment.
      if (this.bytes >= 128 * 1024 * 1024 && recorder.state === "recording") recorder.stop();
    };
    recorder.onerror = () => { this.stop(); };
    recorder.onstop = () => {
      this.recorder = null;
      if (this.parts.length) downloadBlob(new Blob(this.parts, { type: mime }), `GalaxyRemote-${timestamp()}.${mime.startsWith("video/mp4") ? "mp4" : "webm"}`);
      this.parts = [];
      this.onDone(this.bytes >= 128 * 1024 * 1024 ? "128MiB에 도달해 녹화를 저장했습니다. 새 녹화를 시작할 수 있어요." : "녹화 파일을 저장했습니다.");
    };
    recorder.start(1000);
  }
  stop() { if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop(); }
}
// AudioPlaybackCapture fallback over a separate, unreliable WebRTC channel.
// Queue at most 150ms, drop stale samples rather than accumulating latency.
export class PcmPlayer {
  context: AudioContext | null = null;
  destination: MediaStreamAudioDestinationNode | null = null;
  private gain: GainNode | null = null;
  private next = 0;
  async start() {
    this.context = new AudioContext({ sampleRate: 48000 });
    this.gain = this.context.createGain();
    this.destination = this.context.createMediaStreamDestination();
    this.gain.connect(this.context.destination); this.gain.connect(this.destination);
    await this.context.resume(); this.next = 0;
  }
  volume(value: number) { if (this.gain) this.gain.gain.value = value / 100; }
  receive(data: ArrayBuffer) {
    const ctx = this.context;
    if (!ctx || !this.gain || data.byteLength < 4 || data.byteLength > 4096 || data.byteLength % 2) return;
    const samples = new DataView(data);
    const buffer = ctx.createBuffer(1, data.byteLength / 2, 48000);
    const values = buffer.getChannelData(0);
    for (let i = 0; i < values.length; i++) values[i] = samples.getInt16(i * 2, true) / 32768;
    if (this.next > ctx.currentTime + .15) return;
    const source = ctx.createBufferSource(); source.buffer = buffer; source.connect(this.gain);
    this.next = Math.max(this.next, ctx.currentTime + .02);
    source.start(this.next); this.next += buffer.duration;
  }
  close() { void this.context?.close(); this.context = null; this.destination = null; this.gain = null; }
}
