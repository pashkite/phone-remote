# Galaxy Remote 2.0 — 5단계 UI/UX·브랜딩 개발 보고서

작성일: 2026-10-30 (한국 시간). **최종 판정: CONDITIONAL GO — 제한을 유지하며 통합 QA 진행 가능.**

## 1. 작업 개요

- 저장소: `pashkite/phone-remote`.
- 기준: `feature/galaxy-remote-2-interaction-modes`, `2521dafa4475bb3d52c700d03100c0ec7ef2eec3`.
- 작업: `feature/galaxy-remote-2-ux-branding`. 기준 커밋에서 새 브랜치를 만들었다.
- 실제 웹 UI, SVG·PNG·ICO, Android 리소스와 표시 이름을 구현하고 로컬 빌드·테스트했다.
- 운영 배포, 공개 APK 교체, main/master/기존 개발 브랜치 병합은 수행하지 않았다.
- 화면 OFF·갤럭시 입력·실제 성능은 **미검증**이다. 브라우저의 가상 휴대폰을 실기기 검증으로 계산하지 않는다.

증거: [검증 요약](assets/stage5/validation.txt), [APK/JUnit 검사](assets/stage5/build-evidence.json).

## 2. 기존 UI/UX 문제

코드와 변경 전 실제 Chromium 화면을 먼저 확인했다. 로그인 외부 제공자의 화면은 접근하지 않았다.

| 발견 | 근거 | 영향/처리 |
|---|---|---|
| 긴 조작 폼이 영상 위에 위치 | `app/remote-console.tsx`, 변경 전 player/novel 캡처 | 영상이 첫 화면 아래로 밀림 → 옆 패널로 이동 |
| 여러 번 덧붙인 CSS, 선택 버튼의 흰 배경/흰 글자 | 이전 `app/globals.css`, before 이미지 | 선택 상태 대비 부족 → 하나의 토큰 체계로 교체 |
| 플레이어와 제어 카드의 균형, 과도한 여백/휴대폰 테두리 | before player | 영상 영역을 우선하고 장식 제거 |
| DataChannel open만으로 연결 성공 표시 가능 | 이전 `channel.onopen` | Peer 연결과 채널 open을 모두 확인하도록 수정 |
| 프로필 저장 오류를 무시, 잘못된 저장값 자동 정규화·덮어쓰기 | 이전 `use-interaction.ts` | 저장 실패 안내와 손상 원본 보존 추가 |
| 개인/공용 모드 전환 때 비동기 읽기보다 자동 저장이 먼저 실행될 가능성 | 저장 effect의 기존 key 검사 | 저장 정책까지 포함한 로드 identity 검사 추가 |
| 기존 기기가 있으면 새 페어링 성공으로 표시 | 이전 `verifyPairing` | 등록창을 연 시점의 ID 목록과 새 기기를 비교 |
| `batteryLevel` 누락 시 `undefined%` | 이전 값의 null 전용 검사, 모의 API | 유한한 수만 표시하고 나머지는 확인 불가 |
| 웹이 가리키던 v0.5.3/v0.4.5 APK가 실제 공개 폴더에 없음 | `public/downloads`, 기존 안내 | 존재하지 않는 다운로드 링크 제거, 시험 앱 안내 제공 |

before-01은 기기 응답 전 초기 화면이고, before-02/03은 모의 휴대폰 연결 화면이다. 초기 화면을 실제 미등록 기기 판정 근거로 사용하지 않았다.

## 3. 개선한 사용자 흐름

게스트 로그인 안내 → 소유자 콘솔 → 기기 선택/새 기기 등록 → 요청·승인 단계 확인 → 원격 플레이어 → 게임/소설/웹툰 → 필요할 때 설정 패널 → 종료 확인 순서다.

플레이어의 모드 전환·전체화면·화면 맞춤·패널 숨김·종료를 상단에 배치했다. 옆 패널에서 조작/프로필, 화질, 연결, 빠른 제어, 전송 도구, 통계, 실험 안내와 도움말에 접근한다. 패널은 영상 위를 덮지 않으며 작은 화면에서는 아래에 배치한다. 기기 관리는 기존 설정 다이얼로그를 이용한다.

