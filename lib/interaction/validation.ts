import type { InteractionProfile } from './profiles';

/** Editor validation runs before normalization, which intentionally sanitizes imported profiles. */
export function mappingProblem(profile: InteractionProfile): string | null {
  const keys = new Set<string>();
  for (const binding of profile.bindings) {
    if (keys.has(binding.key)) return `중복 키 ${binding.key}: 다른 키를 지정하세요.`;
    keys.add(binding.key);
  }
  for (const point of [...profile.bindings, profile.joystick, profile.lookStick]) {
    if (![point.x, point.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1))
      return '좌표는 0부터 1 사이의 숫자로 입력하세요. 변경을 적용하지 않았습니다.';
  }
  return null;
}

export function savedProfileProblem(raw: string | null): string | null {
  if (raw === null) return null;
  try {
    const data = JSON.parse(raw);
    if (data?.version !== 1 || !Array.isArray(data.profiles) || !data.profiles.length || data.profiles.length > 12 || raw.length > 65536)
      return '저장 프로필 형식을 읽을 수 없습니다. 임시 기본값을 사용합니다. 원본 저장값은 보존합니다.';
    for (const p of data.profiles) {
      if (!p || !['game','novel','webtoon'].includes(p.mode) || !Array.isArray(p.bindings) || p.bindings.length > 32 || !p.joystick || !p.lookStick || mappingProblem(p))
        return '저장 프로필에 잘못된 매핑이 있습니다. 임시 기본값을 사용합니다. 원본 저장값은 보존합니다.';
    }
  } catch { return '저장 프로필이 손상되었습니다. 임시 기본값을 사용합니다. 원본 저장값은 보존합니다.'; }
  return null;
}
