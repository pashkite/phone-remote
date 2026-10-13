import { CHUNK_SIZE, MAX_FILE_SIZE, UUID, decodeChunk, encodeChunk, safeFilename, sha256 } from "./protocol";
import { downloadBlob } from "./media";
export type FileOffer = { id: string; name: string; size: number; hash: string };
export class FileTransfer {
  offer: FileOffer | null = null;
  private incoming: (FileOffer & { parts: ArrayBuffer[]; received: number }) | null = null;
  private outgoing: (FileOffer & { file: File; cancelled: boolean }) | null = null;
  private chain = Promise.resolve();
  private closed = false;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  constructor(private channel: RTCDataChannel, private changed: (status: string) => void, private offered: (offer: FileOffer | null) => void) {
    channel.binaryType = "arraybuffer";
    channel.onmessage = event => { this.chain = this.chain.then(() => this.receive(event.data)).catch(() => this.cancel("잘못된 전송 데이터를 중단했습니다.")); };
    channel.onclose = () => this.close();
  }
  private send(message: Record<string, unknown>) {
    if (this.closed || this.channel.readyState !== "open") throw new Error("파일 채널이 닫혔습니다.");
    this.channel.send(JSON.stringify({ v: 1, ...message }));
  }
  private armTimeout() {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = setTimeout(() => this.cancel("전송 응답 시간이 초과됐습니다."), 60_000);
  }
  async offerFile(file: File) {
    if (this.outgoing || this.incoming || this.offer) throw new Error("현재 파일 전송을 먼저 마쳐 주세요.");
    if (file.size > MAX_FILE_SIZE) throw new Error("파일당 최대 100MiB까지 전송할 수 있습니다.");
    const hash = await sha256(await file.arrayBuffer());
    if (this.closed) throw new Error("연결이 종료됐습니다.");
    const offer = { id: crypto.randomUUID(), name: safeFilename(file.name), size: file.size, hash };
    this.outgoing = { ...offer, file, cancelled: false };
    this.send({ type: "offer", ...offer }); this.armTimeout();
    this.changed("휴대폰에서 저장 위치를 선택하고 승인해 주세요.");
  }
  accept() {
    if (!this.offer) return;
    this.incoming = { ...this.offer, parts: [], received: 0 };
    this.send({ type: "accept", id: this.offer.id }); this.offer = null; this.offered(null); this.armTimeout();
  }
  cancel(message = "파일 전송을 취소했습니다.") {
    const id = this.outgoing?.id ?? this.incoming?.id ?? this.offer?.id;
    if (id && !this.closed && this.channel.readyState === "open") this.send({ type: "cancel", id });
    if (this.outgoing) this.outgoing.cancelled = true;
    this.outgoing = null; this.incoming = null; this.offer = null;
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null; this.offered(null); this.changed(message);
  }
  private async pump() {
    const file = this.outgoing;
    if (!file) return;
    for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
      while (this.channel.bufferedAmount > 256 * 1024) {
        if (file.cancelled || this.closed || this.channel.readyState !== "open") return;
        await new Promise(r => setTimeout(r, 10));
      }
      const chunk = await file.file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
      if (file.cancelled || this.closed) return;
      this.channel.send(encodeChunk(file.id, offset, chunk)); this.armTimeout();
      this.changed(`전송 ${Math.round(Math.min(file.size, offset + chunk.byteLength) / Math.max(1,file.size) * 100)}%`);
    }
    if (!file.cancelled && !this.closed) this.send({ type: "end", id: file.id });
  }
  private async receive(data: string | ArrayBuffer) {
    if (this.closed) return;
    if (typeof data !== "string") {
      const chunk = decodeChunk(data), file = this.incoming;
      if (!file || file.id !== chunk.id) return;
      if (chunk.offset !== file.received || file.received + chunk.bytes.byteLength > file.size) throw new Error("전송 순서 오류");
      file.parts.push(chunk.bytes); file.received += chunk.bytes.byteLength; this.armTimeout();
      this.changed(`수신 ${Math.round(file.received / Math.max(1,file.size) * 100)}%`); return;
    }
    if (data.length > 4096) throw new Error("메시지 초과");
    const m = JSON.parse(data);
    if (m.v !== 1 || typeof m.id !== "string" || !UUID.test(m.id)) throw new Error("프로토콜 오류");
    if (m.type === "offer") {
      if (this.offer || this.incoming || this.outgoing) { this.send({ type: "cancel", id: m.id }); return; }
      if (typeof m.name !== "string" || !Number.isInteger(m.size) || m.size < 0 || m.size > MAX_FILE_SIZE || !/^[a-f0-9]{64}$/.test(m.hash)) throw new Error("파일 정보 오류");
      this.offer = { id: m.id, name: safeFilename(m.name), size: m.size, hash: m.hash }; this.offered(this.offer); this.armTimeout();
    } else if (m.type === "accept" && this.outgoing?.id === m.id) {
      // Run independently so incoming cancellation is processed during sending.
      void this.pump().catch(() => this.cancel("파일 전송에 실패했습니다."));
    } else if (m.type === "end" && this.incoming?.id === m.id) {
      const file = this.incoming;
      if (!file) return;
      if (file.received !== file.size) throw new Error("파일 크기 불일치");
      const blob = new Blob(file.parts);
      if (await sha256(await blob.arrayBuffer()) !== file.hash) throw new Error("파일 해시 불일치");
      if (this.closed || this.incoming !== file) return;
      downloadBlob(blob, file.name); this.send({ type: "complete", id: file.id }); this.incoming = null;
      if (this.timeout) clearTimeout(this.timeout); this.changed("파일을 검증하고 저장했습니다.");
    } else if (m.type === "complete" && this.outgoing?.id === m.id) {
      this.outgoing = null; if (this.timeout) clearTimeout(this.timeout); this.changed("휴대폰에서 파일 저장을 완료했습니다.");
    } else if (m.type === "cancel" && [this.offer?.id,this.incoming?.id,this.outgoing?.id].includes(m.id)) this.cancel("상대 기기에서 전송을 취소했습니다.");
  }
  close() { this.closed = true; this.cancel("연결 종료로 부분 파일을 삭제했습니다. 다시 전송해 주세요."); }
}