## 4. 디자인 시스템

`app/globals.css`의 중복 스타일을 교체했다. 토큰으로 테마를 전환하며 기존 `gr_pref_theme` 값을 유지한다.

| 용도 | 다크 | 라이트 |
|---|---|---|
| 페이지 | `#0B1119` | `#F1F5F9` |
| 표면 | `#111C2A` | `#FFFFFF` |
| 보조 표면 | `#192638` | `#E8EFF5` |
| 본문 | `#E3EDF7` | `#142337` |
| 보조 글자 | `#A5B5C8` | `#4D6076` |
| 구분선 | `#304158` | `#AABCCF` |
| 포인트 | `#67D8CA` | `#006B62` |

본문 14px, 조작 폼 12px, 보조 정보 11px, 화면 제목 18–20px. 간격 4/6/8/12/16/20/28px, 버튼 6px·패널 8px·다이얼로그 10px 모서리를 사용했다. 불필요한 그라데이션·글래스·그림자를 제거했다. 표시 크기를 제한한 플레이어와 스크롤 가능한 데스크톱 패널로 설정 때문에 영상이 밀리지 않도록 했다.

## 5. 게임 모드 UI 변경

- WASD, 실험적 멀티터치, 표준 게임패드→터치 매핑과 오른쪽 스틱 설정 유지.
- 편집/플레이를 분리하고 편집 중 실제 입력을 중지한다.
- 화면의 마커를 드래그하거나 방향키로 이동한다. 기본 0.01, Shift+방향키 0.05의 정규화 좌표 이동이다.
- 버튼 추가·삭제·키/패드 코드·동작·크기·X/Y·조이스틱 반경·감도를 설정한다.
- 중복 키와 잘못된 좌표를 정규화 전에 거부하고 경고한다. 마커 드래그는 실제 변환된 영상 사각형을 사용한다.
- 매핑 표시/숨김, 프로필 선택/저장/불러오기/초기화를 제공한다.
- 플레이 중 표시 마커는 입력을 가로채지 않는다. 편집 마커는 별도로 이벤트를 처리한다.

브라우저에서 편집 중 원격 입력 없음, 드래그, 키보드 이동, 확대 후 좌표, 회전 후 좌표를 확인했다. Android 게임 호환성과 실제 멀티터치는 **미검증**이다.

## 6. 소설 모드 UI 변경

중앙 영상, 확대/맞춤/전체화면, Shift+드래그, 이전·다음 페이지 버튼, 기존 휠·Page Up/Down·방향키·Space를 지원한다. 탐색 방식·방향·민감도·사용자 키 설정을 유지한다.

자동 스크롤의 시작/일시정지/재개/중지 상태를 한국어로 표시한다. 상태의 기계 판독 값은 `data-state`로 분리했다. 자동 스크롤은 **제한된 반복 스와이프**이며 현재 페이지·독서 진도는 알 수 없다고 명시했다. 실제 소설 앱 동작은 **미검증**이다.

## 7. 웹툰 모드 UI 변경

기본 표시에서 원본 비율을 유지하고 `object-fit: contain`을 사용한다. 화면 맞춤, 확대·이동, 전체화면, 휠 감도/방향, 자동 스크롤, 도구·커서 자동 숨김을 유지한다. 숨김 상태에서도 도구의 hover/focus로 다시 접근할 수 있다.

브라우저가 웹툰 원본을 내려받지 않으며 Android 화면을 조작하는 구조다. FLAG_SECURE/DRM 제한은 유지한다. 실제 웹툰 앱 호환성은 **미검증**이다.

## 8. 기기 등록·연결 UX 개선

상태는 연결 전 / 연결 요청 중 / 기기 응답 대기 / 화면 공유 승인 대기 / WebRTC 협상 중 / 연결됨 / 재연결 중 / 연결 종료 / 오류로 나눴다. 기존 세션 응답과 Peer/DataChannel 이벤트를 근거로 표시한다. `peer.connectionState === "connected"`와 열린 제어 채널이 모두 필요하며, 채널 준비가 끝나기 전에는 협상 타임아웃 감시를 유지한다.

