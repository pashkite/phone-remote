"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type ConnectionState = "offline" | "waiting" | "reconnecting" | "connected";
type PcMode = "personal" | "public";
type DialogState = "pair" | "disconnect" | "settings" | null;
type QualityPreset = "auto" | "data" | "smooth" | "clear";

type RemoteConsoleProps = {
  displayName: string;
  email: string | null;
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

type ConnectionMetrics = {
  latency: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrateKbps: number | null;
  packetLoss: number | null;
  path: "direct" | "turn" | null;
};

const MINIMUM_NOTIFICATION_APP_VERSION = [0, 2, 0] as const;
const HIGH_PERFORMANCE_QUALITY_APP_VERSION = [0, 3, 0] as const;

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

export default function RemoteConsole({ displayName, email }: RemoteConsoleProps) {
  const [connection, setConnection] = useState<ConnectionState>("offline");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [devices, setDevices] = useState<RegisteredDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [pairing, setPairing] = useState<PairingInfo | null>(null);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [volume, setVolume] = useState(62);
  const [qualityPreset, setQualityPreset] = useState<QualityPreset>("auto");
  const [pcMode, setPcMode] = useState<PcMode>("public");
  const [detachedOpacity, setDetachedOpacity] = useState(100);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [detachedWindow, setDetachedWindow] = useState<Window | null>(null);
  const [metrics, setMetrics] = useState<ConnectionMetrics>({
    latency: null,
    width: null,
    height: null,
    fps: null,
    bitrateKbps: null,
    packetLoss: null,
    path: null,
  });
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
  const viewerRef = useRef<HTMLElement>(null);
  const phoneViewRef = useRef<HTMLDivElement>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const answerPollRef = useRef<number | null>(null);
  const statsTimerRef = useRef<number | null>(null);
  const textFlushTimerRef = useRef<number | null>(null);
  const textBufferRef = useRef("");
  const remoteCandidateIdsRef = useRef(new Set<string>());
  const previousStatsRef = useRef<{ bytes: number; at: number } | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number; at: number } | null>(null);
  const composingRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const intentionalCloseRef = useRef(false);

  useEffect(() => {
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
  const highPerformanceQuality = selectedDevice
    ? versionAtLeast(selectedDevice.appVersion, HIGH_PERFORMANCE_QUALITY_APP_VERSION)
    : false;
  const qualityOptions: Array<{ value: QualityPreset; label: string }> = highPerformanceQuality
    ? [
        { value: "auto", label: "자동 · 1080p · 30fps" },
        { value: "smooth", label: "부드러움 · 1080p · 60fps" },
        { value: "clear", label: "선명 · 1440p · 30fps" },
        { value: "data", label: "절약 · 540p · 24fps" },
      ]
    : [
        { value: "auto", label: "자동 · 720p · 20fps" },
        { value: "clear", label: "선명 · 900p · 24fps" },
        { value: "data", label: "절약 · 480p · 15fps" },
      ];
  const displayedQualityPreset = !highPerformanceQuality && qualityPreset === "smooth"
    ? "auto"
    : qualityPreset;
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
    intentionalCloseRef.current = intentional;
    if (intentional && reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      reconnectAttemptsRef.current = 0;
    }
    stopTimers();
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    if (channelRef.current) {
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
    if (videoRef.current) videoRef.current.srcObject = null;
    if (detachedVideoRef.current) detachedVideoRef.current.srcObject = null;
    remoteStreamRef.current = null;
    setConnection("offline");
    setConnectionHint(null);
    remoteCandidateIdsRef.current.clear();
    previousStatsRef.current = null;
    setMetrics({
      latency: null,
      width: null,
      height: null,
      fps: null,
      bitrateKbps: null,
      packetLoss: null,
      path: null,
    });
    if (notifyServer && sessionId) {
      void fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
    }
  }, [stopTimers]);

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
        const targetWidth = widthIsDriver
          ? currentWidth
          : Math.round(currentHeight * ratio);
        const targetHeight = widthIsDriver
          ? Math.round(currentWidth / ratio)
          : currentHeight;
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
    channel.send(JSON.stringify(payload));
    return true;
  }

  function startStats(peer: RTCPeerConnection) {
    if (statsTimerRef.current) window.clearInterval(statsTimerRef.current);
    statsTimerRef.current = window.setInterval(async () => {
      try {
        const report = await peer.getStats();
        let latency: number | null = null;
        let width: number | null = null;
        let height: number | null = null;
        let fps: number | null = null;
        let bytes: number | null = null;
        let packetsLost: number | null = null;
        let packetsReceived: number | null = null;
        let selectedPair: RTCStats | null = null;
        report.forEach((stat) => {
          if (
            stat.type === "candidate-pair" &&
            stat.state === "succeeded" &&
            (stat.selected === true || stat.nominated === true)
          ) {
            selectedPair = stat;
          }
          if (stat.type === "transport" && typeof stat.selectedCandidatePairId === "string") {
            selectedPair = report.get(stat.selectedCandidatePairId) ?? selectedPair;
          }
          if (stat.type === "candidate-pair" && stat.state === "succeeded" && typeof stat.currentRoundTripTime === "number") {
            latency = Math.round(stat.currentRoundTripTime * 1_000);
          }
          if (stat.type === "inbound-rtp" && stat.kind === "video" && typeof stat.frameHeight === "number") {
            width = typeof stat.frameWidth === "number" ? stat.frameWidth : null;
            height = stat.frameHeight;
            fps = typeof stat.framesPerSecond === "number" ? Math.round(stat.framesPerSecond) : null;
            bytes = typeof stat.bytesReceived === "number" ? stat.bytesReceived : null;
            packetsLost = typeof stat.packetsLost === "number" ? stat.packetsLost : null;
            packetsReceived = typeof stat.packetsReceived === "number" ? stat.packetsReceived : null;
          }
        });
        let path: ConnectionMetrics["path"] = null;
        if (selectedPair) {
          const pair = selectedPair as RTCStats & { localCandidateId?: string; remoteCandidateId?: string };
          const local = pair.localCandidateId ? report.get(pair.localCandidateId) : null;
          const remote = pair.remoteCandidateId ? report.get(pair.remoteCandidateId) : null;
          path = local?.candidateType === "relay" || remote?.candidateType === "relay" ? "turn" : "direct";
          if (latency === null && typeof pair.currentRoundTripTime === "number") {
            latency = Math.round(pair.currentRoundTripTime * 1_000);
          }
        }
        const now = performance.now();
        const previous = previousStatsRef.current;
        const bitrateKbps = bytes !== null && previous && now > previous.at
          ? Math.max(0, Math.round(((bytes - previous.bytes) * 8) / (now - previous.at)))
          : null;
        if (bytes !== null) previousStatsRef.current = { bytes, at: now };
        const packetTotal = (packetsReceived ?? 0) + Math.max(0, packetsLost ?? 0);
        const packetLoss = packetTotal > 0 && packetsLost !== null
          ? Math.round((Math.max(0, packetsLost) / packetTotal) * 1_000) / 10
          : null;
        setMetrics({ latency, width, height, fps, bitrateKbps, packetLoss, path });
      } catch {
        // A transient stats failure should not interrupt the remote session.
      }
    }, 1_000);
  }

  async function beginConnection() {
    if (!selectedDevice) {
      openPairing();
      return;
    }
    if (!supportsNotificationApproval(selectedDevice.appVersion)) {
      setConnectionError("휴대폰 앱을 v0.3.1로 업데이트한 뒤 다시 눌러 주세요. 기기 등록은 유지됩니다.");
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
      sessionIdRef.current = sessionId;

      const peer = new RTCPeerConnection({
        iceServers,
        bundlePolicy: "max-bundle",
        iceCandidatePoolSize: 2,
      });
      peerRef.current = peer;
      const videoTransceiver = peer.addTransceiver("video", { direction: "recvonly" });
      const videoCapabilities = RTCRtpReceiver.getCapabilities?.("video");
      const vp8Codecs = videoCapabilities?.codecs.filter(
        (codec) => codec.mimeType.toLowerCase() === "video/vp8",
      );
      if (vp8Codecs?.length && "setCodecPreferences" in videoTransceiver) {
        videoTransceiver.setCodecPreferences(vp8Codecs);
      }
      peer.ontrack = (event) => {
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
      channel.onopen = () => {
        setConnection("connected");
        setConnectionError(null);
        setConnectionHint(null);
        reconnectAttemptsRef.current = 0;
        setToast("휴대폰과 안전하게 연결됐어요.");
        sendPayload({ type: "quality", preset: displayedQualityPreset });
        startStats(peer);
      };
      channel.onclose = () => {
        if (peer.connectionState !== "closed" && !intentionalCloseRef.current) {
          queueReconnect("원격 조작 채널이 닫혔습니다.");
        }
      };
      channel.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as { type?: string; message?: string };
          if (message.type === "notice" && message.message) setToast(message.message);
        } catch {
          // Ignore malformed device notices.
        }
      };

      const offer = await peer.createOffer({ offerToReceiveAudio: false });
      await peer.setLocalDescription(offer);
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
        if (polling) return;
        polling = true;
        attempts += 1;
        try {
          const response = await fetch(`/api/sessions/${sessionId}`, { cache: "no-store" });
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
            await peer.setRemoteDescription({ type: "answer", sdp: payload.session.answerSdp });
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
          if (answerPollRef.current) window.clearInterval(answerPollRef.current);
          answerPollRef.current = null;
          setConnectionError(error instanceof Error ? error.message : "연결하지 못했습니다.");
          void closeConnection();
        } finally {
          polling = false;
        }
      };
      answerPollRef.current = window.setInterval(() => void pollAnswer(), 500);
      void pollAnswer();
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "연결을 시작하지 못했습니다.");
      await closeConnection();
    }
  }

  function queueReconnect(reason: string) {
    if (intentionalCloseRef.current || reconnectTimerRef.current) return;
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
    if (!sendPayload({ type: "global", action: command })) return;
    setToast(`${label} 명령을 전송했습니다.`);
  }

  function changeVolume(next: number) {
    const normalized = Math.max(0, Math.min(100, next));
    setVolume(normalized);
    if (connected) sendPayload({ type: "volume", value: normalized });
  }

  function changeQuality(next: QualityPreset) {
    setQualityPreset(next);
    if (connected) {
      if (sendPayload({ type: "quality", preset: next })) {
        setToast("휴대폰에서 화질을 적용하는 중이에요.");
      }
    }
  }

  function changePcMode(next: PcMode) {
    setPcMode(next);
    if (next === "public") setDetachedOpacity(100);
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
    setToast("이 브라우저의 원격 세션과 화면 설정을 지웠습니다. 공용 PC라면 사이트에서도 로그아웃해 주세요.");
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
        .detached-toolbar { position: fixed; z-index: 10; top: 10px; right: 10px; width: min(310px, calc(100vw - 20px)); padding: 10px; border: 1px solid rgba(255,255,255,.2); border-radius: 12px; color: #eef5ff; background: rgba(12,20,33,.88); box-shadow: 0 8px 28px rgba(0,0,0,.3); font: 700 12px Pretendard, "Noto Sans KR", sans-serif; backdrop-filter: blur(12px); cursor: default; }
        .detached-toolbar-row { display: grid; grid-template-columns: auto 1fr auto auto; align-items: center; gap: 8px; }
        .detached-toolbar input { min-width: 80px; accent-color: #5b9cff; }
        .detached-toolbar button { min-width: 42px; height: 28px; border: 1px solid rgba(255,255,255,.22); border-radius: 7px; color: inherit; background: rgba(255,255,255,.1); cursor: pointer; font: inherit; }
        .detached-presets { display: flex; gap: 5px; margin-top: 8px; justify-content: flex-end; }
        .detached-keyboard-capture { position: absolute; width: 1px; height: 1px; opacity: .01; pointer-events: none; }
      `;
      nextWindow.document.head.appendChild(style);
      setDetachedWindow(nextWindow);
      nextWindow.focus();
    } catch {
      setToast("화면 창을 열지 못했습니다. 브라우저의 팝업 권한을 확인해 주세요.");
    }
  }

  function normalizedPointer(event: React.PointerEvent<HTMLDivElement>, targetVideo?: HTMLVideoElement | null) {
    const video = targetVideo ?? videoRef.current;
    const bounds = video?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
    const videoAspect = video?.videoWidth && video.videoHeight
      ? video.videoWidth / video.videoHeight
      : bounds.width / bounds.height;
    const frameAspect = bounds.width / bounds.height;
    const renderedWidth = videoAspect > frameAspect ? bounds.width : bounds.height * videoAspect;
    const renderedHeight = videoAspect > frameAspect ? bounds.width / videoAspect : bounds.height;
    const offsetX = bounds.left + (bounds.width - renderedWidth) / 2;
    const offsetY = bounds.top + (bounds.height - renderedHeight) / 2;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - offsetX) / renderedWidth)),
      y: Math.min(1, Math.max(0, (event.clientY - offsetY) / renderedHeight)),
      inside: event.clientX >= offsetX && event.clientX <= offsetX + renderedWidth
        && event.clientY >= offsetY && event.clientY <= offsetY + renderedHeight,
    };
  }

  function sendPointerGesture(start: { x: number; y: number; at: number }, end: { x: number; y: number }, endedAt: number) {
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const durationMs = Math.min(1_200, Math.max(60, endedAt - start.at));
    if (distance < 0.018) {
      sendPayload(durationMs >= 520
        ? { type: "longPress", x: end.x, y: end.y, durationMs }
        : { type: "tap", x: end.x, y: end.y });
    } else {
      sendPayload({ type: "swipe", fromX: start.x, fromY: start.y, toX: end.x, toY: end.y, durationMs: Math.max(120, durationMs) });
    }
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!connected) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = normalizedPointer(event);
    if (!point.inside) return;
    pointerStartRef.current = { ...point, at: event.timeStamp };
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!connected || !pointerStartRef.current) return;
    const start = pointerStartRef.current;
    const end = normalizedPointer(event);
    pointerStartRef.current = null;
    if (!end.inside) return;
    sendPointerGesture(start, end, event.timeStamp);
    keyboardRef.current?.focus({ preventScroll: true });
  }

  function onPointerCancel(event: React.PointerEvent<HTMLDivElement>) {
    pointerStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
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

  function onRemoteWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!connected) return;
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
    if (!connected || !direction) return false;
    event.preventDefault();
    sendViewportSwipe(direction);
    return true;
  }

  function onPhoneKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!connected) return;
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
    if (!connected) return;
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
          <div><h1>Galaxy Remote</h1><p>내 갤럭시를 어디서든 안전하게</p></div>
          <span className={`connection-pill ${connection}`}><span className="status-dot" />{connected ? "연결됨" : connection === "reconnecting" ? "재연결 중" : waiting ? "승인 대기" : "연결 준비"}</span>
        </div>
        <div className="owner-area">
          <div className="avatar" aria-hidden="true">{initials}</div>
          <div className="owner-copy"><strong>{displayName}</strong><span>{email ? "Owner" : "소유자 전용"}</span></div>
          <button className="icon-button" type="button" aria-label="설정" onClick={() => setDialog("settings")}>⚙</button>
        </div>
      </header>

      <section className="console-grid" aria-label="원격 조작 화면">
        <article className="screen-card" ref={viewerRef}>
          <div className="card-heading">
            <div><p className="eyebrow">LIVE SCREEN</p><h2>휴대폰 화면</h2></div>
            <div className="screen-heading-actions">
              <select
                className="device-select"
                aria-label="원격 기기 선택"
                value={selectedDevice?.id ?? ""}
                onChange={(event) => setSelectedDeviceId(event.target.value || null)}
              >
                {devices.length ? devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>) : <option value="">Galaxy S26 Ultra</option>}
              </select>
              <select
                className="quality-select"
                aria-label="화면 화질"
                value={displayedQualityPreset}
                onChange={(event) => changeQuality(event.target.value as QualityPreset)}
              >
                {qualityOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <button className="viewer-button" type="button" aria-pressed={Boolean(detachedWindow)} onClick={() => void toggleDetachedScreen()}>
                {detachedWindow ? "화면 창 닫기" : "화면 분리"}
              </button>
              <button className="viewer-button" type="button" onClick={() => void toggleFullscreen()}>전체화면</button>
              <span className={`live-badge ${connected ? "active" : ""}`}><span /> {connected ? "LIVE" : "OFFLINE"}</span>
            </div>
          </div>
          <div className="screen-stage">
            <div
              className={`phone-view ${connected ? "is-live" : ""}`}
              ref={phoneViewRef}
              tabIndex={connected ? 0 : -1}
              role="application"
              aria-label="연결된 휴대폰 원격 화면"
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              onWheel={onRemoteWheel}
              onKeyDown={onPhoneKeyDown}
            >
              <video ref={videoRef} autoPlay playsInline aria-label="연결된 휴대폰 화면" />
              <input
                ref={keyboardRef}
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
                  <p>{waiting ? "휴대폰에 도착한 알림에서 승인해 주세요." : selectedDevice ? "휴대폰의 연결 요청 알림을 켜두면 여기서 바로 요청할 수 있어요." : "전용 앱으로 기기를 등록하면 이곳에서 바로 보고 조작할 수 있어요."}</p>
                  <button type="button" onClick={selectedDevice ? beginConnection : openPairing}>{selectedDevice ? "연결 시작" : "기기 등록하기"}</button>
                </div>
              )}
            </div>
          </div>
          <div className="screen-help"><span aria-hidden="true">ⓘ</span>클릭·드래그·마우스 휠·방향키를 휴대폰 터치로 전달합니다.</div>
        </article>

        {detachedWindow && createPortal(
          <main className="detached-screen-shell">
            <div
              className={`detached-phone-view ${connected ? "is-live" : ""}`}
              tabIndex={connected ? 0 : -1}
              role="application"
              aria-label="분리된 휴대폰 원격 화면"
              onPointerDown={(event) => {
                if (!connected) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                const point = normalizedPointer(event, detachedVideoRef.current);
                if (!point.inside) return;
                pointerStartRef.current = { ...point, at: event.timeStamp };
              }}
              onPointerUp={(event) => {
                if (!connected || !pointerStartRef.current) return;
                const start = pointerStartRef.current;
                const end = normalizedPointer(event, detachedVideoRef.current);
                pointerStartRef.current = null;
                if (!end.inside) return;
                sendPointerGesture(start, end, event.timeStamp);
                detachedKeyboardRef.current?.focus({ preventScroll: true });
              }}
              onPointerCancel={onPointerCancel}
              onWheel={onRemoteWheel}
              onKeyDown={(event) => { handleDirectionKey(event); }}
            >
              <video
                ref={attachDetachedVideo}
                autoPlay
                muted
                playsInline
                style={{ opacity: detachedOpacity / 100 }}
                aria-label="분리된 휴대폰 화면"
                onCanPlay={(event) => { void event.currentTarget.play(); }}
                onLoadedMetadata={(event) => {
                  const { videoWidth, videoHeight } = event.currentTarget;
                  if (!videoWidth || !videoHeight) return;
                  detachedRatioRef.current = videoWidth / videoHeight;
                  detachedWindow.dispatchEvent(new Event("galaxy-phone-ratio-change"));
                }}
                onResize={(event) => {
                  const { videoWidth, videoHeight } = event.currentTarget;
                  if (!videoWidth || !videoHeight) return;
                  const nextRatio = videoWidth / videoHeight;
                  if (Math.abs(nextRatio - detachedRatioRef.current) < 0.001) return;
                  detachedRatioRef.current = nextRatio;
                  detachedWindow.dispatchEvent(new Event("galaxy-phone-ratio-change"));
                }}
              />
              <input
                ref={detachedKeyboardRef}
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
              <section className="detached-toolbar" aria-label="분리 창 화면 설정" onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}>
                <div className="detached-toolbar-row">
                  <label htmlFor="detached-opacity">투명도</label>
                  <input id="detached-opacity" type="range" min="20" max="100" step="1" value={detachedOpacity} onChange={(event) => setDetachedOpacity(Number(event.target.value))} />
                  <output>{detachedOpacity}%</output>
                  <button type="button" onClick={() => setDetachedOpacity(100)}>100%</button>
                </div>
                <div className="detached-presets" aria-label="투명도 빠른 선택">
                  {[25, 50, 75, 100].map((value) => <button key={value} type="button" onClick={() => setDetachedOpacity(value)}>{value}%</button>)}
                </div>
              </section>
              {!connected && <div className="detached-message">휴대폰 연결을 기다리는 중이에요.</div>}
            </div>
          </main>,
          detachedWindow.document.body,
        )}

        <aside className="control-rail" aria-label="원격 제어 도구">
          <section className="control-card connect-card">
            <p className="eyebrow">REMOTE CONTROL</p><h2>원격 제어</h2>
            <p>{connectionError ?? connectionHint ?? (waiting ? "휴대폰의 승인을 기다리고 있어요." : connected ? "암호화된 연결을 사용하고 있어요." : selectedDevice ? "웹에서 요청하면 휴대폰 승인 알림이 도착합니다." : "먼저 휴대폰을 등록해 주세요.")}</p>
            <button className="primary-action" type="button" onClick={selectedDevice ? beginConnection : openPairing} disabled={waiting || connection === "reconnecting"}>
              {waiting || connection === "reconnecting" ? <><span className="spinner" /> {connection === "reconnecting" ? "재연결 중" : "연결하는 중"}</> : connected ? "연결 새로고침" : selectedDevice ? (connectionError ? "재연결" : "연결 시작") : "기기 등록"}
            </button>
            <div className="device-row">
              <span className={`status-dot ${selectedDevice?.online ? "online" : ""}`} /><strong>{selectedDevice?.name ?? "Galaxy S26 Ultra"}</strong>
              <span>{selectedDevice ? `${selectedDevice.online ? "온라인" : "오프라인"}${selectedDevice.batteryLevel !== null ? ` · ${selectedDevice.batteryLevel}%` : ""}` : "미등록"}</span>
            </div>
          </section>

          <section className="control-card metrics-card" aria-label="연결 정보">
            <div className="metric"><span className="metric-icon">↔</span><small>경로</small><strong>{connected ? metrics.path === "turn" ? "TURN" : metrics.path === "direct" ? "직접" : "확인 중" : "—"}</strong></div>
            <div className="metric"><span className="metric-icon">▮▮▮</span><small>지연</small><strong>{connected && metrics.latency !== null ? `${metrics.latency} ms` : "—"}</strong></div>
            <div className="metric"><span className="metric-icon">HD</span><small>해상도</small><strong>{connected && metrics.width && metrics.height ? `${metrics.width}×${metrics.height}` : "—"}</strong></div>
            <div className="metric"><span className="metric-icon">▶</span><small>프레임</small><strong>{connected && metrics.fps !== null ? `${metrics.fps} fps` : "—"}</strong></div>
            <div className="metric"><span className="metric-icon">⇣</span><small>비트레이트</small><strong>{connected && metrics.bitrateKbps !== null ? `${metrics.bitrateKbps} kbps` : "—"}</strong></div>
            <div className="metric"><span className="metric-icon">%</span><small>손실</small><strong>{connected && metrics.packetLoss !== null ? `${metrics.packetLoss}%` : "—"}</strong></div>
          </section>

          <section className="control-card quick-card">
            <div className="section-title-row"><h3>빠른 제어</h3><span>{connected ? "사용 가능" : "연결 후 사용"}</span></div>
            <div className="quick-grid">
              {controls.map((control) => <button key={control.command} type="button" disabled={!connected} onClick={() => sendCommand(control.command, control.label)}><span aria-hidden="true">{control.icon}</span>{control.label}</button>)}
            </div>
          </section>

          <section className="control-card volume-card">
            <div className="volume-label"><strong>볼륨</strong><span aria-hidden="true">◖))</span></div>
            <button type="button" disabled={!connected} aria-label="볼륨 낮추기" onClick={() => changeVolume(volume - 5)}>−</button>
            <input type="range" min="0" max="100" value={volume} disabled={!connected} aria-label="휴대폰 볼륨" onChange={(event) => changeVolume(Number(event.target.value))} style={{ "--volume": `${volume}%` } as React.CSSProperties} />
            <output>{volume}%</output><button type="button" disabled={!connected} aria-label="볼륨 높이기" onClick={() => changeVolume(volume + 5)}>+</button>
          </section>

          <button className="disconnect-button" type="button" disabled={!connected && !waiting} onClick={() => setDialog("disconnect")}>연결 해제</button>
          <section className="privacy-note"><span className="shield" aria-hidden="true">◇</span><div><strong>승인한 세션에서만 화면을 전송해요</strong><p>웹 요청마다 휴대폰에서 승인하며 영상과 키 입력 내용은 서버에 저장하지 않습니다.</p></div></section>
        </aside>
      </section>

      {dialog === "pair" && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDialog(null)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="pair-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" aria-label="닫기" onClick={() => setDialog(null)}>×</button>
            <p className="eyebrow">DEVICE PAIRING</p><h2 id="pair-title">갤럭시를 등록해 주세요</h2>
            <p>Galaxy Remote 앱을 연 다음 아래 6자리 코드를 입력하면 이 계정에 안전하게 등록됩니다.</p>
            <div className="pair-code-panel">
              {pairingBusy ? <span className="pair-code-loading"><span className="spinner blue" /> 코드 만드는 중</span> : pairing ? <><strong>{pairing.code.slice(0, 3)} {pairing.code.slice(3)}</strong><small>10분 동안 한 번만 사용할 수 있어요.</small></> : <span>코드를 만들지 못했습니다.</span>}
            </div>
            {pairingError && <p className="modal-error" role="alert">{pairingError}</p>}
            <a className="android-project-link" href="/downloads/GalaxyRemote-0.3.1-release.apk" download>
              <span aria-hidden="true">↓</span>
              <strong>Galaxy Remote APK 받기</strong>
              <small>Galaxy arm64 v0.3.1 · 15MB · 1080p 60fps · 자동 연결 지원</small>
            </a>
            <p className="install-warning">v0.3.0과 같은 서명키로 만든 업데이트입니다. 기존 앱을 삭제하지 말고 그대로 설치하세요. 페어링과 설정이 유지됩니다.</p>
            <div className="modal-note"><span>1</span> 설치·업데이트 <b>→</b><span>2</span> 권한 설정 <b>→</b><span>3</span> 웹에서 연결</div>
            <div className="pair-actions">
              <button type="button" onClick={createPairingCode} disabled={pairingBusy}>새 코드</button>
              <button className="primary-action" type="button" onClick={verifyPairing}>등록됐는지 확인</button>
            </div>
          </section>
        </div>
      )}

      {dialog === "disconnect" && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDialog(null)}>
          <section className="modal compact" role="alertdialog" aria-modal="true" aria-labelledby="disconnect-title" onMouseDown={(event) => event.stopPropagation()}>
            <h2 id="disconnect-title">원격 연결을 해제할까요?</h2><p>휴대폰 화면 전송과 모든 원격 조작이 즉시 중지됩니다.</p>
            <div className="modal-actions"><button type="button" onClick={() => setDialog(null)}>취소</button><button className="danger" type="button" onClick={() => { void closeConnection(); setDialog(null); setToast("연결을 안전하게 해제했습니다."); }}>연결 해제</button></div>
          </section>
        </div>
      )}
      {dialog === "settings" && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDialog(null)}>
          <section className="modal compact" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" aria-label="닫기" onClick={() => setDialog(null)}>×</button>
            <p className="eyebrow">DEVICE SECURITY</p><h2 id="settings-title">등록 기기 관리</h2>
            <p>이 PC의 사용 환경을 선택하세요. 공용 PC 모드는 투명도 등 화면 설정을 저장하지 않습니다.</p>
            <div className="pc-mode-picker" role="group" aria-label="PC 사용 모드">
              <button type="button" className={pcMode === "personal" ? "active" : ""} onClick={() => changePcMode("personal")}><strong>개인 PC</strong><small>화면 설정 기억</small></button>
              <button type="button" className={pcMode === "public" ? "active" : ""} onClick={() => changePcMode("public")}><strong>공용 PC</strong><small>설정 저장 안 함</small></button>
            </div>
            {pcMode === "public" && <button className="public-session-end" type="button" onClick={() => void endPublicSession()}>공용 PC 사용 종료</button>}
            <p>사용하지 않는 휴대폰을 등록 해제하면 해당 기기 토큰으로 더 이상 접속할 수 없습니다.</p>
            <div className="registered-device-list">
              {devices.length ? devices.map((device) => (
                <div className="registered-device" key={device.id}>
                  <span className={`status-dot ${device.online ? "online" : ""}`} />
                  <div><strong>{device.name}</strong><small>{device.online ? "온라인" : "오프라인"} · {device.appVersion}</small></div>
                  <button type="button" onClick={() => void removeDevice(device)} disabled={removingDeviceId === device.id}>{removingDeviceId === device.id ? "해제 중" : "등록 해제"}</button>
                </div>
              )) : <div className="empty-device-list">등록된 기기가 없습니다.</div>}
            </div>
            <a className="android-project-link" href="/downloads/GalaxyRemote-0.3.1-release.apk" download>
              <span aria-hidden="true">↓</span>
              <strong>Galaxy Remote v0.3.1 받기</strong>
              <small>기존 v0.3.0 위에 바로 설치하세요. 페어링과 설정이 유지됩니다.</small>
            </a>
          </section>
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
