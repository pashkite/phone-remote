export const shortcutActions: Record<string, { command: string; label: string }> = {
  r: { command: "recents", label: "최근 앱" },
  h: { command: "home", label: "홈" },
  b: { command: "back", label: "뒤로" },
  n: { command: "notifications", label: "알림창" },
};

export function shortcutStep(event: {
  key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean;
  metaKey: boolean; repeat: boolean; isComposing: boolean;
}, armedUntil: number, now: number, blocked: boolean) {
  const idle = { armedUntil: 0, consume: false, action: null };
  if (!blocked && !event.isComposing && event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey && event.key.toLowerCase() === "h") {
    return { armedUntil: 0, consume: true, action: event.repeat ? null : shortcutActions.r };
  }
  if (blocked || event.isComposing || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return idle;
  if (event.repeat) return { ...idle, armedUntil };
  if (event.key === "F8") return { armedUntil: now + 1500, consume: true, action: null };
  if (now >= armedUntil) return idle;
  const action = shortcutActions[event.key.toLowerCase()];
  return { armedUntil: 0, consume: !!action, action: action ?? null };
}