기기 상태는 서버의 online 값과 45초 내 마지막 응답을 함께 확인해 **최근 응답 있음**으로 표시한다. 정보가 부족하면 상태 확인 불가다. 최근 응답은 원격 세션이나 게임 정상 실행을 보증하지 않는다.

페어링은 기존 API를 그대로 사용한다. 실패·새 코드·만료·남은 시간·등록 확인을 제공한다. 기존 기기만으로 새 등록 성공을 표시하지 않는다. 설치 안내는 아직 공개 배포하지 않은 시험 앱과 기존 설치 보존을 설명한다.

## 9. 오류 및 접근성 개선

| 상황 | 안내/검증 범위 |
|---|---|
| 로그인 만료·목록 불러오기 실패 | 한국어 오류·목록 재시도·다시 로그인 안내, 401 브라우저 fixture 확인 |
| 기기 없음·오프라인·상태 불명 | 서로 다른 안내, 실시간 성공으로 단정하지 않음 |
| 코드 생성 실패·만료 | 오류/새 코드/만료 표시 및 재시도 확인 |
| 화면 공유 승인 필요 | 별도 단계 표시; 실제 Android 승인창은 미검증 |
| 접근성/입력 오류 | 기존 inputError·명령 응답 유지, 자동 입력 중지 회귀 확인 |
| WebRTC·네트워크·TURN 문제 | 기존 제한된 재연결 유지, 네트워크/권한/중계 도움말 제공 |
| 패드 연결 해제 | 기존 입력 해제와 Gamepad 상태 표시 유지; 가상 패드로 회귀 확인 |
| 저장값 손상·용량 부족 | 원본 자동 덮어쓰기 차단, 이번 세션 유지와 실패 안내 |
| 전체화면 거부 | 브라우저 권한 안내, 거부 fixture 확인 |
| 화면 OFF 미지원/상태 | 읽기 전용 실험 안내; 웹에서 지원/복구를 단정하지 않음 |

버튼·입력·summary·링크의 focus-visible, 텍스트 상태, aria-pressed/expanded/controls, 다이얼로그 포커스 순환·Escape·초점 복귀를 제공한다. reduced-motion에서는 애니메이션을 끈다. 기존 Alt+R/H/B와 설정 입력창 제외 정책은 변경하지 않았다. 보조공학 전체 인증이나 스크린리더 실기기 테스트를 수행했다고 주장하지 않는다.

## 10. 반응형 화면 검증

실제 headless Chromium에서 각 크기로 세 모드를 렌더링했다. 수평 넘침 여부와 영상의 실제 경계 크기를 검사했다.

| 뷰포트 | 게임 | 소설 | 웹툰 |
|---|---|---|---|
| 1920×1080 | 통과 | 통과 | 통과 |
| 1440×900 | 통과 | 통과 | 통과 |
| 1280×720 | 통과 | 통과 | 통과 |
| 1024×768 | 통과 | 통과 | 통과 |
| 390×844 | 통과 | 통과 | 통과 |

라이트 테마는 1440×900에서 추가 확인했다. 좁은 화면은 세로 스크롤이 있으며 패널을 접을 수 있다. 실제 Galaxy 모바일 브라우저와 Safari/Firefox는 **미검증**이다.

## 11. 새로운 서비스명 적용

웹 헤더/게스트 안내/권한 오류/등록 화면/문서와 HTML title/application-name/OG/PWA, Android 런처/메인 제목/접근성·키보드 표시/알림에 **Galaxy Remote 2.0**을 적용했다. PWA short_name은 **Galaxy Remote**, 별도 Android 시험 앱은 **Galaxy Remote 2.0 Test**다.

내부 패키지·API·기기 토큰·서버 주소·저장 키는 바꾸지 않았다. Android 기술 버전은 기존 `versionName 0.5.3`, `versionCode 17`을 유지한다. 표시 브랜드 2.0은 실기기 검증된 정식 릴리스 선언이 아니다.

## 12. 브랜드 아이콘 디자인 설명

