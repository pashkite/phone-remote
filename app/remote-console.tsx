"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { normalizedVideoPoint } from "./remote-geometry";
import ThemeToggle from "./components/theme-toggle";
import { useInteraction } from "../lib/interaction/use-interaction";
import type { InteractionEngine } from "../lib/interaction/engine";
import InteractionControls from "./components/interaction-controls";
import InteractionOverlay from "./components/interaction-overlay";
import RemoteTools from "./components/remote-tools";
import { LiveTouchSender } from "../lib/remote/live-touch";
import { RemoteClient } from "../lib/remote/client";
import { Diagnostics } from "../lib/remote/diagnostics";
import { AdaptiveQuality, EMPTY_VIDEO_METRICS, QUALITY_PRESETS, VideoStatsSampler, needsVp8Fallback, preferredCodecs, requestLowBuffer, type QualityMode, type VideoMetrics, type SenderMetrics } from "../lib/remote/streaming";
import { resolveShortcut } from "../lib/remote/shortcuts";

type ConnectionState = "offline" | "waiting" | "reconnecting" | "connected";
type PcMode = "personal" | "public";
type DialogState = "pair" | "disconnect" | "settings" | null;
type ResolutionSetting = 540 | 720 | 1080 | 1440;
type FrameRateSetting = 24 | 30 | 60;

type RemoteConsoleProps = {
  displayName: string;
  email: string | null;
  signOutPath: string;
};

type RegisteredDevice = {
  id: string;
  name: string;
  platform: string;
  appVersion: string;
  batteryLevel: number | null;
  screenWidth: number | null;
  screenHeight: number | null;
  lastSeenAt: number | null;
  createdAt: number;
  online: boolean;
};

type PairingInfo = {
  code: string;
  expiresAt: number;
};

type ConnectionMetrics = VideoMetrics;

const MINIMUM_NOTIFICATION_APP_VERSION = [0, 2, 0] as const;

function versionAtLeast(version: string, minimumVersion: readonly number[]) {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => !Number.isFinite(part))) return false;
  for (let index = 0; index < minimumVersion.length; index += 1) {
    const actual = parts[index] ?? 0;
    const minimum = minimumVersion[index];
    if (actual > minimum) return true;
    if (actual < minimum) return false;
  }
  return true;
}
function supportsNotificationApproval(version: string) {
  return versionAtLeast(version, MINIMUM_NOTIFICATION_APP_VERSION);
}

const controls = [
  { command: "back", icon: "←", label: "뒤로" },
  { command: "home", icon: "⌂", label: "홈" },
  { command: "recents", icon: "▤", label: "최근" },
  { command: "lock", icon: "▣", label: "잠금" },
];

async function responseError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || fallback;
  } catch {
    return fallback;
  }
}

