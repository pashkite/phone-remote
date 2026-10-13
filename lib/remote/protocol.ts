export const PROTOCOL_VERSION = 1;
export const MAX_FILE_SIZE = 100 * 1024 * 1024;
export const CHUNK_SIZE = 16 * 1024;
export const MAX_CLIPBOARD_BYTES = 64 * 1024;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export type CommandStatus = "received" | "accepted" | "completed" | "failed" | "timeout";
export function safeFilename(value: string) {
  return value.replace(/[\\/\u0000-\u001f\u007f]/g, "_").replace(/^\.+/, "_").slice(0, 180) || "download";
}
export function encodeChunk(id: string, offset: number, bytes: ArrayBuffer) {
  if (!UUID.test(id) || !Number.isInteger(offset) || offset < 0 || offset > MAX_FILE_SIZE || bytes.byteLength > CHUNK_SIZE) throw new Error("잘못된 파일 청크");
  const data = new Uint8Array(20 + bytes.byteLength);
  const hex = id.replaceAll("-", "");
  for (let i = 0; i < 16; i++) data[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  new DataView(data.buffer).setUint32(16, offset);
  data.set(new Uint8Array(bytes), 20);
  return data.buffer;
}
export function decodeChunk(data: ArrayBuffer) {
  if (data.byteLength < 20 || data.byteLength > CHUNK_SIZE + 20) throw new Error("잘못된 파일 청크");
  const hex = Array.from(new Uint8Array(data, 0, 16), b => b.toString(16).padStart(2, "0")).join("");
  return { id: `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`, offset: new DataView(data).getUint32(16), bytes: data.slice(20) };
}
export async function sha256(data: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), b => b.toString(16).padStart(2,"0")).join("");
}
