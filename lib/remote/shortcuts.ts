const shortcutActions: Record<string, { command: string; label: string }> = {
  r: { command: "recents", label: "최근 앱" },
  h: { command: "home", label: "홈" },
  b: { command: "back", label: "뒤로가기" },
};

export function resolveShortcut(event: {
  key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean;
  metaKey: boolean; repeat: boolean; isComposing: boolean;
}, blocked: boolean) {
  const idle = { consume: false, action: null };
  if (blocked || event.isComposing || !event.altKey || event.ctrlKey || event.shiftKey || event.metaKey) return idle;
  const action = shortcutActions[event.key.toLowerCase()];
  if (!action) return idle;
  return { consume: true, action: event.repeat ? null : action };
}