오리지널 심벌은 열린 휴대폰 프레임과 화면 밖으로 향하는 청록 화살표다. 작은 글자 없이 두 개의 굵은 경로만 사용한다. 네이비 바탕·밝은 프레임·청록 입력/연결 방향을 웹과 Android에서 공유한다. 외부 공식 로고나 임시 이모지를 브랜드 마크로 사용하지 않았다.

16/32/48/192/512px 실제 PNG를 브라우저에서 디코딩·표시하고 원형/둥근 사각 마스크의 이미지를 확인했다. Android 실제 런처 마스크 표시는 별도 미검증이다.

## 13. SVG 원본과 자산 파일 경로

- 원본: `assets/brand/galaxy-remote-symbol.svg` (96×96 viewBox).
- 웹: `public/favicon.svg`, `public/favicon.ico`, `public/brand/symbol.svg`.
- PNG: `public/brand/icon-{16,32,48,180,192,512}.png`.
- 기타: `public/brand/maskable-512.png`, `public/brand/social.png` (1200×630).
- Android: `app/src/main/res/drawable/ic_brand_*.xml`, `mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}`와 adaptive 리소스.
- 시험 변형: `app/src/panelTest/res`.
- 재생성: `scripts/generate-brand-assets.py`, `scripts/requirements-brand.txt`.

재생성에는 Python, CairoSVG 2.9.1, Pillow 13.0.0, 시스템 Cairo와 DejaVu Sans가 필요하다. 앱 실행/일반 테스트에는 그래픽 생성 의존성이 필요하지 않다.

```bash
python3 -m venv /tmp/galaxy-brand-env
/tmp/galaxy-brand-env/bin/pip install -r scripts/requirements-brand.txt
/tmp/galaxy-brand-env/bin/python scripts/generate-brand-assets.py
node --test tests/branding.test.mjs
```

## 14. 파비콘 적용 결과

ICO의 실제 16/32/48px PNG 엔트리와 각 PNG의 CRC·압축 데이터·크기를 검증했다. SVG 원본/복사본 일치를 검사하고 실제 로컬 HTTP 200·MIME 및 브라우저 이미지 디코딩을 확인했다. `app/layout.tsx`에서 ICO/SVG/32px PNG와 shortcut을 참조한다.

기존 파비콘 캐시를 구분하도록 참조에 `?v=2`를 사용했다. 브라우저는 이전 사이트 아이콘 캐시를 별도로 유지할 수 있으므로 실제 배포 후 새 탭·강력 새로고침·새 북마크로 확인해야 한다. 브라우저 크롬 영역의 탭 아이콘·실제 북마크 UI는 headless 스크린샷에 포함되지 않으므로 최종 사용자 검증 항목이다.

## 15. PWA 아이콘·메타데이터 적용

manifest에 name/short_name/start_url/scope/id/theme/background 및 192/512/불투명 maskable 512를 추가했다. Apple Touch Icon은 180px다. HTML description/application-name/theme-color, OG title/description/실제 social.png를 적용했다.

이번 단계에서 서비스 워커나 오프라인 지원을 추가하지 않았다. **PWA 설치 가능·설치 성공을 보장하지 않는다.** HTTPS/호스팅 응답/브라우저 정책 등 최종 설치 조건과 iOS 홈 화면·공유 플랫폼 미리보기는 미검증이다. 인증·영상·입력을 캐시하는 오프라인 기능도 추가하지 않았다.

## 16. Android 앱 아이콘 및 이름 변경

Manifest의 icon/roundIcon과 메인 화면 아이콘을 새 mipmap으로 연결했다. legacy 48/72/96/144/192px, adaptive 전경/불투명 배경, API 33 이상 monochrome을 제공한다. 전경은 108 viewport에서 원본 경로를 중앙 안전 영역으로 축소한다. legacy round PNG도 실제 원형 알파 마스크다.

XML 파싱, Android 리소스 컴파일, APK badging으로 `Galaxy Remote 2.0` 이름과 패키지·아이콘 리소스를 확인했다. 실기기 런처·테마 아이콘·홈 화면 레이아웃은 미검증이다.

## 17. 운영·테스트 앱 구분

