"use client";
import { useEffect, useState } from "react";
import { downloadBlob, timestamp } from "../../lib/remote/media";
import { Diagnostics } from "../../lib/remote/diagnostics";
import { RemoteClient, type ToolsState } from "../../lib/remote/client";
export default function RemoteTools({ client, diagnostics }: { client: RemoteClient | null; diagnostics: Diagnostics }) {
  const [state, setState] = useState<ToolsState | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  useEffect(() => { if (client) return client.subscribe(setState); }, [client]);
  useEffect(() => { if (!state?.recording) return; const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - state.recordingAt) / 1000)), 1000); return () => window.clearInterval(timer); }, [state?.recording, state?.recordingAt]);
  async function run(action: () => unknown) { try { setError(""); await action(); } catch (e) { setError(e instanceof Error ? e.message : "작업 실패"); } }
  const supported = (feature: string) => !!state?.features.includes(feature);
  return <section className="control-card remote-tools"><h3>전송·저장 도구</h3>
    {client && !state?.features.length && <p className="tools-note">현재 앱은 새 전송 기능을 지원하지 않습니다. 캡처·녹화는 바로 사용할 수 있어요.</p>}
    <p role="status">{state?.result ?? "연결하면 사용할 수 있어요."}</p>
    <div className="tools-buttons"><button disabled={!client} onClick={() => void run(() => client!.capture())}>PNG 캡처</button><button disabled={!client} onClick={() => void run(() => state?.recording ? client!.stopRecording() : client!.startRecording())}>{state?.recording ? `녹화 중지 (${seconds}초)` : "화면 녹화"}</button></div>
    <p className="tools-note">지원 브라우저는 선택한 PC 파일에 계속 저장합니다. 그 외 브라우저는 128MiB마다 중지·저장합니다.</p>
    <details><summary>휴대폰 소리</summary><button disabled={!supported("pcmAudio") || state?.recording} onClick={() => void run(() => client!.toggleAudio())}>{state?.audio ? "소리 끄기" : "소리 켜기"}</button><label>PC 재생 볼륨<input type="range" min="0" max="100" defaultValue="100" disabled={!state?.audio} onChange={e => client?.audioVolume(Number(e.target.value))} /></label><p>{state?.audioStatus ?? "신규 Android 앱 필요"}</p></details>
    <details><summary>양방향 클립보드</summary><textarea aria-label="휴대폰으로 보낼 텍스트" value={text} onChange={e => setText(e.target.value)} maxLength={65536} placeholder="전송할 텍스트" /><div className="tools-buttons"><button disabled={!supported("clipboard")} onClick={() => void run(() => client!.sendClipboard(text))}>텍스트 보내기</button><button disabled={!supported("clipboard")} onClick={() => void run(() => client!.sendClipboard())}>PC 클립보드 보내기</button><button disabled={!supported("clipboard")} onClick={() => client?.send({ type: "clipboardPaste" })}>휴대폰 입력칸에 붙여넣기</button></div><p>휴대폰에서 앱 또는 원격 키보드의 ‘클립보드 보내기’를 눌러 전송하세요.</p>{state?.clipboard && <><pre>{state.clipboard}</pre><button onClick={() => void run(() => client!.copyClipboard())}>확인한 내용을 PC에 복사</button></>}</details>
    <details><summary>파일 전송 (최대 100MiB)</summary><label className="file-drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (supported("files")) { const files = Array.from(e.dataTransfer.files); void run(async () => { client!.files.enqueue(files); }); } }}>파일 선택 또는 여기로 끌어놓기<input type="file" multiple disabled={!supported("files")} onChange={e => { const files = Array.from(e.target.files ?? []); if (files.length) void run(() => client!.files.enqueue(files)); e.target.value = ""; }} /></label><p>대상: 현재 연결된 휴대폰. 휴대폰에서 수신 승인과 저장 위치 선택이 필요해요.</p>{state?.offer && <div role="status"><p>{state.offer.name} · {(state.offer.size / 1048576).toFixed(2)}MiB</p><button onClick={() => client?.files.accept()}>PC 수신 승인·저장</button><button onClick={() => client?.files.cancel()}>거절</button></div>}<p role="status">{state?.fileStatus}</p><button disabled={!supported("files")} onClick={() => client?.files.cancel()}>전송 취소</button><p className="tools-note">중단된 부분 파일은 삭제됩니다. 이어받기는 아직 지원하지 않습니다. 여러 파일은 최대 20개까지 차례대로 전송합니다.</p></details>
    <details><summary>대기 모드·진단</summary><select aria-label="휴대폰 대기 모드" disabled={!supported("standby")} defaultValue="balanced" onChange={e => client?.send({ type: "standby", mode: e.target.value })}><option value="fast">빠른 연결</option><option value="balanced">균형</option><option value="saving">절약</option></select><button onClick={() => downloadBlob(new Blob([diagnostics.export()], { type: "application/json" }), `GalaxyRemote-diagnostics-${timestamp()}.json`)}>PC 진단 JSON 저장</button><button disabled={!supported("diagnostics")} onClick={() => client?.send({ type: "diagnostics" })}>휴대폰 상태 요청</button><p className="tools-note">키 입력·클립보드·파일 내용·인증 정보는 진단에 기록하지 않습니다.</p></details>
    {error && <p role="alert">{error}</p>}
  </section>;
}
