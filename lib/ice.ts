export type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

type RuntimeEnv = {
  TURN_KEY_ID?: string;
  TURN_API_TOKEN?: string;
};

const fallbackIceServers: IceServer[] = [
  { urls: "stun:stun.cloudflare.com:3478" },
];

export async function getIceServers(): Promise<IceServer[]> {
  try {
    const { env } = await import("cloudflare:workers");
    const runtimeEnv = env as unknown as RuntimeEnv;
    const keyId = runtimeEnv.TURN_KEY_ID?.trim();
    const apiToken = runtimeEnv.TURN_API_TOKEN?.trim();

    if (!keyId || !apiToken) return fallbackIceServers;

    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: 3600 }),
      },
    );

    if (!response.ok) return fallbackIceServers;
    const payload = (await response.json()) as { iceServers?: IceServer[] };
    return payload.iceServers?.length ? payload.iceServers : fallbackIceServers;
  } catch {
    return fallbackIceServers;
  }
}