| 항목 | 운영 패키지용 빌드 | 화면 OFF 시험 빌드 |
|---|---|---|
| 표시 이름 | Galaxy Remote 2.0 | Galaxy Remote 2.0 Test |
| 패키지 | `com.galaxyremote.app` | `com.galaxyremote.app.paneltest` |
| 별도 표식 | 기본 심벌 | 같은 심벌 + 작은 앰버 점 (legacy/adaptive) |
| 화면 OFF 기능 | 기존 disabled 정책 | 기존 사전 검사·복구 게이트 유지 |
| 이번 release 서명 | unsigned | 기존 debug 서명 |

새 운영 서명키를 생성하지 않았다. 시험 APK의 SHA-256 인증서는 기존 4단계 시험 APK와 동일하다 (`8f568dd3778c9b0f8a316427c1a2e048a2f454f153a9b6d40dd3e4337dd0748f`). 이것은 실제 설치된 운영 앱의 업데이트 서명 호환성을 증명하지 않는다. 운영 APK는 기존 원래 키로 서명하고 인증서를 비교해야 한다.

## 18. 변경 전후 스크린샷

총 30개의 실제 로컬 Chromium 캡처를 [assets/stage5](assets/stage5)에 보관했다. 휴대폰·계정 API·패드는 fixture이며 화면에도 이를 표시한다. 실기기 성공 증거가 아니다.

| 대상 | 변경 전 | 변경 후 |
|---|---|---|
| 연결/영상 | [player](assets/stage5/before-02-player.png) | [1920 게임](assets/stage5/after-06-1920x1080-game-dark.png) |
| 소설 | [novel](assets/stage5/before-03-novel.png) | [1280 소설](assets/stage5/after-06-1280x720-novel-dark.png) |
| 초기 상태 | [응답 전 화면](assets/stage5/before-01-devices.png) | [미등록](assets/stage5/after-10-empty-devices.png) |
| 편집 | — | [드래그/속성](assets/stage5/after-05-mapping-editor.png) |
| 좁은 화면 | — | [390 웹툰](assets/stage5/after-06-390x844-webtoon-dark.png) |
| 라이트 | — | [1440](assets/stage5/after-07-light-1440.png) |
| 게스트 | — | [로그인 안내](assets/stage5/after-11-guest.png) |
| 아이콘 | — | [실제 크기/마스크](assets/stage5/after-12-brand-sizes-masks.png) |
| 오류 | — | [로그인 만료](assets/stage5/after-09-login-expired.png), [저장 실패](assets/stage5/after-13-storage-failure.png) |

## 19. 실제 실행한 브라우저 테스트

`/usr/bin/chromium` + Playwright로 로컬 `127.0.0.1:5175`에서 두 스크립트를 실행했다. fixture는 로컬 호스트만 허용한다. 로그인 제공자·운영 서버·실제 Android와 통신하지 않는다.

1. `scripts/test-interaction-browser.mjs`: 기존 WASD/대각선/멀티 snapshot·개별 pointercancel·수정키 keyup·편집 격리·표준 패드 매핑/해제·독서 키·자동 스크롤·회전/입력 오류 해제·확대/팬/맞춤/전체화면·모드 전환의 peer/수동 화질 유지·개인/공용 저장 회귀 통과.
2. `scripts/test-ux-branding-browser.mjs`: 11개 시나리오 그룹 통과. 실제 메타데이터·MIME·아이콘 디코딩, 코드 실패/만료/재시도, 포커스/Escape, 승인/협상/연결 게이트, 통계 unknown, 패널 접기, 화면 OFF 읽기 전용, 편집 드래그/키/중복/좌표/확대/회전, 5크기×3모드, 라이트/reduced-motion, 종료/재연결/전체화면 거부, 미등록/오프라인/401, 게스트, 4단계 저장값·공용 전환·quota·손상 원본 보존 확인.

```bash
# 로컬 개발 서버를 별도 터미널에서 실행
bash scripts/sites-env.sh -- npm run dev -- --port 5175
# Playwright와 Chromium을 설치한 환경에서 실행
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_EXECUTABLE=/path/to/chromium node scripts/test-interaction-browser.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_EXECUTABLE=/path/to/chromium node scripts/test-ux-branding-browser.mjs
```

CI에도 두 스크립트와 전체 lint를 연결했다. 로컬 통과가 새 GitHub Actions 실행 성공을 의미하지는 않는다.

