export const QUALITY_PRESETS = {
  saving: { edge: 540, fps: 24, label: "데이터 절약" },
  stable: { edge: 720, fps: 30, label: "안정성 우선" },
  balanced: { edge: 1080, fps: 30, label: "균형" },
  smooth: { edge: 1080, fps: 60, label: "부드러움" },
  high: { edge: 1440, fps: 30, label: "고화질" },
} as const;
export type QualityMode = keyof typeof QUALITY_PRESETS | "auto" | "custom";
export type SenderMetrics = { rtpLimitsApplied: boolean | null; at: number; captureFps: number | null; sendFps: number | null; sendKbps: number | null; encodeMs: number | null; sendQueueMs: number | null; encoder: string | null; hardwareEncoder: boolean | null; thermal: number | null; encoderOverloaded: boolean; codec: string | null; configuredEdge: number | null; configuredFps: number | null; cpuCorePercent: number | null };
export function parseSenderMetrics(input: unknown, at: number): SenderMetrics | null {
  if (!input || typeof input !== "object") return null;
  const m = input as Record<string, unknown>;
  const number = (key: string, max = 1e9) => typeof m[key] === "number" && Number.isFinite(m[key]) && (m[key] as number) >= 0 && (m[key] as number) <= max ? m[key] as number : null;
  const text = (key: string) => typeof m[key] === "string" ? (m[key] as string).replace(/[^a-zA-Z0-9_.\-/]/g, "").slice(0, 100) : null;
  return { rtpLimitsApplied: typeof m.rtpLimitsApplied === "boolean" ? m.rtpLimitsApplied : null, at, captureFps: number("captureFps", 1000), sendFps: number("sendFps", 1000), sendKbps: number("sendKbps"), encodeMs: number("encodeMs"), sendQueueMs: number("sendQueueMs"), encoder: text("encoder"), hardwareEncoder: typeof m.hardwareEncoder === "boolean" ? m.hardwareEncoder : null, thermal: number("thermal", 6), encoderOverloaded: m.encoderOverloaded === true, codec: text("codec"), configuredEdge: number("configuredEdge", 16384), configuredFps: number("configuredFps", 1000), cpuCorePercent: number("cpuCorePercent", 10000) };
}

export type VideoMetrics = { decodedFrames: number | null; latency: number | null; width: number | null; height: number | null; fps: number | null; bitrateKbps: number | null; packetLoss: number | null; path: "direct" | "turn" | null; codec: string | null; decodeMs: number | null; jitterMs: number | null; dropped: number | null; stalled: boolean; bufferedBytes: number };
export const EMPTY_VIDEO_METRICS: VideoMetrics = { decodedFrames: null, latency: null, width: null, height: null, fps: null, bitrateKbps: null, packetLoss: null, path: null, codec: null, decodeMs: null, jitterMs: null, dropped: null, stalled: false, bufferedBytes: 0 };
// RTCStats varies by browser; missing and reset counters remain unknown, never fabricated zero.
type Stat = Record<string, unknown> & { id: string; type: string };
const finite = (s: Stat | undefined, key: string): number | null => typeof s?.[key] === "number" && Number.isFinite(s[key]) ? s[key] as number : null;
export class VideoStatsSampler {
  private previous: { id: string; at: number; stat: Stat } | null = null;
  private noFramesMs = 0;
  sample(stats: Iterable<Stat>, at: number, bufferedBytes: number): VideoMetrics {
    const all = [...stats], map = new Map(all.map(s => [s.id, s]));
    const transport = all.find(s => s.type === "transport" && typeof s.selectedCandidatePairId === "string");
    const pair = map.get(String(transport?.selectedCandidatePairId)) ?? all.find(s => s.type === "candidate-pair" && s.state === "succeeded" && s.nominated === true);
    const inbound = all.find(s => s.type === "inbound-rtp" && (s.kind === "video" || s.mediaType === "video"));
    const result = { ...EMPTY_VIDEO_METRICS, bufferedBytes };
    const rtt = finite(pair, "currentRoundTripTime"); result.latency = rtt === null ? null : rtt * 1000;
    if (pair) {
      const local = map.get(String(pair.localCandidateId)), remote = map.get(String(pair.remoteCandidateId));
      if (local || remote) result.path = local?.candidateType === "relay" || remote?.candidateType === "relay" ? "turn" : "direct";
    }
    if (!inbound) { this.previous = null; this.noFramesMs = 0; return result; }
    result.decodedFrames = finite(inbound, "framesDecoded");
    result.width = finite(inbound, "frameWidth"); result.height = finite(inbound, "frameHeight");
    result.fps = finite(inbound, "framesPerSecond");
    const codec = map.get(String(inbound.codecId)); result.codec = typeof codec?.mimeType === "string" ? codec.mimeType : null;
    const previous = this.previous;
    if (previous && previous.id === inbound.id && at > previous.at && at - previous.at <= 5000) {
      const ms = at - previous.at;
      const delta = (key: string) => { const a = finite(inbound, key), b = finite(previous.stat, key); return a !== null && b !== null && a >= b ? a - b : null; };
      const bytes = delta("bytesReceived"), frames = delta("framesDecoded"), received = delta("packetsReceived"), lost = delta("packetsLost");
      result.bitrateKbps = bytes === null ? null : bytes * 8 / ms;
      if (frames !== null && result.fps === null) result.fps = frames * 1000 / ms;
      result.packetLoss = received !== null && lost !== null && received + lost > 0 ? 100 * lost / (received + lost) : null;
      const decode = delta("totalDecodeTime"), jitter = delta("jitterBufferDelay"), emitted = delta("jitterBufferEmittedCount");
      result.decodeMs = decode !== null && frames !== null && frames > 0 ? decode * 1000 / frames : null;
      result.jitterMs = jitter !== null && emitted !== null && emitted > 0 ? jitter * 1000 / emitted : null;
      result.dropped = delta("framesDropped");
      this.noFramesMs = frames === 0 ? this.noFramesMs + ms : 0;
      result.stalled = this.noFramesMs >= 3000; // also possible for genuinely static content
    } else this.noFramesMs = 0;
    this.previous = { id: inbound.id, at, stat: { ...inbound } };
    return result;
  }
}