export default function RemoteConsole({ displayName, email, signOutPath }: RemoteConsoleProps) {
  const [connection, setConnection] = useState<ConnectionState>("offline");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [devices, setDevices] = useState<RegisteredDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [pairing, setPairing] = useState<PairingInfo | null>(null);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [volume, setVolume] = useState(50);
  const [volumeKnown, setVolumeKnown] = useState(false);
  const [resolution, setResolution] = useState<ResolutionSetting>(1080);
  const [frameRate, setFrameRate] = useState<FrameRateSetting>(30);
  const [pcMode, setPcMode] = useState<PcMode>("public");
  const [detachedOpacity, setDetachedOpacity] = useState(100);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [detachedWindow, setDetachedWindow] = useState<Window | null>(null);
  const [videoAspectRatio, setVideoAspectRatio] = useState(9 / 19.5);
  const [metrics, setMetrics] = useState<ConnectionMetrics>({ ...EMPTY_VIDEO_METRICS });
  const [senderMetrics, setSenderMetrics] = useState<SenderMetrics | null>(null);
  const [qualityMode, setQualityMode] = useState<QualityMode>("balanced");
  const modeRef = useRef<QualityMode>("balanced");
  const adaptiveRef = useRef(new AdaptiveQuality());
  const [codecMode, setCodecMode] = useState("vp8");
  const codecRef = useRef("vp8");
  const codecFallbackRef = useRef(false);
  const [diagnostics] = useState(() => new Diagnostics());
  const [toast, setToast] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionHint, setConnectionHint] = useState<string | null>(null);
  const [removingDeviceId, setRemovingDeviceId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const detachedVideoRef = useRef<HTMLVideoElement>(null);
  const detachedRatioRef = useRef(9 / 19.5);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const wheelDeltaRef = useRef({ x: 0, y: 0 });
  const wheelFlushTimerRef = useRef<number | null>(null);
  const keyboardRef = useRef<HTMLInputElement>(null);
  const detachedKeyboardRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLElement>(null);
  const viewerRef = useRef<HTMLElement>(null);
  const phoneViewRef = useRef<HTMLDivElement>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const toolsRef = useRef<RemoteClient | null>(null);
  const [toolsClient, setToolsClient] = useState<RemoteClient | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const answerPollRef = useRef<number | null>(null);
  const statsTimerRef = useRef<number | null>(null);
  const textFlushTimerRef = useRef<number | null>(null);
  const textBufferRef = useRef("");
  const remoteCandidateIdsRef = useRef(new Set<string>());
  const previousStatsRef = useRef<{ bytes: number; at: number } | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number; at: number; pointerId: number; target: HTMLDivElement; clientX: number; clientY: number; moved: boolean } | null>(null);
  const livePointerRef = useRef<{ sender: LiveTouchSender; cleanup: () => void } | null>(null);
  const connectionStartingRef = useRef(false);
  const composingRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const intentionalCloseRef = useRef(false);
  const interactionEngineRef = useRef<InteractionEngine | null>(null);
  const modePointersRef = useRef(new Map<number,{kind:"mapped"|"pointer"|"pan";key?:string;x:number;y:number;target:HTMLDivElement}>());
  const resolutionRef = useRef<ResolutionSetting>(1080);
  const frameRateRef = useRef<FrameRateSetting>(30);

  useEffect(() => {
    if (!dialog || !modalRef.current) return;
    const modal = modalRef.current;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const items = () => Array.from(modal.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')).filter(el => el.getClientRects().length > 0);
    (items()[0] ?? modal).focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setDialog(null); }
      if (event.key !== "Tab") return;
      const targets = items(), first = targets[0], last = targets.at(-1);
      if (!first || !last) { event.preventDefault(); modal.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); document.body.style.overflow = overflow; previous?.focus(); };
  }, [dialog]);

  const syncVideoAspectRatio = useCallback((video: HTMLVideoElement) => {
    const { videoWidth, videoHeight } = video;
    if (!videoWidth || !videoHeight) return;
    const nextRatio = videoWidth / videoHeight;
    if (Math.abs(nextRatio - detachedRatioRef.current) > .01) interactionEngineRef.current?.cancel("화면 방향 변경");
    detachedRatioRef.current = nextRatio;
    setVideoAspectRatio((current) => Math.abs(current - nextRatio) < 0.001 ? current : nextRatio);
    if (detachedWindow && !detachedWindow.closed) {
      detachedWindow.dispatchEvent(new Event("galaxy-phone-ratio-change"));
    }
  }, [detachedWindow]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const storedMode = window.localStorage.getItem("galaxy-remote-pc-mode");
      const mode: PcMode = storedMode === "personal" ? "personal" : "public";
      setPcMode(mode);
      if (mode === "personal") {
        const storedOpacity = Number(window.localStorage.getItem("galaxy-remote-detached-opacity"));
        if (Number.isFinite(storedOpacity) && storedOpacity >= 20 && storedOpacity <= 100) {
          setDetachedOpacity(Math.round(storedOpacity));
        }
      }
      setPreferencesLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) return;
    if (pcMode === "personal") {
      window.localStorage.setItem("galaxy-remote-pc-mode", "personal");
      window.localStorage.setItem("galaxy-remote-detached-opacity", String(detachedOpacity));
    } else {
      window.localStorage.removeItem("galaxy-remote-pc-mode");
      window.localStorage.removeItem("galaxy-remote-detached-opacity");
    }
  }, [detachedOpacity, pcMode, preferencesLoaded]);

  const attachDetachedVideo = useCallback((node: HTMLVideoElement | null) => {
    detachedVideoRef.current = node;
    if (!node) return;
    const stream = remoteStreamRef.current ?? videoRef.current?.srcObject ?? null;
    if (node.srcObject !== stream) node.srcObject = stream;
    if (stream) {
      void node.play().catch(() => {
        // canplay retries as soon as the first remote frame is available.
      });
    }
  }, []);

  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === selectedDeviceId) ?? devices[0] ?? null,
    [devices, selectedDeviceId],
  );
  const connected = connection === "connected";
  const waiting = connection === "waiting";
  const interaction = useInteraction({ owner: email, device: selectedDeviceId, personal: pcMode === "personal", connected, blocked: Boolean(dialog),
    client: toolsClient, send: sendPayload, viewer: viewerRef, detached: detachedWindow,
    releaseLegacy: releaseModeInputs,
    applyQuality: quality => {
      modeRef.current=quality.auto?"auto":"custom";setQualityMode(quality.auto?"auto":"custom");adaptiveRef.current.reset();
      const edge=quality.auto?1080:quality.edge===720&&connected&&!toolsRef.current?.supports("quality720")?1080:quality.edge;
      const fps=quality.auto?30:edge===1440&&quality.fps===60?30:quality.fps;
      resolutionRef.current=edge;frameRateRef.current=fps;setResolution(edge);setFrameRate(fps);
      if(connected)sendPayload({type:"quality",shortEdge:edge,fps});
    },
  });
  useEffect(()=>{interactionEngineRef.current=interaction.engine;},[interaction.engine]);
  function releaseModeInputs() {
    livePointerRef.current?.sender.finish("cancel");livePointerRef.current?.cleanup();livePointerRef.current=null;
    const held=pointerStartRef.current;pointerStartRef.current=null;
    if(held?.target.hasPointerCapture(held.pointerId))held.target.releasePointerCapture(held.pointerId);
    const pointers=[...modePointersRef.current];modePointersRef.current.clear();
    for(const [id,pointer] of pointers)if(pointer.target.hasPointerCapture(id))pointer.target.releasePointerCapture(id);
    if(wheelFlushTimerRef.current)window.clearTimeout(wheelFlushTimerRef.current);wheelFlushTimerRef.current=null;wheelDeltaRef.current={x:0,y:0};
  }
  function focusInteractionViewer() { phoneViewRef.current?.focus();interaction.activity(); }

  const initials = useMemo(
    () =>
      displayName
        .trim()
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase() || "O",
    [displayName],
  );

  const loadDevices = useCallback(async () => {
    try {
      const response = await fetch("/api/devices", { cache: "no-store" });
      if (!response.ok) return false;
      const payload = (await response.json()) as { devices?: RegisteredDevice[] };
      const nextDevices = payload.devices ?? [];
      setDevices(nextDevices);
      setSelectedDeviceId((current) =>
        current && nextDevices.some((device) => device.id === current)
          ? current
          : nextDevices[0]?.id ?? null,
      );
      return nextDevices.length > 0;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void loadDevices(), 0);
    const timer = window.setInterval(() => void loadDevices(), 5_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [loadDevices]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2_800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const stopTimers = useCallback(() => {
    if (answerPollRef.current) window.clearInterval(answerPollRef.current);
    if (statsTimerRef.current) window.clearInterval(statsTimerRef.current);
    if (textFlushTimerRef.current) window.clearTimeout(textFlushTimerRef.current);
    if (wheelFlushTimerRef.current) window.clearTimeout(wheelFlushTimerRef.current);
    answerPollRef.current = null;
    statsTimerRef.current = null;
    textFlushTimerRef.current = null;
    wheelFlushTimerRef.current = null;
    wheelDeltaRef.current = { x: 0, y: 0 };
    textBufferRef.current = "";
  }, []);

  const closeConnection = useCallback(async (notifyServer = true, intentional = true) => {
    diagnostics.record("connection", { state: "closed" });
    intentionalCloseRef.current = intentional;
    if (intentional && reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      reconnectAttemptsRef.current = 0;
    }
    interactionEngineRef.current?.cancel("연결 종료");
    stopTimers();
    livePointerRef.current?.sender.finish("cancel");
    livePointerRef.current?.cleanup();
    livePointerRef.current = null;
    const pointer = pointerStartRef.current;
    pointerStartRef.current = null;
    if (pointer?.target.hasPointerCapture(pointer.pointerId)) pointer.target.releasePointerCapture(pointer.pointerId);
    toolsRef.current?.close();
    toolsRef.current = null;
    setToolsClient(null);
    setVolumeKnown(false);
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    if (channelRef.current) {
      channelRef.current.onopen = null;
      channelRef.current.onclose = null;
      channelRef.current.close();
    }
    channelRef.current = null;
    if (peerRef.current) {
      peerRef.current.onconnectionstatechange = null;
      peerRef.current.oniceconnectionstatechange = null;
      peerRef.current.ontrack = null;
      peerRef.current.onicecandidate = null;
      peerRef.current.close();
    }
    peerRef.current = null;
    remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    if (detachedVideoRef.current) detachedVideoRef.current.srcObject = null;
    remoteStreamRef.current = null;
    setConnection("offline");
    setConnectionHint(null);
    remoteCandidateIdsRef.current.clear();
    previousStatsRef.current = null;
    setMetrics({ ...EMPTY_VIDEO_METRICS });
    setSenderMetrics(null);
    if (notifyServer && sessionId) {
      await fetch(`/api/sessions/${sessionId}`, { method: "DELETE", keepalive: true }).catch(() => {
        // Local media and control resources are already closed even if the
        // best-effort server cleanup cannot reach the network.
      });
    }
  }, [stopTimers, diagnostics]);

  useEffect(() => () => { void closeConnection(false, true); }, [closeConnection]);

  useEffect(() => {
    const detachedVideo = detachedVideoRef.current;
    if (!detachedVideo) return;
    const stream = remoteStreamRef.current ?? videoRef.current?.srcObject ?? null;
    if (detachedVideo.srcObject !== stream) detachedVideo.srcObject = stream;
    void detachedVideo.play().catch(() => {
      // Autoplay may briefly wait for the first remote frame.
    });
  }, [detachedWindow, connected]);

  useEffect(() => {
    if (!detachedWindow) return;
    const close = () => setDetachedWindow(null);
    let resizeTimer: number | null = null;
    let settleTimer: number | null = null;
    let adjusting = false;
    let correctionPending = false;
    let previousWidth = detachedWindow.innerWidth;
    let previousHeight = detachedWindow.innerHeight;
    const resizeWindowToRatio = (forceFromHeight = false) => {
      if (resizeTimer) detachedWindow.clearTimeout(resizeTimer);
      resizeTimer = detachedWindow.setTimeout(() => {
        if (adjusting) {
          correctionPending = true;
          return;
        }
        const currentWidth = detachedWindow.innerWidth;
        const currentHeight = detachedWindow.innerHeight;
        const widthChanged = Math.abs(currentWidth - previousWidth) / Math.max(1, previousWidth);
        const heightChanged = Math.abs(currentHeight - previousHeight) / Math.max(1, previousHeight);
        const ratio = detachedRatioRef.current;
        const chromeWidth = Math.max(0, detachedWindow.outerWidth - currentWidth);
        const chromeHeight = Math.max(0, detachedWindow.outerHeight - currentHeight);
        const widthIsDriver = !forceFromHeight && widthChanged >= heightChanged;
        let targetWidth = widthIsDriver
          ? currentWidth
          : Math.round(currentHeight * ratio);
        let targetHeight = widthIsDriver
          ? Math.round(currentWidth / ratio)
          : currentHeight;
        const maxWidth = Math.max(320, detachedWindow.screen.availWidth - chromeWidth);
        const maxHeight = Math.max(240, detachedWindow.screen.availHeight - chromeHeight);
        if (targetWidth > maxWidth) {
          targetWidth = maxWidth;
          targetHeight = Math.round(targetWidth / ratio);
        }
        if (targetHeight > maxHeight) {
          targetHeight = maxHeight;
          targetWidth = Math.round(targetHeight * ratio);
        }
        previousWidth = targetWidth;
        previousHeight = targetHeight;
        if (Math.abs(currentWidth - targetWidth) < 2 && Math.abs(currentHeight - targetHeight) < 2) return;
        adjusting = true;
        try {
          detachedWindow.resizeTo(targetWidth + chromeWidth, targetHeight + chromeHeight);
        } catch {
          // A browser policy may temporarily reject resizing while the window is opening.
        }
        settleTimer = detachedWindow.setTimeout(() => {
          adjusting = false;
          previousWidth = detachedWindow.innerWidth;
          previousHeight = detachedWindow.innerHeight;
          if (correctionPending) {
            correctionPending = false;
            resizeWindowToRatio(false);
          }
        }, 50);
      // Browsers can override resizeTo while the user is still dragging.
      // Correct once the drag has been quiet long enough to have ended.
      }, forceFromHeight ? 0 : 160);
    };
    const keepPhoneRatio = () => resizeWindowToRatio(false);
    const applyChangedPhoneRatio = () => resizeWindowToRatio(true);
    detachedWindow.addEventListener("pagehide", close, { once: true });
    detachedWindow.addEventListener("resize", keepPhoneRatio);
    detachedWindow.addEventListener("galaxy-phone-ratio-change", applyChangedPhoneRatio);
    applyChangedPhoneRatio();
    return () => {
      if (resizeTimer) detachedWindow.clearTimeout(resizeTimer);
      if (settleTimer) detachedWindow.clearTimeout(settleTimer);
      detachedWindow.removeEventListener("pagehide", close);
      detachedWindow.removeEventListener("resize", keepPhoneRatio);
      detachedWindow.removeEventListener("galaxy-phone-ratio-change", applyChangedPhoneRatio);
    };
  }, [detachedWindow]);

  function openPairing() {
    setDialog("pair");
    setPairingError(null);
    void createPairingCode();
  }

  async function createPairingCode() {
    setPairingBusy(true);
    setPairingError(null);
    try {
      const response = await fetch("/api/pairing/start", { method: "POST" });
      if (!response.ok) throw new Error(await responseError(response, "등록 코드를 만들지 못했습니다."));
      setPairing((await response.json()) as PairingInfo);
    } catch (error) {
      setPairingError(error instanceof Error ? error.message : "등록 코드를 만들지 못했습니다.");
    } finally {
      setPairingBusy(false);
    }
  }

  async function verifyPairing() {
    const hasDevice = await loadDevices();
    if (hasDevice) {
      setDialog(null);
      setToast("휴대폰 등록이 완료됐어요.");
      return;
    }
    setPairingError("아직 등록된 휴대폰이 없습니다. 앱에 코드를 입력한 뒤 다시 확인해 주세요.");
  }

  async function removeDevice(device: RegisteredDevice) {
    setRemovingDeviceId(device.id);
    try {
      if (device.id === selectedDevice?.id) await closeConnection();
      const response = await fetch(`/api/devices/${device.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response, "기기 등록을 해제하지 못했습니다."));
      await loadDevices();
      setToast(`${device.name} 등록을 해제했습니다.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "기기 등록을 해제하지 못했습니다.");
    } finally {
      setRemovingDeviceId(null);
    }
  }

  function sendPayload(payload: Record<string, unknown>) {
    const channel = channelRef.current;
    if (!channel || channel.readyState !== "open") return false;
    try { return toolsRef.current ? toolsRef.current.send(payload) : (channel.send(JSON.stringify(payload)), true); } catch { return false; }
  }

  const dispatchShortcut = useEffectEvent((command: string, label: string) => sendCommand(command, label));
  useEffect(() => {
    if (!connected || dialog) return;
    const targets = [window, ...(detachedWindow && !detachedWindow.closed ? [detachedWindow] : [])];
    const cleanups = targets.map((targetWindow) => {
      const keydown = (event: KeyboardEvent) => {
        const target = event.target as Element | null;
        const editable = target?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])");
        const phoneInput = target?.matches?.(".remote-keyboard-capture, .detached-keyboard-capture");
        const result = resolveShortcut(event, (!!editable && !phoneInput) || event.getModifierState("AltGraph"));
        if (!result.consume) return;
        event.preventDefault();
        event.stopPropagation();
        if (result.action) dispatchShortcut(result.action.command, result.action.label);
      };
      targetWindow.addEventListener("keydown", keydown, true);
      return () => { targetWindow.removeEventListener("keydown", keydown, true); };
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [connected, dialog, detachedWindow]);

  function startStats(peer: RTCPeerConnection) {
    if (peerRef.current !== peer) return;
    if (statsTimerRef.current) window.clearInterval(statsTimerRef.current);
    const sampler = new VideoStatsSampler();
    adaptiveRef.current.reset();
    let polling = false;
    const startedAt = performance.now();
    if (modeRef.current === "auto") {
      resolutionRef.current = 1080; frameRateRef.current = 30;
      setResolution(1080); setFrameRate(30);
      sendPayload({ type: "quality", shortEdge: 1080, fps: 30 });
    }
    statsTimerRef.current = window.setInterval(async () => {
      if (polling || peerRef.current !== peer) return;
      polling = true;
      try {
        const report = await peer.getStats();
        if (peerRef.current !== peer) return;
        const now = performance.now();
        const values: (Record<string, unknown> & { id: string; type: string })[] = [];
        report.forEach(stat => values.push(stat));
        const measured = sampler.sample(values, now, channelRef.current?.bufferedAmount ?? 0);
        setMetrics(measured);
        if (needsVp8Fallback(codecRef.current === "h264", codecFallbackRef.current, now - startedAt,
          measured.width ?? videoRef.current?.videoWidth ?? 0, measured.decodedFrames)) {
          queueReconnect("첫 영상 프레임을 받지 못해 VP8로 다시 시도합니다.");
          return;
        }
        const sender = toolsRef.current?.senderMetrics ?? null;
        const fresh = sender && now - sender.at < 6000 ? sender : null;
        setSenderMetrics(fresh);
        toolsRef.current?.diagnostics.record("metrics", measured);
        if (fresh) toolsRef.current?.diagnostics.record("sender", fresh);
        if (modeRef.current === "auto" && !document.hidden) {
          const next = adaptiveRef.current.update(measured, fresh, now, toolsRef.current?.supports("quality720") === true);
          if (next && sendPayload({ type: "quality", shortEdge: next.edge, fps: next.fps })) {
            resolutionRef.current = next.edge; frameRateRef.current = next.fps;
            setResolution(next.edge); setFrameRate(next.fps);
          }
        }
      } catch { /* Optional stats must not tear down an otherwise valid session. */ }
      finally { polling = false; }
    }, 1000);
  }

  async function beginConnection() {
    if (connectionStartingRef.current) return;
    connectionStartingRef.current = true;
    try {
      if (!selectedDevice) {
        openPairing();
        return;
      }
      if (!supportsNotificationApproval(selectedDevice.appVersion)) {
        setConnectionError("휴대폰 앱을 v0.4.5로 업데이트한 뒤 다시 눌러 주세요. 기기 등록은 유지됩니다.");
        setToast("앱 업데이트가 필요해요.");
        setDialog("settings");
        return;
      }
      if (!selectedDevice.online) {
        setConnectionError("휴대폰 앱에서 ‘연결 요청 알림’을 켠 뒤 다시 시도해 주세요.");
        setToast("현재 휴대폰이 오프라인이에요.");
        return;
      }

      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      intentionalCloseRef.current = false;
      await closeConnection(true, false);
      setConnection("waiting");
      setConnectionError(null);
      setConnectionHint("휴대폰으로 승인 알림을 보내는 중이에요.");

      let codecNegotiationFailed = false;
      try {
        const [sessionResponse, iceResponse] = await Promise.all([
          fetch("/api/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deviceId: selectedDevice.id }),
          }),
          fetch("/api/ice", { cache: "no-store" }),
        ]);
        if (!sessionResponse.ok) throw new Error(await responseError(sessionResponse, "연결을 시작하지 못했습니다."));
        if (!iceResponse.ok) throw new Error(await responseError(iceResponse, "네트워크 설정을 불러오지 못했습니다."));

        const { sessionId } = (await sessionResponse.json()) as { sessionId: string };
        const { iceServers } = (await iceResponse.json()) as { iceServers: RTCIceServer[] };
        diagnostics.record("connection_request", { state: "created" });
        sessionIdRef.current = sessionId;

        const peer = new RTCPeerConnection({
          iceServers,
          bundlePolicy: "max-bundle",
          iceCandidatePoolSize: 2,
        });
        peerRef.current = peer;
        const videoTransceiver = peer.addTransceiver("video", { direction: "recvonly" });
        const videoCapabilities = RTCRtpReceiver.getCapabilities?.("video");
        const codecs = preferredCodecs(videoCapabilities?.codecs ?? [], codecRef.current === "h264" && !codecFallbackRef.current);
        if (codecs.length && "setCodecPreferences" in videoTransceiver) {
          try { videoTransceiver.setCodecPreferences(codecs); }
          catch (error) { codecNegotiationFailed = true; throw error; }
        }
        requestLowBuffer(videoTransceiver.receiver);
        peer.ontrack = (event) => {
          if (peerRef.current !== peer || sessionIdRef.current !== sessionId) return;
          const stream = event.streams[0] ?? new MediaStream([event.track]);
          remoteStreamRef.current = stream;
          if (videoRef.current && videoRef.current.srcObject !== stream) videoRef.current.srcObject = stream;
          if (detachedVideoRef.current) {
            if (detachedVideoRef.current.srcObject !== stream) detachedVideoRef.current.srcObject = stream;
            void detachedVideoRef.current.play().catch(() => {
              // The canplay event retries once the first frame is ready.
            });
          }
        };
        peer.onicecandidate = (event) => {
          if (peerRef.current !== peer || sessionIdRef.current !== sessionId) return;
          const candidate = event.candidate;
          if (!candidate) return;
          const payload = candidate.toJSON();
          void fetch(`/api/sessions/${sessionId}/candidate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              candidate: payload.candidate,
              sdpMid: payload.sdpMid,
              sdpMLineIndex: payload.sdpMLineIndex,
            }),
          }).catch(() => {
            // Later candidates can still establish a direct or TURN path.
          });
        };
        peer.onconnectionstatechange = () => {
          if (peerRef.current !== peer || sessionIdRef.current !== sessionId) return;
          if (peer.connectionState === "connected") {
            if (answerPollRef.current) window.clearInterval(answerPollRef.current);
            answerPollRef.current = null;
            setConnectionError(null);
            setConnectionHint(null);
            reconnectAttemptsRef.current = 0;
            startStats(peer);
            if (channelRef.current?.readyState === "open") {
              setConnection("connected");
              setToast("휴대폰과 안전하게 연결됐어요.");
            }
          } else if (["failed", "closed"].includes(peer.connectionState) && !intentionalCloseRef.current) {
            queueReconnect("영상 연결이 끊겼습니다.");
          } else if (peer.connectionState === "disconnected" && !intentionalCloseRef.current) {
            setConnectionHint("네트워크 복구를 기다리는 중이에요.");
          }
        };

        const channel = peer.createDataChannel("control", { ordered: true });
        channelRef.current = channel;
        const tools = new RemoteClient(channel, peer, () => videoRef.current, () => remoteStreamRef.current, diagnostics);
        toolsRef.current = tools;
        setToolsClient(tools);
        channel.onopen = () => {
          if (peerRef.current !== peer || sessionIdRef.current !== sessionId) return;
          tools.opened();
          setConnection("connected");
          setConnectionError(null);
          setConnectionHint(null);
          reconnectAttemptsRef.current = 0;
          setToast("휴대폰과 안전하게 연결됐어요.");
          sendPayload({ type: "quality", shortEdge: resolutionRef.current, fps: frameRateRef.current });
          startStats(peer);
        };
        channel.onclose = () => {
          if (peerRef.current !== peer || sessionIdRef.current !== sessionId) return;
          if (peer.connectionState !== "closed" && !intentionalCloseRef.current) {
            queueReconnect("원격 조작 채널이 닫혔습니다.");
          }
        };


        try {
          const offer = await peer.createOffer({ offerToReceiveAudio: false });
          await peer.setLocalDescription(offer);
        } catch (error) { codecNegotiationFailed = true; throw error; }
        if (!peer.localDescription) throw new Error("연결 요청을 완성하지 못했습니다.");

        const offerResponse = await fetch(`/api/sessions/${sessionId}/offer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(peer.localDescription.toJSON()),
        });
        if (!offerResponse.ok) throw new Error(await responseError(offerResponse, "휴대폰으로 연결 요청을 보내지 못했습니다."));
        setConnectionHint("휴대폰 알림에서 승인 또는 거절을 선택해 주세요.");
        setToast("휴대폰으로 연결 승인 알림을 보냈어요.");

        let attempts = 0;
        let polling = false;
        let lastState = "";
        const pollAnswer = async () => {
          if (polling || sessionIdRef.current !== sessionId) return;
          polling = true;
          attempts += 1;
          try {
            const response = await fetch(`/api/sessions/${sessionId}`, { cache: "no-store" });
            if (sessionIdRef.current !== sessionId) return;
            if (!response.ok) throw new Error(await responseError(response, "연결 요청을 확인하지 못했습니다."));
            const payload = (await response.json()) as {
              session?: { state: string; answerType: string | null; answerSdp: string | null };
              candidates?: Array<{
                id: string;
                candidate: string;
                sdpMid: string | null;
                sdpMLineIndex: number | null;
              }>;
            };
            const state = payload.session?.state ?? "";
            if (state !== lastState) {
              diagnostics.record("connection_request", { state });
              lastState = state;
              if (state === "consent_pending") {
                setConnectionHint("휴대폰의 Android 화면 공유 확인창을 승인해 주세요.");
              } else if (state === "offer_ready") {
                setConnectionHint("승인 완료 · 보안 연결을 만드는 중이에요.");
              } else if (state === "answer_ready") {
                setConnectionHint("화면 스트림을 여는 중이에요.");
              }
            }
            if (state === "rejected") throw new Error("휴대폰에서 연결 요청을 거절했습니다.");
            if (state === "closed") throw new Error("연결 요청이 닫혔습니다.");
            if (payload.session?.answerType === "answer" && payload.session.answerSdp && !peer.currentRemoteDescription) {
              try { await peer.setRemoteDescription({ type: "answer", sdp: payload.session.answerSdp }); }
              catch (error) { codecNegotiationFailed = true; throw error; }
            }
            if (peer.currentRemoteDescription) {
              for (const candidate of payload.candidates ?? []) {
                if (!candidate.id || remoteCandidateIdsRef.current.has(candidate.id)) continue;
                try {
                  await peer.addIceCandidate({
                    candidate: candidate.candidate,
                    sdpMid: candidate.sdpMid,
                    sdpMLineIndex: candidate.sdpMLineIndex,
                  });
                  remoteCandidateIdsRef.current.add(candidate.id);
                } catch {
                  // A malformed or obsolete candidate should not abort the whole session.
                }
              }
            }
            if (attempts > 120) {
              throw new Error("휴대폰 응답 시간이 초과되었습니다.");
            }
          } catch (error) {
            if (sessionIdRef.current !== sessionId) return;
            if (answerPollRef.current) window.clearInterval(answerPollRef.current);
            answerPollRef.current = null;
            setConnectionError(error instanceof Error ? error.message : "연결하지 못했습니다.");
            if (codecNegotiationFailed && codecRef.current === "h264" && !codecFallbackRef.current) queueReconnect("코덱 협상을 VP8로 다시 시도합니다.");
            else void closeConnection();
          } finally {
            polling = false;
          }
        };
        answerPollRef.current = window.setInterval(() => void pollAnswer(), 500);
        void pollAnswer();
      } catch (error) {
        setConnectionError(error instanceof Error ? error.message : "연결을 시작하지 못했습니다.");
        if (codecNegotiationFailed && codecRef.current === "h264" && !codecFallbackRef.current) queueReconnect("코덱 협상을 VP8로 다시 시도합니다.");
        else await closeConnection();
      }

    } finally { connectionStartingRef.current = false; }
  }

  function queueReconnect(reason: string) {
    if (intentionalCloseRef.current || reconnectTimerRef.current) return;
    if (codecRef.current === "h264" && !codecFallbackRef.current) {
      codecFallbackRef.current = true;
      setToast("연결 복구는 VP8 기준선으로 다시 시도합니다.");
    }
    const attempt = reconnectAttemptsRef.current + 1;
    reconnectAttemptsRef.current = attempt;
    if (attempt > 4) {
      setConnectionError(`${reason} 자동 재연결에 실패했습니다. 재연결 버튼을 눌러 주세요.`);
      void closeConnection(false, false);
      return;
    }
    const delay = Math.min(8_000, 1_000 * (2 ** (attempt - 1)));
    reconnectTimerRef.current = -1;
    void closeConnection(false, false).then(() => {
      setConnection("reconnecting");
      setConnectionError(null);
      setConnectionHint(`${reason} ${Math.round(delay / 1000)}초 후 재연결합니다. (${attempt}/4)`);
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        void beginConnection();
      }, delay);
    });
  }

  function sendCommand(command: string, label: string) {
    interactionEngineRef.current?.cancel("휴대폰 탐색");
    livePointerRef.current?.sender.finish("cancel");
    livePointerRef.current?.cleanup();
    livePointerRef.current = null;
    const pointer = pointerStartRef.current;
    pointerStartRef.current = null;
    if (pointer?.target.hasPointerCapture(pointer.pointerId)) pointer.target.releasePointerCapture(pointer.pointerId);
    if (!sendPayload({ type: "global", action: command })) return;
    setToast(`${label} 명령을 전송했습니다.`);
  }

  function changeVolume(next: number) {
    const normalized = Math.max(0, Math.min(100, next));
    setVolume(normalized);
    setVolumeKnown(true);
    if (connected) sendPayload({ type: "volume", value: normalized });
  }

  function changeResolution(next: ResolutionSetting) {
    modeRef.current = "custom"; setQualityMode("custom");
    if (next === 1440 && frameRateRef.current === 60) { frameRateRef.current = 30; setFrameRate(30); }
    resolutionRef.current = next;
    setResolution(next);
    if (connected) {
      if (sendPayload({ type: "quality", shortEdge: next, fps: next === 1440 ? Math.min(frameRate, 30) : frameRate })) {
        setToast("휴대폰에서 해상도를 적용하는 중이에요.");
      }
    }
  }

  function changeFrameRate(next: FrameRateSetting) {
    modeRef.current = "custom"; setQualityMode("custom");
    if (resolution === 1440 && next === 60) next = 30;
    frameRateRef.current = next;
    setFrameRate(next);
    if (connected) {
      if (sendPayload({ type: "quality", shortEdge: resolution, fps: next })) {
        setToast("휴대폰에서 프레임을 적용하는 중이에요.");
      }
    }
  }

  function changePcMode(next: PcMode) {
    setPcMode(next);
    if (next === "public") {
      setDetachedOpacity(100);
    }
    setToast(next === "public" ? "공용 PC 모드로 전환했습니다." : "개인 PC 설정을 기억합니다.");
  }

  async function endPublicSession() {
    await closeConnection(true, true);
    setDetachedOpacity(100);
    window.localStorage.removeItem("galaxy-remote-pc-mode");
    window.localStorage.removeItem("galaxy-remote-detached-opacity");
    window.sessionStorage.clear();
    if (detachedWindow && !detachedWindow.closed) detachedWindow.close();
    setDetachedWindow(null);
    window.location.assign(signOutPath);
  }

  function flushTextBuffer() {
    if (textFlushTimerRef.current) window.clearTimeout(textFlushTimerRef.current);
    textFlushTimerRef.current = null;
    const value = textBufferRef.current;
    textBufferRef.current = "";
    if (value) sendPayload({ type: "text", value });
  }

  function queueText(value: string) {
    if (!connected || !value) return;
    textBufferRef.current += value;
    if (textFlushTimerRef.current) window.clearTimeout(textFlushTimerRef.current);
    textFlushTimerRef.current = window.setTimeout(flushTextBuffer, 45);
  }

  function sendKey(key: "backspace" | "delete" | "enter") {
    flushTextBuffer();
    sendPayload({ type: "key", key });
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await phoneViewRef.current?.requestFullscreen();
    } catch {
      setToast("브라우저가 전체화면 전환을 허용하지 않았어요.");
    }
  }

  async function toggleDetachedScreen() {
    if (detachedWindow && !detachedWindow.closed) {
      detachedWindow.close();
      setDetachedWindow(null);
      return;
    }
    const ratio = (videoRef.current?.videoWidth && videoRef.current.videoHeight)
      ? videoRef.current.videoWidth / videoRef.current.videoHeight
      : 9 / 19.5;
    detachedRatioRef.current = ratio;
    const height = Math.min(820, Math.max(520, window.screen.availHeight * 0.72));
    const width = Math.round(height * ratio);
    try {
      // A normal script-opened popup permits resizeTo(), unlike Document PiP
      // windows whose size is controlled by the browser/OS.
      const nextWindow = window.open(
        "",
        "galaxy-remote-screen",
        `popup=yes,width=${width},height=${height},resizable=yes`,
      ) ?? null;
      if (!nextWindow) throw new Error("popup-blocked");
      nextWindow.document.title = `${selectedDevice?.name ?? "Galaxy"} 화면`;
      const style = nextWindow.document.createElement("style");
      style.textContent = `
        * { box-sizing: border-box; }
        html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #070b12; }
        .detached-screen-shell { position: fixed; inset: 0; display: grid; place-items: center; overflow: hidden; background: #070b12; }
        .detached-phone-view { position: relative; width: 100vw; height: 100vh; overflow: hidden; cursor: crosshair; touch-action: none; background: #070b12; user-select: none; }
        .detached-phone-view video { display: block; width: 100%; height: 100%; object-fit: contain; background: #070b12; }
        .detached-message { position: absolute; inset: 0; display: grid; place-items: center; padding: 24px; color: #dbe8fb; background: linear-gradient(145deg, #121c2c, #070b12); font: 750 13px Pretendard, "Noto Sans KR", sans-serif; text-align: center; }
        .detached-keyboard-capture { position: absolute; width: 1px; height: 1px; opacity: .01; pointer-events: none; }
      `;
      nextWindow.document.head.appendChild(style);
      setDetachedWindow(nextWindow);
      nextWindow.focus();
    } catch {
      setToast("화면 창을 열지 못했습니다. 브라우저의 팝업 권한을 확인해 주세요.");
    }
  }

  useEffect(() => {
    livePointerRef.current?.sender.finish("cancel");
    livePointerRef.current?.cleanup();
    livePointerRef.current = null;
    const held = pointerStartRef.current; pointerStartRef.current = null;
    if (held?.target.hasPointerCapture(held.pointerId)) held.target.releasePointerCapture(held.pointerId);
    interactionEngineRef.current?.cancel("화면 회전/해상도 변경");
    releaseModeInputs();
  }, [metrics.width, metrics.height, videoAspectRatio]);

  function normalizedPointer(event: React.PointerEvent<HTMLDivElement>, targetVideo?: HTMLVideoElement | null) {
    const video = targetVideo ?? videoRef.current;
    const bounds = video?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
    return normalizedVideoPoint(
      event.clientX,
      event.clientY,
      bounds,
      { width: video?.videoWidth ?? 0, height: video?.videoHeight ?? 0 },
    );
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>, targetVideo?: HTMLVideoElement | null) {
    if (!connected || !event.isPrimary || event.button !== 0 || pointerStartRef.current) return;
    const point = normalizedPointer(event, targetVideo);
    if (!point.inside) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerStartRef.current = { ...point, at: event.timeStamp, pointerId: event.pointerId,
      target: event.currentTarget, clientX: event.clientX, clientY: event.clientY, moved: false };
  }

  function startLivePointer(event: React.PointerEvent<HTMLDivElement>, start: {x:number;y:number}, point: {x:number;y:number}) {
    const client = toolsRef.current;
    const owner = event.currentTarget.ownerDocument.defaultView;
    if (client?.supports("liveTouch") && owner) {
      const target = event.currentTarget, pointerId = event.pointerId;
      const cancel = () => {
        livePointerRef.current?.sender.finish("cancel");
        livePointerRef.current?.cleanup();
        livePointerRef.current = null;
        pointerStartRef.current = null;
        if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      };
      const visibility = () => { if (target.ownerDocument.hidden) cancel(); };
      const cleanup = () => { owner.removeEventListener("blur", cancel); owner.removeEventListener("pagehide", cancel); target.ownerDocument.removeEventListener("visibilitychange", visibility); };
      const sender = new LiveTouchSender(packet => client.sendTouch(packet), owner, { x: start.x, y: start.y }, crypto.randomUUID(), cancel, client.supports("lowLatencyInput") ? 16 : 32);
      if (!sender.started) { cancel(); setToast("터치를 보내지 못했어요. 연결을 확인해 주세요."); return; }
      sender.move(point);
      livePointerRef.current = { sender, cleanup };
      owner.addEventListener("blur", cancel);
      owner.addEventListener("pagehide", cancel);
      target.ownerDocument.addEventListener("visibilitychange", visibility);
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>, targetVideo?: HTMLVideoElement | null) {
    const start = pointerStartRef.current;
    if (!start || start.pointerId !== event.pointerId || start.target !== event.currentTarget) return;
    const point = normalizedPointer(event, targetVideo);
    if (!start.moved && Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) >= 8) {
      start.moved = true;
      startLivePointer(event, start, point);
    } else livePointerRef.current?.sender.move(point);
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>, targetVideo?: HTMLVideoElement | null) {
    const start = pointerStartRef.current;
    if (!start || start.pointerId !== event.pointerId || start.target !== event.currentTarget) return;
    pointerStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!connected) return;
    const end = normalizedPointer(event, targetVideo);
    if (livePointerRef.current) {
      livePointerRef.current.sender.finish("up", end);
      livePointerRef.current.cleanup();
      livePointerRef.current = null;
      (targetVideo ? detachedKeyboardRef : keyboardRef).current?.focus({ preventScroll: true });
      return;
    }
    const moved = start.moved || Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) >= 8;
    const durationMs = Math.min(1200, Math.max(60, event.timeStamp - start.at));
    // Clamp releases outside the image to its edge instead of dropping the drag.
    if (moved) sendPayload({ type: "swipe", fromX: start.x, fromY: start.y, toX: end.x, toY: end.y, durationMs: Math.min(400, durationMs) });
    else sendPayload(durationMs >= 520 ? { type: "longPress", x: start.x, y: start.y, durationMs } : { type: "tap", x: start.x, y: start.y });
    (targetVideo ? detachedKeyboardRef : keyboardRef).current?.focus({ preventScroll: true });
  }

  function onPointerCancel(event: React.PointerEvent<HTMLDivElement>) {
    const start = pointerStartRef.current;
    if (start?.pointerId !== event.pointerId || start.target !== event.currentTarget) return;
    livePointerRef.current?.sender.finish("cancel");
    livePointerRef.current?.cleanup();
    livePointerRef.current = null;
    pointerStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function sendViewportSwipe(direction: "up" | "down" | "left" | "right") {
    const points = {
      up: { fromX: 0.5, fromY: 0.76, toX: 0.5, toY: 0.28 },
      down: { fromX: 0.5, fromY: 0.28, toX: 0.5, toY: 0.76 },
      left: { fromX: 0.78, fromY: 0.5, toX: 0.24, toY: 0.5 },
      right: { fromX: 0.24, fromY: 0.5, toX: 0.78, toY: 0.5 },
    } as const;
    sendPayload({ type: "swipe", ...points[direction], durationMs: 220 });
  }

  function onModePointerDown(event: React.PointerEvent<HTMLDivElement>, targetVideo?: HTMLVideoElement | null) {
    interaction.activity();
    const p=interaction.profile;
    if(interaction.editing){const point=normalizedPointer(event,targetVideo);if(point.inside)interaction.pick(point.x,point.y);event.preventDefault();return;}
    if(!connected||dialog)return;
    interaction.engine.manual();interaction.engine.time(performance.now());
    if(p.mode!=="game"&&p.zoom>1&&event.shiftKey){
      event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
      modePointersRef.current.set(event.pointerId,{kind:"pan",x:event.clientX,y:event.clientY,target:event.currentTarget});return;
    }
    if(p.mode==="game"&&p.mappingEnabled){
      const point=normalizedPointer(event,targetVideo);if(!point.inside)return;
      event.preventDefault();event.currentTarget.focus();
      const key=`Mouse${event.button}`,mapped=p.bindings.some(b=>b.key===key);
      const accepted=mapped?interaction.engine.button(key,true):interaction.engine.down(`mouse:${event.pointerId}`,point);
      if(!accepted){setToast("입력 거부: 새 앱 지원과 멀티터치 실험 설정을 확인하세요.");return;}
      event.currentTarget.setPointerCapture(event.pointerId);
      modePointersRef.current.set(event.pointerId,{kind:mapped?"mapped":"pointer",key,x:event.clientX,y:event.clientY,target:event.currentTarget});return;
    }
    onPointerDown(event,targetVideo);
  }
  function onModePointerMove(event: React.PointerEvent<HTMLDivElement>, targetVideo?: HTMLVideoElement | null) {
    interaction.activity();const pointer=modePointersRef.current.get(event.pointerId);
    if(pointer?.kind==="pan"){
      const b=event.currentTarget.getBoundingClientRect(),z=interaction.profile.zoom;
      const dx=event.clientX-pointer.x,dy=event.clientY-pointer.y;pointer.x=event.clientX;pointer.y=event.clientY;
      interaction.setPan(old=>({x:Math.max(-(z-1)*b.width/2,Math.min((z-1)*b.width/2,old.x+dx)),y:Math.max(-(z-1)*b.height/2,Math.min((z-1)*b.height/2,old.y+dy))}));return;
    }
    if(pointer?.kind==="pointer"){interaction.engine.move(`mouse:${event.pointerId}`,normalizedPointer(event,targetVideo));return;}
    if(pointer||interaction.editing)return;
    onPointerMove(event,targetVideo);
  }
  function onModePointerUp(event: React.PointerEvent<HTMLDivElement>, targetVideo?: HTMLVideoElement | null) {
    const pointer=modePointersRef.current.get(event.pointerId);
    if(pointer){modePointersRef.current.delete(event.pointerId);if(pointer.kind==="mapped")interaction.engine.button(pointer.key!,false);if(pointer.kind==="pointer")interaction.engine.up(`mouse:${event.pointerId}`);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);return;}
    if(interaction.editing)return;
    const start=pointerStartRef.current;
    if(interaction.profile.mode!=="game"&&start&&!start.moved&&Math.hypot(event.clientX-start.clientX,event.clientY-start.clientY)<8&&interaction.engine.pageClick(normalizedPointer(event,targetVideo).x)){
      onPointerCancel(event);event.currentTarget.focus();return;
    }
    onPointerUp(event,targetVideo);
    if(interaction.profile.mode!=="game")event.currentTarget.focus();
  }
  function onModePointerCancel(event: React.PointerEvent<HTMLDivElement>) {
    const pointer=modePointersRef.current.get(event.pointerId);
    if(pointer){
      modePointersRef.current.delete(event.pointerId);
      if(pointer.kind==="mapped")interaction.engine.up(`mapped:${pointer.key}`,true);
      if(pointer.kind==="pointer")interaction.engine.up(`mouse:${event.pointerId}`,true);
      if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    onPointerCancel(event);
  }
  function onModeWheel(event: React.WheelEvent<HTMLDivElement>) {
    interaction.activity();
    if(interaction.editing){event.preventDefault();return;}
    if(interaction.profile.mode!=="game"){
      if(!connected||dialog)return;event.preventDefault();event.currentTarget.focus();
      interaction.engine.wheel(event.deltaY||event.deltaX,event.deltaMode,event.currentTarget.clientHeight);return;
    }
    if(interaction.profile.mappingEnabled&&interaction.engine.pointerCount){event.preventDefault();return;}
    onRemoteWheel(event);
  }

  function onRemoteWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!connected) return;
    if (pointerStartRef.current) { event.preventDefault(); return; }
    event.preventDefault();
    wheelDeltaRef.current.x += event.deltaX;
    wheelDeltaRef.current.y += event.deltaY;
    if (wheelFlushTimerRef.current) window.clearTimeout(wheelFlushTimerRef.current);
    wheelFlushTimerRef.current = window.setTimeout(() => {
      const { x, y } = wheelDeltaRef.current;
      wheelDeltaRef.current = { x: 0, y: 0 };
      wheelFlushTimerRef.current = null;
      if (Math.max(Math.abs(x), Math.abs(y)) < 6) return;
      if (Math.abs(y) >= Math.abs(x)) {
        sendViewportSwipe(y > 0 ? "up" : "down");
      } else {
        sendViewportSwipe(x > 0 ? "left" : "right");
      }
    }, 55);
  }

  function handleDirectionKey(event: React.KeyboardEvent<HTMLElement>) {
    const direction = {
      ArrowUp: "down",
      ArrowDown: "up",
      ArrowLeft: "right",
      ArrowRight: "left",
    }[event.key] as "up" | "down" | "left" | "right" | undefined;
    if (!connected || !direction || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return false;
    event.preventDefault();
    sendViewportSwipe(direction);
    return true;
  }

  function onPhoneKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!connected || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.target !== event.currentTarget) return;
    if (handleDirectionKey(event)) return;
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      queueText(event.key);
    } else if (event.key === "Backspace") {
      event.preventDefault();
      sendKey("backspace");
    } else if (event.key === "Delete") {
      event.preventDefault();
      sendKey("delete");
    } else if (event.key === "Enter") {
      event.preventDefault();
      sendKey("enter");
    }
  }

  function onKeyboardInput(event: React.FormEvent<HTMLInputElement>) {
    if (!connected || composingRef.current) return;
    const input = event.currentTarget;
    if (input.value) queueText(input.value);
    input.value = "";
  }

  function onKeyboardCompositionEnd(event: React.CompositionEvent<HTMLInputElement>) {
    composingRef.current = false;
    if (connected && event.data) queueText(event.data);
    event.currentTarget.value = "";
  }

  function onKeyboardKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!connected || event.ctrlKey || event.altKey || event.metaKey) return;
    if (handleDirectionKey(event)) return;
    if (event.key === "Backspace") {
      event.preventDefault();
      sendKey("backspace");
    } else if (event.key === "Delete") {
      event.preventDefault();
      sendKey("delete");
    } else if (event.key === "Enter") {
      event.preventDefault();
      sendKey("enter");
    }
  }

  return (
    <main className="remote-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="orbit-mark" aria-hidden="true"><span /></div>
          <div><h1>Galaxy Remote <span className="version-label">v0.5.3</span></h1></div>
          <span className={`connection-pill ${connection}`}><span className="status-dot" />{connected ? "연결됨" : connection === "reconnecting" ? "재연결 중" : waiting ? "승인 대기" : "연결 준비"}</span>
        </div>
        <div className="owner-area">
          <ThemeToggle />
          <div className="pc-session"><span>{pcMode === "public" ? "공용 PC 사용 중" : "개인 PC"}</span><button type="button" onClick={() => void endPublicSession()}>사용 종료</button></div>
          <div className="avatar" aria-hidden="true">{initials}</div>
          <div className="owner-copy"><strong>{displayName}</strong><span>{email ? "Owner" : "소유자 전용"}</span></div>
          <button className="icon-button" type="button" aria-label="설정" onClick={() => setDialog("settings")}>⚙</button>
        </div>
      </header>

      <section className="console-grid" aria-label="원격 조작 화면">
        <article className={`screen-card interaction-view mode-${interaction.profile.mode} ${interaction.profile.mode!=="game"&&interaction.profile.minimal?"reading-minimal":""} ${interaction.status.idle?"reading-idle":""}`} ref={viewerRef}>
          <InteractionControls control={interaction} personal={pcMode==="personal"} connected={connected} focusViewer={focusInteractionViewer}/>
          <p className="interaction-note">모드: {interaction.profile.mode==="game"?"게임":interaction.profile.mode==="novel"?"소설":"웹툰"} · 모드 전환은 연결을 유지합니다.</p>
          <div className="card-heading">
            <div><p className="eyebrow">LIVE SCREEN</p><h2>휴대폰 화면</h2></div>
            <div className="screen-heading-actions">
              <select
                className="device-select"
                aria-label="원격 기기 선택"
                value={selectedDevice?.id ?? ""}
                onChange={(event) => setSelectedDeviceId(event.target.value || null)}
              >
                {devices.length ? devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>) : <option value="">등록된 기기 없음</option>}
              </select>
              <details className="display-settings"><summary>화면 설정</summary><div className="display-settings-panel">
              <label>품질 모드<select aria-label="영상 품질 모드" value={qualityMode} onChange={event => {
                const mode = event.target.value as QualityMode;
                modeRef.current = mode; setQualityMode(mode); adaptiveRef.current.reset();
                const preset = mode === "auto" || mode === "custom" ? QUALITY_PRESETS.balanced : QUALITY_PRESETS[mode];
                resolutionRef.current = preset.edge; frameRateRef.current = preset.fps;
                setResolution(preset.edge); setFrameRate(preset.fps);
                if (connected) sendPayload({ type: "quality", shortEdge: preset.edge, fps: preset.fps });
              }}>
                {Object.entries(QUALITY_PRESETS).map(([key, value]) => <option key={key} value={key} disabled={key === "stable" && connected && !toolsRef.current?.supports("quality720")}>{value.label} · {value.edge}p/{value.fps}fps</option>)}
                <option value="auto">자동 · 네트워크에 따라 조절</option><option value="custom">사용자 지정</option>
              </select></label>
              <label>연결 코덱<select aria-label="영상 코덱" disabled={connected || waiting} value={codecMode} onChange={event => {
                setCodecMode(event.target.value); codecRef.current = event.target.value; codecFallbackRef.current = false;
              }}><option value="vp8">VP8 · 기본</option><option value="h264">H.264 우선 · VP8 fallback (실험)</option></select></label>
              <label>해상도<select
                className="quality-select"
                aria-label="화면 해상도"
                value={resolution}
                onChange={(event) => changeResolution(Number(event.target.value) as ResolutionSetting)}
              >
                <option value={540}>540p</option>
                <option value={720} disabled={connected && !toolsRef.current?.supports("quality720")}>720p</option>
                <option value={1080}>1080p</option>
                <option value={1440}>1440p</option>
              </select></label><label>초당 프레임<select
                className="quality-select"
                aria-label="화면 프레임"
                value={frameRate}
                onChange={(event) => changeFrameRate(Number(event.target.value) as FrameRateSetting)}
              >
                <option value={24}>24fps</option>
                <option value={30}>30fps</option>
                <option value={60}>60fps</option>
              </select></label><label>분리 창 투명도<select
                className="quality-select"
                aria-label="분리 창 투명도"
                title="분리 창 투명도"
                value={detachedOpacity}
                onChange={(event) => setDetachedOpacity(Number(event.target.value))}
              >
                <option value={25}>투명도 25%</option>
                <option value={50}>투명도 50%</option>
                <option value={75}>투명도 75%</option>
                <option value={100}>투명도 100%</option>
              </select></label></div></details>
              <button className="viewer-button" type="button" title="화질을 낮추고 화면 갱신을 늘려 반응 속도를 우선합니다." onClick={() => {
                modeRef.current = "custom"; setQualityMode("custom");
                resolutionRef.current = 540; frameRateRef.current = 60;
                setResolution(540); setFrameRate(60);
                if (connected) sendPayload({ type: "quality", shortEdge: 540, fps: 60 });
                setToast("반응 속도 우선 설정을 선택했어요.");
              }}>반응 속도 우선</button>
              <button className="viewer-button" type="button" aria-pressed={Boolean(detachedWindow)} onClick={() => void toggleDetachedScreen()}>
                {detachedWindow ? "화면 창 닫기" : "화면 분리"}
              </button>
              <button className="viewer-button" type="button" onClick={() => void toggleFullscreen()}>전체화면</button>
              <span className={`live-badge ${connected ? "active" : ""}`}><span /> {connected ? "LIVE" : "OFFLINE"}</span>
            </div>
          </div>
          <div className="screen-stage">
            <div
              className={`phone-view ${videoAspectRatio > 1 ? "is-landscape" : "is-portrait"} ${connected ? "is-live" : ""}`}
              ref={phoneViewRef}
              style={{ aspectRatio: videoAspectRatio }}
              tabIndex={connected ? 0 : -1}
              role="application"
              aria-label="연결된 휴대폰 원격 화면"
              onPointerDown={(event) => onModePointerDown(event)}
              onPointerMove={(event) => onModePointerMove(event)}
              onPointerUp={(event) => onModePointerUp(event)}
              onPointerCancel={onModePointerCancel}
              onLostPointerCapture={onModePointerCancel}
              onWheel={onModeWheel}
              onKeyDown={e=>{if(interaction.editing){e.preventDefault();return;}if(interaction.profile.mode!=="game"||!interaction.profile.mappingEnabled)onPhoneKeyDown(e);}}
              onContextMenu={e=>{if(interaction.profile.mode==="game"&&interaction.profile.mappingEnabled)e.preventDefault();}}
            >
              <video
                ref={videoRef}
                style={interaction.profile.mode!=="game"?{transform:`translate(${interaction.pan.x}px, ${interaction.pan.y}px) scale(${interaction.profile.zoom})`}:undefined}
                autoPlay
                playsInline
                aria-label="연결된 휴대폰 화면"
                onLoadedMetadata={(event) => syncVideoAspectRatio(event.currentTarget)}
                onResize={(event) => syncVideoAspectRatio(event.currentTarget)}
              />
              {interaction.editing&&<InteractionOverlay profile={interaction.profile} selected={interaction.selectedBinding} video={videoRef} host={phoneViewRef}/>}
              <input
                ref={keyboardRef}
                disabled={interaction.editing}
                className="remote-keyboard-capture"
                aria-label="휴대폰에 보낼 키보드 입력"
                autoCapitalize="off"
                autoComplete="off"
                spellCheck={false}
                onCompositionStart={() => { composingRef.current = true; }}
                onCompositionEnd={onKeyboardCompositionEnd}
                onInput={onKeyboardInput}
                onKeyDown={onKeyboardKeyDown}
              />
              {!connected && (
                <div className="screen-placeholder">
                  <div className="placeholder-orbit" aria-hidden="true"><span /></div>
                  <strong>{waiting ? "휴대폰 응답을 기다리는 중" : selectedDevice ? "휴대폰이 아직 연결되지 않았어요" : "아직 등록된 휴대폰이 없어요"}</strong>
                  <p>{waiting ? "휴대폰 알림을 확인해 주세요. 자동 연결 준비 상태라면 바로 연결됩니다." : selectedDevice ? "휴대폰의 연결 요청 알림을 켜두면 여기서 바로 요청할 수 있어요." : "전용 앱으로 기기를 등록하면 이곳에서 바로 보고 조작할 수 있어요."}</p>
                  <button type="button" onClick={() => { if (selectedDevice) void beginConnection(); else openPairing(); }}>{selectedDevice ? "연결 시작" : "기기 등록하기"}</button>
                </div>
              )}
            </div>
          </div>
          <div className="screen-help"><span aria-hidden="true">ⓘ</span>실시간 드래그는 휴대폰 앱 v0.5.3 이상에서 사용할 수 있어요. 클릭·휠·방향키도 지원합니다. 일부 보안·DRM 앱은 Android 정책상 화면이 검게 표시될 수 있습니다.</div>
        </article>

        {detachedWindow && createPortal(
          <main className="detached-screen-shell">
            <div
              className={`detached-phone-view ${connected ? "is-live" : ""}`}
              tabIndex={connected ? 0 : -1}
              role="application"
              aria-label="분리된 휴대폰 원격 화면"
              onPointerDown={(event) => onModePointerDown(event, detachedVideoRef.current)}
              onPointerMove={(event) => onModePointerMove(event, detachedVideoRef.current)}
              onPointerUp={(event) => onModePointerUp(event, detachedVideoRef.current)}
              onPointerCancel={onModePointerCancel}
              onLostPointerCapture={onModePointerCancel}
              onWheel={onModeWheel}
              onKeyDown={(event) => { handleDirectionKey(event); }}
            >
              <video
                ref={attachDetachedVideo}
                autoPlay
                muted
                playsInline
                style={{ opacity: detachedOpacity / 100, transform: interaction.profile.mode!=="game"?`translate(${interaction.pan.x}px, ${interaction.pan.y}px) scale(${interaction.profile.zoom})`:undefined }}
                aria-label="분리된 휴대폰 화면"
                onCanPlay={(event) => { void event.currentTarget.play(); }}
                onLoadedMetadata={(event) => {
                  syncVideoAspectRatio(event.currentTarget);
                }}
                onResize={(event) => {
                  syncVideoAspectRatio(event.currentTarget);
                }}
              />
              <input
                ref={detachedKeyboardRef}
                disabled={interaction.editing}
                className="detached-keyboard-capture"
                aria-label="분리 창 휴대폰 키보드 입력"
                autoCapitalize="off"
                autoComplete="off"
                spellCheck={false}
                onCompositionStart={() => { composingRef.current = true; }}
                onCompositionEnd={onKeyboardCompositionEnd}
                onInput={onKeyboardInput}
                onKeyDown={onKeyboardKeyDown}
              />
              {!connected && <div className="detached-message">휴대폰 연결을 기다리는 중이에요.</div>}
            </div>
          </main>,
          detachedWindow.document.body,
        )}

        <aside className="control-rail" aria-label="원격 제어 도구">
          <section className="control-card connect-card">
            <p className="eyebrow">REMOTE CONTROL</p><h2>원격 제어</h2>
            <p>{connectionError ?? connectionHint ?? (waiting ? "휴대폰 응답을 기다리고 있어요." : connected ? "암호화된 연결을 사용하고 있어요." : selectedDevice ? "자동 연결 준비 상태이면 바로 연결됩니다. 그 외에는 휴대폰에서 승인해 주세요." : "먼저 휴대폰을 등록해 주세요.")}</p>
            <button className="primary-action" type="button" onClick={() => { if (selectedDevice) void beginConnection(); else openPairing(); }} aria-busy={waiting || connection === "reconnecting"}>
              {waiting || connection === "reconnecting" ? <><span className="spinner" /> {connection === "reconnecting" ? "재연결 중 · 다시 시도" : "승인 대기 · 다시 시도"}</> : connected ? "연결 새로고침" : selectedDevice ? (connectionError ? "재연결" : "연결 시작") : "기기 등록"}
            </button>
            <div className="device-row">
              <span className={`status-dot ${selectedDevice?.online ? "online" : ""}`} /><strong>{selectedDevice?.name ?? "등록된 기기 없음"}</strong>
              <span>{selectedDevice ? `${selectedDevice.online ? "온라인" : "오프라인"}${selectedDevice.batteryLevel !== null ? ` · ${selectedDevice.batteryLevel}%` : ""}` : "미등록"}</span>
            </div>
          </section>

          {!selectedDevice && <section className="control-card setup-guide"><h3>처음 연결하나요?</h3><ol><li><strong>휴대폰에 앱 설치</strong><p>‘기기 등록’을 열어 설치 파일을 받으세요.</p></li><li><strong>6자리 코드 입력</strong><p>휴대폰 앱에 웹에서 만든 코드를 입력하세요.</p></li><li><strong>연결 준비</strong><p>앱에서 조작 권한과 연결 요청 알림을 켜세요. 원격 키보드는 선택 사항입니다.</p></li></ol></section>}
          {selectedDevice && <>
          <section className="control-card quick-card">
            <div className="section-title-row"><h3>빠른 제어</h3><span>{connected ? "사용 가능" : "연결 후 사용"}</span></div>
            <div className="quick-grid">
              {controls.map((control) => <button key={control.command} type="button" disabled={!connected} onClick={() => sendCommand(control.command, control.label)}><span aria-hidden="true">{control.icon}</span>{control.label}</button>)}
            </div>
            <details className="install-help"><summary>키보드 단축키</summary>
              <div className="shortcut-lines">
                <div>최근 앱 : <kbd>Alt + R</kbd></div>
                <div>홈 : <kbd>Alt + H</kbd></div>
                <div>뒤로가기 : <kbd>Alt + B</kbd></div>
              </div>
              <p>연결 중인 사이트·분리 창에서 사용합니다.<br />일반 입력란과 설정창에서는 작동하지 않습니다.</p>
            </details>
          </section>

          <RemoteTools key={toolsClient?.id ?? "offline"} client={toolsClient} diagnostics={diagnostics} />

          <section className="control-card volume-card">
            <div className="volume-label"><strong>볼륨 설정</strong><span aria-hidden="true">◖))</span></div>
            <button type="button" disabled={!connected} aria-label="볼륨 낮추기" onClick={() => changeVolume(volume - 5)}>−</button>
            <input type="range" min="0" max="100" value={volume} disabled={!connected} aria-label="휴대폰 볼륨 설정" aria-valuetext={connected && volumeKnown ? `${volume}%` : "아직 볼륨을 설정하지 않음"} onChange={(event) => changeVolume(Number(event.target.value))} style={{ "--volume": `${volume}%` } as React.CSSProperties} />
            <output>{connected && volumeKnown ? `${volume}%` : "—"}</output><button type="button" disabled={!connected} aria-label="볼륨 높이기" onClick={() => changeVolume(volume + 5)}>+</button>
          </section>

          {connected && <details className="control-card connection-details"><summary>상세 연결 정보</summary>          <div className="metrics-card" aria-label="연결 정보">
            <div className="metric"><span className="metric-icon">↔</span><small>경로</small><strong>{connected ? metrics.path === "turn" ? "중계" : metrics.path === "direct" ? "직접" : "확인 중" : "—"}</strong></div>
            <div className="metric"><span className="metric-icon">▮▮▮</span><small>네트워크 RTT</small><strong>{connected && metrics.latency !== null ? `${metrics.latency} ms` : "—"}</strong></div>
            <div className="metric"><span className="metric-icon">HD</span><small>해상도</small><strong>{connected && metrics.width && metrics.height ? `${metrics.width}×${metrics.height}` : "—"}</strong></div>
            <div className="metric"><span className="metric-icon">▶</span><small>프레임</small><strong>{connected && metrics.fps !== null ? `${metrics.fps} fps` : "—"}</strong></div>
            <div className="metric"><span className="metric-icon">⇣</span><small>비트레이트</small><strong>{connected && metrics.bitrateKbps !== null ? `${metrics.bitrateKbps} kbps` : "—"}</strong></div>
            <div className="metric"><span className="metric-icon">%</span><small>손실</small><strong>{connected && metrics.packetLoss !== null ? `${metrics.packetLoss}%` : "—"}</strong></div>
          </div>

            <p>RTT는 입력부터 화면 표시까지의 종단 지연이 아닙니다. 종단 지연: 미측정.</p>
            <p>코덱: {metrics.codec ?? "확인 불가"} · 디코딩: {metrics.decodeMs === null ? "확인 불가" : `${metrics.decodeMs.toFixed(1)} ms/프레임`} · 지터 버퍼: {metrics.jitterMs === null ? "확인 불가" : `${metrics.jitterMs.toFixed(1)} ms`}</p>
            <p>구간 드롭: {metrics.dropped ?? "확인 불가"} · {metrics.stalled ? "새 프레임 없음 (정지 화면일 수도 있음)" : "프레임 정지 미감지"} · 입력 전송 대기: {metrics.bufferedBytes} bytes</p>
            <p>Android 캡처/송신 FPS: {senderMetrics?.captureFps?.toFixed(1) ?? "확인 불가"} / {senderMetrics?.sendFps?.toFixed(1) ?? "확인 불가"} · 송신: {senderMetrics?.sendKbps?.toFixed(0) ?? "확인 불가"} kbps</p>
            <p>인코딩: {senderMetrics?.encodeMs?.toFixed(1) ?? "확인 불가"} ms/프레임 · 인코더: {senderMetrics?.encoder ?? "확인 불가"} · 전력 효율 인코더 지표: {senderMetrics?.hardwareEncoder === null || !senderMetrics ? "확인 불가" : String(senderMetrics.hardwareEncoder)}</p>
            <p>적용 제한: {senderMetrics?.configuredEdge ?? "—"}p/{senderMetrics?.configuredFps ?? "—"}fps · RTP 제한 수락: {senderMetrics?.rtpLimitsApplied === null || !senderMetrics ? "확인 불가" : String(senderMetrics.rtpLimitsApplied)} · 열 상태: {senderMetrics?.thermal ?? "확인 불가"} · 품질 모드: {qualityMode === "auto" ? "자동" : "수동 (기기 안전 제한은 적용)"}</p>

</details>}
          <button className="disconnect-button" type="button" disabled={!connected && !waiting} onClick={() => setDialog("disconnect")}>연결 해제</button>
          </>}
          <section className="privacy-note"><span className="shield" aria-hidden="true">◇</span><div><strong>휴대폰에서 허용한 동안만 연결해요</strong><p>일반 연결은 휴대폰에서 승인합니다. 앱에서 자동 연결을 준비한 동안에는 추가 승인 없이 연결됩니다. 영상과 키 입력은 서버에 저장하지 않습니다.</p></div></section>
        </aside>
      </section>

      {dialog === "pair" && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDialog(null)}>
          <section ref={modalRef} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="pair-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" aria-label="닫기" onClick={() => setDialog(null)}>×</button>
            <p className="eyebrow">DEVICE PAIRING</p><h2 id="pair-title">갤럭시를 등록해 주세요</h2>
            <p>Galaxy Remote 앱을 연 다음 아래 6자리 코드를 입력하면 이 계정에 안전하게 등록됩니다.</p>
            <h3>1. 휴대폰에 앱 설치</h3>
            <a className="android-project-link" href="/downloads/GalaxyRemote-0.5.3-release.apk" download>
              <span aria-hidden="true">↓</span>
              <strong>Galaxy Remote v0.5.3 받기</strong>
              <small>새 기능 7종 · 기존 서명키 사용 · 실제 휴대폰 설치 검증 전</small>
            </a>
            <a className="android-project-link" href="/downloads/GalaxyRemote-0.4.5-rotation-fixed-release.apk" download>
              <span aria-hidden="true">↓</span>
              <strong>기존 Galaxy Remote v0.4.5 받기</strong>
              <small>Galaxy arm64 v0.4.5 · 15MB · 화면 회전·입력 안내 문구 오인식 수정</small>
            </a>
            <details className="install-help"><summary>기존 앱을 업데이트하나요?</summary><p>v0.5.3은 v0.4.5와 같은 서명키로 만들었습니다. 기존 앱을 삭제하지 않고 설치한 뒤 등록 기기와 설정이 유지되는지 확인해 주세요. 실제 갤럭시에서 업데이트 설치와 새 기능 검증은 아직 진행되지 않았습니다.</p></details>
            <h3>2. 앱에 등록 코드 입력</h3>
            <div className="pair-code-panel">
              {pairingBusy ? <span className="pair-code-loading"><span className="spinner blue" /> 코드 만드는 중</span> : pairing ? <><strong>{pairing.code.slice(0, 3)} {pairing.code.slice(3)}</strong><small>10분 동안 한 번만 사용할 수 있어요.</small></> : <span>코드를 만들지 못했습니다.</span>}
            </div>
            {pairingError && <p className="modal-error" role="alert">{pairingError}</p>}
            <h3>3. 연결 준비</h3><p>앱에서 조작 권한과 연결 요청 알림을 켜세요. 원격 키보드는 선택 사항입니다.</p>
            <div className="pair-actions">
              <button type="button" onClick={createPairingCode} disabled={pairingBusy}>새 코드</button>
              <button className="primary-action" type="button" onClick={verifyPairing}>등록됐는지 확인</button>
            </div>
          </section>
        </div>
      )}

      {dialog === "disconnect" && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDialog(null)}>
          <section ref={modalRef} tabIndex={-1} className="modal compact" role="alertdialog" aria-modal="true" aria-labelledby="disconnect-title" onMouseDown={(event) => event.stopPropagation()}>
            <h2 id="disconnect-title">원격 연결을 해제할까요?</h2><p>휴대폰 화면 전송과 모든 원격 조작이 즉시 중지됩니다.</p>
            <div className="modal-actions"><button type="button" onClick={() => setDialog(null)}>취소</button><button className="danger" type="button" onClick={() => { void closeConnection(); setDialog(null); setToast("연결을 안전하게 해제했습니다."); }}>연결 해제</button></div>
          </section>
        </div>
      )}
      {dialog === "settings" && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDialog(null)}>
          <section ref={modalRef} tabIndex={-1} className="modal compact" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" aria-label="닫기" onClick={() => setDialog(null)}>×</button>
            <p className="eyebrow">DEVICE SECURITY</p><h2 id="settings-title">설정</h2><h3>PC 사용 환경</h3>
            <p>이 PC의 사용 환경을 선택하세요. 공용 PC 모드는 화면 설정을 저장하지 않습니다. 자리를 떠나기 전 ‘사용 종료’를 눌러 로그아웃해 주세요.</p>
            <div className="pc-mode-picker" role="group" aria-label="PC 사용 모드">
              <button type="button" aria-pressed={pcMode === "personal"} className={pcMode === "personal" ? "active" : ""} onClick={() => changePcMode("personal")}><strong>개인 PC</strong><small>화면 설정 기억</small></button>
              <button type="button" aria-pressed={pcMode === "public"} className={pcMode === "public" ? "active" : ""} onClick={() => changePcMode("public")}><strong>공용 PC</strong><small>설정 저장 안 함</small></button>
            </div>
            {pcMode === "public" && <button className="public-session-end" type="button" onClick={() => void endPublicSession()}>공용 PC 사용 종료</button>}
            <h3>등록 기기</h3><p>등록 해제한 휴대폰은 새 코드로 다시 등록해야 연결할 수 있습니다.</p>
            <div className="registered-device-list">
              {devices.length ? devices.map((device) => (
                <div className="registered-device" key={device.id}>
                  <span className={`status-dot ${device.online ? "online" : ""}`} />
                  <div><strong>{device.name}</strong><small>{device.online ? "온라인" : "오프라인"} · {device.appVersion}</small></div>
                  <button type="button" onClick={() => void removeDevice(device)} disabled={removingDeviceId === device.id}>{removingDeviceId === device.id ? "해제 중" : "등록 해제"}</button>
                </div>
              )) : <div className="empty-device-list">등록된 기기가 없습니다.</div>}
            </div>
            <a className="android-project-link" href="/downloads/GalaxyRemote-0.5.3-release.apk" download>
              <span aria-hidden="true">↓</span>
              <strong>Galaxy Remote v0.5.3 받기</strong>
              <small>기존 서명키 사용 · 실제 휴대폰 설치 검증 전</small>
            </a>
            <a className="android-project-link" href="/downloads/GalaxyRemote-0.4.5-rotation-fixed-release.apk" download>
              <span aria-hidden="true">↓</span>
              <strong>Galaxy Remote v0.4.5 받기</strong>
              <small>v0.4.0·v0.4.1 위에 바로 설치할 수 있습니다.</small>
            </a>
          </section>
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