## 20. 전체 자동화 테스트 결과

| 검사 | 최종 실제 결과 |
|---|---|
| 전체 ESLint | 통과, 오류/경고 0 |
| TypeScript `--noEmit` | 통과 |
| 웹 Node 테스트 | **80 통과**, 실패/스킵 0 (기존 73 + 브랜드 4 + 편집 검증 3) |
| Python unittest | **6 통과** |
| Android debug 단위 테스트 | **15 통과**, 실패/오류/스킵 0 |
| Android panelTest 단위 테스트 | **15 통과**, 실패/오류/스킵 0 |
| 실제 Chromium 스크립트 | 2개 통과 (휴대폰/API 시뮬레이션) |
| Android instrumentation | 컴파일 통과, 실행 미검증 |

완료 전 전체 실행 한 번에서 기존 파일 전송 손상 검사 테스트가 실패했다. 원인은 비동기 SHA-256 완료를 고정 15ms 뒤 단정하는 테스트 경쟁이었다. `tests/remote-protocol.test.mjs`를 2초 상한의 실제 중단 상태 대기로 수정했고 동일 무결성/cancel assertion을 유지했다. 최종 전체 80개가 통과했다. 실패 테스트를 비활성화하거나 스킵하지 않았다.

실행 명령:

```bash
bash scripts/sites-env.sh -- npm run lint
bash scripts/test-web-streaming.sh
gradle -p android-client :app:testDebugUnitTest :app:testPanelTestUnitTest :app:assemblePanelTest :app:assembleDebug :app:assembleRelease :app:assembleDebugAndroidTest --no-daemon --max-workers=3
```

실행 환경: Node 24.19.0, JDK 17, Gradle 8.11.1, SDK/platform/build-tools 35. 기존 compileSdk/targetSdk 설정을 유지했다. Android 단위 테스트는 PanelLease 3 + StreamingPolicy 7 + MultiPointerState 5개씩이다.

## 21. Android 및 웹 빌드 결과

Vite/vinext production 웹 빌드와 `scripts/validate-artifact.sh`의 Worker 산출물 검사 통과. 배포 명령은 실행하지 않았다.

| APK | ABI | 결과 |
|---|---|---|
| `app/build/outputs/apk/panelTest/app-panelTest.apk` | arm64-v8a | debug 서명, 빌드/서명/16KiB ZIP 정렬 검사 통과 |
| `app/build/outputs/apk/debug/app-debug.apk` | x86_64 | debug 서명, 빌드/서명/정렬 통과; Galaxy용 아님 |
| `app/build/outputs/apk/release/app-release-unsigned.apk` | arm64-v8a | unsigned 빌드/정렬 통과; 서명 전 설치/업데이트용 아님 |
| `app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk` | 테스트 코드 | 빌드/서명/정렬 통과; 실행하지 않음 |

APK 경로는 `android-client/` 기준이다. 별도 로컬 시험 사본:
`outputs/ux-branding/apk/GalaxyRemote-stage5-arm64-paneltest.apk` (16,317,042 bytes).

SHA-256: `5876ce3087ab54093b60f482ecea51fbf20c99a937ee6b3836f53208830eda49`.

이 파일은 공개 다운로드/Release에 게시하지 않았다. ZIP 정렬 검사는 전체 native ELF 또는 실제 Android 16 호환성 검증이 아니다. APK별 나머지 hash·이름·패키지·ABI는 [build-evidence.json](assets/stage5/build-evidence.json)에 기록했다.

## 22. 기존 설정·데이터 호환성

계정 인증, API, DB schema, 기기 토큰, package IDs, Android preferences, 기본 서버 URL, 서명 정책은 변경하지 않았다. 기존 웹 저장 키와 프로필 `version:1`을 유지했다.

`tests/fixtures/interaction-v1-stage4.json`은 기준 커밋의 프로필 생성 코드에서 만든 고정 fixture다. 기존 이름·좌표·웹툰 확대 값을 개인→공용→개인 전환 후 확인했다. 공용 모드 변경이 개인 저장값을 덮지 않는다. quota 실패 시 현재 세션만 유지하고 저장 성공을 표시하지 않는다.

