import { eq } from "drizzle-orm";
import { getChatGPTUser, isAllowedOwnerEmail } from "../app/chatgpt-auth";
import { getDb } from "../db";
import { devices } from "../db/schema";

export async function requireApiUser() {
  const user = await getChatGPTUser();
  return user && isAllowedOwnerEmail(user.email) ? user : null;
}

export function apiError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function randomDigits(length: number) {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => String(value % 10)).join("");
}

export function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function clientFingerprint(request: Request) {
  const address =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const agent = request.headers.get("user-agent")?.slice(0, 160) ?? "unknown";
  return sha256Hex(`${address}|${agent}`);
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function authenticateDevice(request: Request) {
  const deviceId = request.headers.get("x-device-id")?.trim();
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";

  if (!deviceId || !token) return null;

  const db = await getDb();
  const [device] = await db
    .select()
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);

  if (!device) return null;
  const candidateHash = await sha256Hex(token);
  return constantTimeEqual(candidateHash, device.tokenHash) ? device : null;
}

export function safeDeviceName(value: unknown) {
  if (typeof value !== "string") return "Galaxy Device";
  const compact = value.trim().replace(/\s+/g, " ").slice(0, 80);
  return compact || "Galaxy Device";
}

export function safeInteger(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}