/** User-opted auto only. One step per 10s, 3 poor samples down / 20 good samples up. */
export class AdaptiveQuality {
  private index = 2;
  private lastChange = -Infinity;
  private lastSample = -Infinity;
  private poor = 0;
  private good = 0;
  reset() { this.index = 2; this.lastChange = -Infinity; this.lastSample = -Infinity; this.poor = 0; this.good = 0; }
  update(metrics: VideoMetrics, sender: SenderMetrics | null, at: number, supports720: boolean) {
    if (at - this.lastSample < 800) return null;
    if (at - this.lastSample > 5000) { this.poor = 0; this.good = 0; }
    this.lastSample = at;
    const levels = supports720 ? [QUALITY_PRESETS.saving, QUALITY_PRESETS.stable, QUALITY_PRESETS.balanced, QUALITY_PRESETS.smooth] : [QUALITY_PRESETS.saving, QUALITY_PRESETS.saving, QUALITY_PRESETS.balanced, QUALITY_PRESETS.smooth];
    const fresh = sender && at - sender.at < 6000 ? sender : null;
    const poor = (metrics.latency ?? 0) > 180 || (metrics.packetLoss ?? 0) > 3 || (metrics.stalled && (metrics.bitrateKbps ?? 0) > 20) || metrics.bufferedBytes > 16384 || (metrics.jitterMs ?? 0) > 100 || (fresh?.sendQueueMs ?? 0) > 100 || fresh?.encoderOverloaded === true || (fresh?.thermal ?? 0) >= 3;
    const activeSourceSlow = fresh !== null && (fresh.captureFps ?? 0) > 15 && (fresh.sendFps ?? 0) > 15 && metrics.fps !== null && metrics.fps < levels[this.index].fps * .5;
    // FPS alone may be low on a static screen. Do not downgrade merely for that.
    const good = !poor && !activeSourceSlow && metrics.fps !== null && metrics.fps >= levels[this.index].fps * .85 && metrics.latency !== null && metrics.latency < 80 && metrics.packetLoss !== null && metrics.packetLoss < 1 && (fresh?.thermal ?? 0) < 2;
    this.poor = poor || activeSourceSlow ? this.poor + 1 : 0; this.good = good ? this.good + 1 : 0;
    if (at - this.lastChange < 10000) return null;
    const next = this.poor >= 3 ? Math.max(0, this.index - 1) : this.good >= 20 ? Math.min(3, this.index + 1) : this.index;
    if (next === this.index) return null;
    this.index = next; this.lastChange = at; this.good = 0; this.poor = 0;
    return levels[this.index];
  }
}
export function preferredCodecs<T extends { mimeType: string }>(codecs: T[], h264: boolean): T[] {
  const vp8 = codecs.filter(c => c.mimeType.toLowerCase() === "video/vp8");
  const avc = codecs.filter(c => c.mimeType.toLowerCase() === "video/h264");
  // Never remove VP8 fallback. Missing VP8 leaves the browser's own defaults untouched.
  return vp8.length ? [...(h264 ? avc : []), ...vp8] : [];
}
export function requestLowBuffer(receiver: RTCRtpReceiver) {
  // Optional browser hints, not a promise of a zero-buffer pipeline.
  try { if ("jitterBufferTarget" in receiver) (receiver as RTCRtpReceiver & { jitterBufferTarget: number }).jitterBufferTarget = 0; } catch { /* unsupported range */ }
  try { if ("playoutDelayHint" in receiver) (receiver as RTCRtpReceiver & { playoutDelayHint: number }).playoutDelayHint = 0; } catch { /* unsupported */ }
}

/** A connected peer with no first video frame can still have a failed encoder. */
export function needsVp8Fallback(h264: boolean, alreadyTried: boolean, elapsedMs: number, videoWidth: number, decodedFrames: number | null): boolean {
  return h264 && !alreadyTried && elapsedMs >= 10000 && videoWidth <= 0 && (decodedFrames === null || decodedFrames === 0);
}