손상 저장값은 임시 기본값을 사용하며 자동으로 덮지 않는다. 사용자가 명시적으로 ‘프로필 저장’을 하면 현재 설정으로 교체할 수 있다. 변경은 개인 PC에서 기존처럼 자동 저장되며 ‘불러오기’는 디스크 재읽기다. 별도 이전 버전 이력/undo를 제공하는 저장 시스템은 아니다.

실제 설치 앱의 데이터 유지·업데이트 호환성은 미검증이다. 기존 앱을 삭제하거나 데이터를 지우는 명령을 실행하지 않았다.

## 23. 실기기 미검증 항목

`adb devices -l`에 연결 장치가 없고 KVM도 없어 다음은 모두 **미검증**이다.

- Galaxy Android 15/16·One UI 실제 패널 OFF, 캡처/게임 실행 지속, 5분 이상 세션.
- 정상/비정상 종료·Shizuku 중단·재부팅 후 실제 패널 복구와 자동 복구.
- 단일 터치/길게 누르기/드래그/연속 멀티터치·하드웨어 게임패드의 실제 앱 호환성.
- 소설·웹툰 앱별 휠/자동 스와이프/방향·DRM 표시.
- 종단 지연, 열/전력 제한, 인코더·H.264, 실제 STUN/TURN/NAT 환경.
- Galaxy 런처/adaptive/monochrome 아이콘, 설치 앱 이름, 운영 앱 업데이트/데이터 보존.
- 운영 OAuth·실제 페어링·브라우저 설치/PWA·홈 화면·북마크/탭 캐시·공유 미리보기.

화면 OFF 웹 안내는 Shizuku/지원/현재 패널/복구 상태를 모두 확인 불가 또는 미검증으로 표시한다. shell API나 OFF 버튼을 추가하지 않았다. 기존 실험 코드·AIDL·30/330초 시험·복구 게이트는 그대로다. 정책 단위 테스트 통과는 실제 복구 성공 증거가 아니다.

## 24. 남은 문제점

1. 원래 운영 서명키가 이 환경에 없어 운영 업데이트 APK를 서명하지 않았다. 원래 키·설치된 인증서 비교 없이 release APK를 배포하면 안 된다.
2. Android 16 `LiveTouchTest`는 별도 미해결 항목이다. 이전 보고서에는 UiAutomation의 접근성 서비스 억제와 이후 probe-window fixture 문제가 기록되어 있다. 현재 테스트/워크플로를 변경하거나 비활성화하지 않았다. 원본 Actions API는 Forbidden으로 재조회하지 못했고 새 실기기 실행도 없으므로 해결됐다고 판정하지 않는다. 다음 QA에서 JUnit/logcat·접근성 연결·TouchProbeActivity focus/resume·DOWN/MOVE/UP·dispatchGesture callback을 함께 수집해야 한다.
3. panel OFF 중 MediaProjection 중단 가능성, shell capture 대안의 구현/연동은 기존 미검증 상태다. 웹 UI는 성공을 가정하지 않는다.
4. 기기 ‘최근 응답 있음’과 실제 스트리밍 가용성은 별개다. 기존 재연결에는 횟수/시간 제한이 있다.
5. 새 시험 APK는 아직 공개 배포하지 않았다. 기존 공개 파일을 그대로 보존했고 잘못된 신버전 링크만 제거했다.
6. 네트워크 도움말은 실제 TURN 제공/유료 서버 자동 추가 기능이 아니다. 직접 연결이 불가능하면 환경에 따라 연결이 실패할 수 있다.
7. Chromium 외 브라우저·운영 로그인·실기기·접근성 보조기기 종합 검증은 남아 있다.

## 25. 수정 파일 목록

전체 경로는 [modified-files.txt](assets/stage5/modified-files.txt)에 기록했다. 주요 변경 묶음:

