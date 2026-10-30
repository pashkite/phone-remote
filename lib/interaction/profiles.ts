export type InteractionMode = "game" | "novel" | "webtoon";
export type Mapping = { id: string; key: string; x: number; y: number; size: number; action: "hold" | "tap" | "longPress" };
export type InteractionProfile = {
  id: string; name: string; mode: InteractionMode; mappingEnabled: boolean; experimentalMulti: boolean; gamepadEnabled: boolean;
  joystick: { x: number; y: number; radius: number }; lookStick: { enabled: boolean; x: number; y: number; radius: number }; bindings: Mapping[]; sensitivity: number;
  quality: { edge: 540 | 720 | 1080 | 1440; fps: 24 | 30 | 60; auto: boolean };
  reading: { navigation: "vertical" | "horizontal" | "tap"; reverse: boolean; clickPages: boolean; leftZone: number; rightZone: number; distance: number; speed: number; autoSpeed: number; autoDirection: 1 | -1; shortcut: string; nextKey: string; previousKey: string };
  zoom: number; minimal: boolean; applyQualityOnSelect: boolean;
};
export type ProfileStore = { version: 1; mode: InteractionMode; selected: Record<InteractionMode, string>; profiles: InteractionProfile[] };
export const MODES: InteractionMode[] = ["game", "novel", "webtoon"];
export const isBindingKey = (value: string) => /^(Key[A-Z]|Digit[0-9]|Space|Arrow(Up|Down|Left|Right)|Mouse[0-4]|Pad([0-9]|1[0-6]))$/.test(value);
export const isButtonKey = (value: string) => isBindingKey(value) && !["KeyW","KeyA","KeyS","KeyD","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(value);
const num = (value: unknown, low: number, high: number, fallback: number) => typeof value === "number" && Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : fallback;
export const clampPoint = (x: number, y: number) => ({ x: num(x, 0, 1, .5), y: num(y, 0, 1, .5) });
export function defaultProfile(mode: InteractionMode, id = `${mode}-default`): InteractionProfile {
  return { id, name: mode === "game" ? "기본 게임" : mode === "novel" ? "기본 소설" : "기본 웹툰", mode, mappingEnabled: false, experimentalMulti: false, gamepadEnabled: false,
    joystick: { x: .22, y: .76, radius: .1 }, lookStick: { enabled: false, x: .72, y: .4, radius: .1 }, bindings: [{ id: "attack", key: "KeyF", x: .8, y: .75, size: .09, action: "hold" }, { id: "skill", key: "KeyE", x: .88, y: .6, size: .08, action: "hold" }, ...[0,1,2,3,4,5,6,7,8,9,10,11,16].map(n => ({ id: `pad-${n}`, key: `Pad${n}`, x: .7 + (n % 3) * .09, y: .6 + (n % 2) * .12, size: .08, action: "hold" as const }))],
    sensitivity: 1, quality: { edge: 1080, fps: 30, auto: false }, reading: { navigation: "vertical", reverse: false, clickPages: false, leftZone: .3, rightZone: .7, distance: .42, speed: 1, autoSpeed: .5, autoDirection: 1, shortcut: "KeyP", nextKey: "PageDown", previousKey: "PageUp" }, zoom: 1, minimal: false, applyQualityOnSelect: false };
}
export function sanitizeProfile(input: unknown, mode: InteractionMode, fallbackId = `${mode}-default`): InteractionProfile {
  const base = defaultProfile(mode, fallbackId);
  if (!input || typeof input !== "object") return base;
  const p = input as Partial<InteractionProfile>;
  const reading = p.reading ?? base.reading, joystick = p.joystick ?? base.joystick, look = p.lookStick ?? base.lookStick, quality = p.quality ?? base.quality;
  const seen = new Set<string>();
  const ids = new Set<string>();
  const bindings = Array.isArray(p.bindings) ? p.bindings.slice(0, 32).flatMap(m => {
    if (!m || typeof m !== "object" || typeof m.key !== "string" || !isButtonKey(m.key) || seen.has(m.key)) return [];
    seen.add(m.key);
    let id = typeof m.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(m.id) && !ids.has(m.id) ? m.id : `binding-${m.key}`; while(ids.has(id))id += "-x"; ids.add(id);
    return [{ id, key: m.key, ...clampPoint(m.x, m.y), size: num(m.size, .03, .25, .08), action: m.action === "tap" || m.action === "longPress" ? m.action : "hold" as const }];
  }) : base.bindings;
  return { id: typeof p.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(p.id) ? p.id : fallbackId,
    name: typeof p.name === "string" ? p.name.replace(/[\x00-\x1f]/g, "").slice(0, 48) || base.name : base.name,
    mode, mappingEnabled: p.mappingEnabled === true, experimentalMulti: p.experimentalMulti === true, gamepadEnabled: p.gamepadEnabled === true,
    joystick: { x: num(joystick.x, .1, .9, .22), y: num(joystick.y, .1, .9, .76), radius: num(joystick.radius, .02, .2, .1) }, lookStick: { enabled: look.enabled === true, x: num(look.x,.1,.9,.72), y: num(look.y,.1,.9,.4), radius: num(look.radius,.02,.2,.1) }, bindings, sensitivity: num(p.sensitivity, .25, 3, 1),
    quality: { edge: [540,720,1080,1440].includes(quality.edge) ? quality.edge : 1080, fps: [24,30,60].includes(quality.fps) ? quality.fps : 30, auto: quality.auto === true },
    reading: { navigation: ["vertical","horizontal","tap"].includes(reading.navigation) ? reading.navigation : "vertical", reverse: reading.reverse === true, clickPages: reading.clickPages === true, leftZone: num(reading.leftZone, .05, .45, .3), rightZone: num(reading.rightZone, .55, .95, .7), distance: num(reading.distance, .05, .7, .42), speed: num(reading.speed, .25, 3, 1), autoSpeed: num(reading.autoSpeed, .1, 3, .5), autoDirection: reading.autoDirection === -1 ? -1 : 1, shortcut: typeof reading.shortcut === "string" && /^Key[A-Z]$/.test(reading.shortcut) ? reading.shortcut : "KeyP", nextKey: typeof reading.nextKey === "string" && /^(Key[A-Z]|PageDown|Space)$/.test(reading.nextKey) && reading.nextKey!==reading.shortcut ? reading.nextKey : "PageDown", previousKey: typeof reading.previousKey === "string" && /^(Key[A-Z]|PageUp)$/.test(reading.previousKey) && reading.previousKey!==reading.shortcut && reading.previousKey!==reading.nextKey ? reading.previousKey : "PageUp" },
    zoom: num(p.zoom, .5, 3, 1), minimal: p.minimal === true, applyQualityOnSelect: p.applyQualityOnSelect === true };
}
export function defaultStore(): ProfileStore {
  return { version: 1, mode: "game", selected: { game: "game-default", novel: "novel-default", webtoon: "webtoon-default" }, profiles: MODES.map(mode => defaultProfile(mode)) };
}
export function parseStore(text: string | null): ProfileStore {
  const result = defaultStore();
  if (!text || text.length > 65536) return result;
  try {
    const value = JSON.parse(text);
    if (value?.version !== 1 || !Array.isArray(value.profiles)) return result;
    const ids = new Set<string>();
    const profiles: InteractionProfile[] = [];
    for (const p of value.profiles.slice(0,12)) {
      if (!p || !MODES.includes(p.mode)) continue;
      const profile = sanitizeProfile(p,p.mode);
      if (!ids.has(profile.id)) { ids.add(profile.id); profiles.push(profile); }
    }
    for (const mode of MODES) if (!profiles.some(p => p.mode === mode)) {
      if(profiles.length>=12){const extra=profiles.findIndex(p=>profiles.filter(v=>v.mode===p.mode).length>1);profiles.splice(extra,1);}
      profiles.push(defaultProfile(mode));
    }
    result.profiles = profiles;
    result.mode = MODES.includes(value.mode) ? value.mode : "game";
    for (const mode of MODES) result.selected[mode] = profiles.find(p => p.mode === mode && p.id === value.selected?.[mode])?.id ?? profiles.find(p => p.mode === mode)!.id;
    return result;
  } catch { return result; }
}
export function selectedProfile(store: ProfileStore) { return store.profiles.find(p => p.mode === store.mode && p.id === store.selected[store.mode]) ?? defaultProfile(store.mode); }
export function profileStorageKey(owner: string | null, device: string | null) {
  return `gr-interaction:v1:${encodeURIComponent(owner ?? "guest")}:${encodeURIComponent(device ?? "unselected")}`;
}