- 웹: `app/remote-console.tsx`, `public-console.tsx`, `page.tsx`, `layout.tsx`, `globals.css`, `components/interaction-controls.tsx`, `interaction-overlay.tsx`.
- 입력/프로필: `lib/interaction/use-interaction.ts`, `validation.ts`.
- 브랜드: `assets/brand`, `public/brand`, favicon/manifest, 생성 스크립트·의존성 목록, package displayName.
- Android: Manifest·문자열·메인 레이아웃·표시용 Kotlin 문자열, main/panelTest 아이콘 리소스.
- 테스트: 브랜드/편집 검증, 기존 프로토콜 대기 개선, 4단계 fixture, 공통 브라우저 fixture, 두 브라우저 테스트, 웹 CI.
- 문서/근거: 이 보고서, 30개 PNG, 빌드/JUnit JSON과 검증 요약.

계정·기기 API/DB, Android build/signing 설정, Shizuku 디스플레이 클래스/AIDL, 캡처 엔진, 기존 instrumentation, 공개 다운로드는 기준 커밋과 diff가 없다.

## 26. GitHub 브랜치 및 커밋

작업 브랜치: `feature/galaxy-remote-2-ux-branding`.

- `a841041` — 웹/Android 이름·브랜드 원본·생성 자산·메타데이터·브랜드 테스트.
- `d069575` — 플레이어 중심 UI·매핑 편집·연결/저장 안전성·브라우저/자동화 회귀.
- 문서 커밋 — 본 보고서·스크린샷·검사 근거 (해시는 Git 로그/최종 응답에서 확인).

보호 브랜치 확인 시 원격 main=`cb9666b42d1bc3a2cc241097e7014d228f35c4d5`, master=`e3025397a344cfdc197f78637b88ae88e274ab37`, 4단계=`2521dafa4475bb3d52c700d03100c0ec7ef2eec3`였다. 최신 5단계 지시에 따라 이 브랜치들에 병합하거나 푸시하지 않는다.

## 27. PR 또는 비교 링크

GitHub PR API 읽기 요청이 `Forbidden`을 반환했다. PR을 생성하지 않았다.

[4단계 기준과 5단계 작업 브랜치 비교](https://github.com/pashkite/phone-remote/compare/feature/galaxy-remote-2-interaction-modes...feature/galaxy-remote-2-ux-branding)

## 28. 다음 단계 진행 여부

**CONDITIONAL GO.** 통합 QA와 사용자의 최종 갤럭시 검증을 진행할 수 있다. 화면 OFF·실제 게임 호환성·종단 지연·자동 복구를 성공으로 표시할 수 있는 상태는 아니다.

권장 검증 순서:

1. [기존 실기기 절차](PANEL-OFF-EXPERIMENT.md)를 읽고 별도 `paneltest` 패키지의 debug 서명을 확인한다. 기존 운영 앱을 삭제하지 않는다.
2. 새 시험 앱을 별도 설치하거나 같은 서명의 기존 시험 앱에 `adb install -r outputs/ux-branding/apk/GalaxyRemote-stage5-arm64-paneltest.apk`로 업데이트한다. 설치는 이번 환경에서 실행하지 않았다.
3. Galaxy 런처 이름/아이콘과 테스트 표식을 확인하고, 검토된 QA 웹 환경에서 로그인·코드 등록·권한·화면 ON 스트리밍부터 검증한다. 현재 운영 웹은 이번 브랜치로 배포되지 않았다.
4. 화면 ON 상태에서 게임/소설/웹툰·키/패드/멀티터치·수동 화질·모드 전환·재연결·입력 해제를 먼저 확인한다. 종단 지연은 실제 입력과 화면을 함께 촬영해 별도로 측정한다.
5. 해당 Galaxy의 실제 패널 display ID와 외부 ON 복구 명령·물리 복구 경로가 실제 동작한 뒤에만 기존 앱의 사전 검사/제한 시간 OFF 시험을 사용한다. 복구가 검증되지 않았으면 OFF를 실행하지 않는다.
6. 짧은 시험 통과 후 5분 이상 게임·프레임·입력과 정상/비정상 복구·Shizuku 중단·재부팅 설정을 기록한다. 중단/실패/미측정은 각각 그대로 기록한다.
7. 운영 앱 서명 비교·업데이트/데이터 유지·아이콘/PWA/브라우저 호환성을 마친 뒤 별도 배포 승인을 진행한다.
