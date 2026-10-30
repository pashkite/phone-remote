# Galaxy Remote 2.0 — 4단계 게임·소설·웹툰 통합 입력

**판정: CONDITIONAL GO — 제한을 명시한 상태로 5단계 UI/UX 완성 작업을 진행할 수 있다.**
실제 Android 게임·독서 앱 호환성, 연속 멀티터치, 하드웨어 게임패드, 화면 OFF는 성공 판정하지 않았다.

## 기준과 GitHub 결과

- 기준 브랜치: `feature/galaxy-remote-2-low-latency`
- 기준 HEAD: `71e94b8ac57231539e5e40a655172c1600478700` 포함 확인 후 새 브랜치 생성.
- 작업 브랜치: `feature/galaxy-remote-2-interaction-modes`
- Android/프로토콜 커밋: `6cb3f7fc8d68a2c5b694a8b228b8acf99abedeb9`
- 통합 UI/입력 커밋: `87d004b614ab5367bcbfcbdb4a67f1c4c7fe6044`
- 개별 포인터 취소 보완 커밋: 41e12db086666b93d1d91000478fb8fbc154eaec
- PR: GitHub API 읽기 요청이 `403 Forbidden`으로 거절되어 생성하지 못했다.
- [기준 기능 브랜치 대상 PR 작성 화면](https://github.com/pashkite/phone-remote/compare/feature/galaxy-remote-2-low-latency...feature/galaxy-remote-2-interaction-modes?expand=1)
  — 실제 생성된 PR 링크가 아니다.

`main`, `master`, 기준 기능 브랜치를 변경하거나 운영 사이트를 배포하지 않았다.
기존 공개 APK·릴리스 서명키·production package·계정 인증·기기 등록 데이터도 변경하지 않았다.
테스트 앱은 기존 `com.galaxyremote.app.paneltest`와 debug 서명을 유지한다.

## 기능별 상태

| 기능 | 상태 | 검증 범위/제한 |
|---|---|---|
| 게임·소설·웹툰 모드 전환 | 구현 완료 및 자동 검증 | 모의 연결의 peer 수 유지, 입력 해제, 자동 스크롤 중지 |
| 공통 입력 엔진·좌표·제한된 MOVE 큐 | 구현 완료 및 자동 검증 | TypeScript·Kotlin 정책 테스트, 실제 Chromium 이벤트 |
| WASD/방향키·대각선·키 유지/해제 | 구현 완료 및 자동 검증 | 실제 키보드 이벤트와 전송 스냅샷, Android 게임 반응은 미검증 |
| 다중 포인터 상태·세션 검증 | 구현 완료 및 자동 검증 | 최대 5개, 순서·좌표·ID·타임아웃 정책 |
| 접근성 연속 멀티터치 실행 | 부분 구현 | 동기화된 continued stroke 시제품. 기기별 임의 포인터 추가·해제 호환성 미검증 |
| 키·마우스·게임패드 매핑 편집 | 구현 완료 및 자동 검증 | 화면 위치 선택, 정규화 좌표, 크기/키/동작 변경·저장 |
| Gamepad API → 터치 | 구현 완료, 실기기 미검증 | 모의 표준 패드의 양 스틱·D-pad·버튼·트리거·숄더 모델 검증 |
| Android 네이티브 게임패드 주입 | 미구현 | Gamepad API 연결이 Android 게임패드 인식이라는 의미가 아님 |
| 소설 페이지/탭/스크롤 탐색 | 구현 완료, 실기기 미검증 | 브라우저/프로토콜 검증. 앱별 실제 페이지 이동은 미검증 |
| 웹툰 휠·자동 스크롤 | 부분 구현 | 제한된 스와이프 반복. 플랫폼의 완전한 연속 스크롤이나 정확한 위치 추적이 아님 |
| 자동 시작/일시정지/재개/중지 | 구현 완료 및 자동 검증 | 명시적 시작, 포커스·회전·오류·모드 전환 때 중지 |
| 확대·맞춤·표시 드래그·전체 화면 | 구현 완료 및 자동 검증 | Chromium 확대/Shift 드래그/전체 화면, 변환·레터박스 좌표 테스트 |
| 로컬 프로필·버전·안전 초기화 | 구현 완료 및 자동 검증 | 개인/공용 분리, 재로드 복원, 모드/기기/계정 namespace |
| 품질 연계 | 구현 완료 및 자동 검증 | 기본 수동 화질 보존. 명시적 적용/선택 시 적용 opt-in. 실제 화질 성능은 미검증 |
| 화면 OFF | 구현 완료, 실기기 미검증 | 2단계 코드 보존. 이번 단계에서 OFF 실행 안 함 |
| 승인된 shell 멀티포인터 백엔드 | 미구현 | 내부 typed PointerBackend 인터페이스만 준비. shell 실행 API 추가 안 함 |

자동 검증은 모델/프로토콜/UI 범위의 결과다. 실제 갤럭시에서 터치가 게임에 전달됐다는 증거가 아니다.

## 공통 입력 구조

```text
Pointer/Keyboard/Wheel/Gamepad 이벤트
  → 모드별 InteractionEngine (상태·키·스틱·자동 스크롤)
  → 정규화 좌표 / 최신 MOVE 병합 / bounded snapshot
  → 기존 authorized ordered WebRTC control channel
  → WebRtcSession의 현재 inputSessionId·v 검사
  → 제한된 RemoteCommandProcessor 큐
  → RemoteAccessibilityService JSON 타입 검사
  → MultiPointerState의 전체 snapshot·순서·범위 검증
  → PointerBackend / MultiPointerController의 GestureDescription 실행
```

기존 클릭·longPress·swipe·단일 LiveTouchController는 유지한다. 기본 게임 프로필에서는
매핑을 끈 상태로 기존 경로를 사용한다. 새 입력은 `multiTouchExperimental` capability와
실제 세션 ID가 있어야 전송된다. 구버전 앱에서도 기본 터치와 독서용 기존 명령은 유지되지만
새 매핑 경로는 지원되지 않는다는 상태를 표시하고 실패한다.

### 수명·안전 제한

- pointerFrame은 현재 control 세션에 한정한다. pointerSeq는 양의 안전 정수·단조 증가이며
  취소 뒤에도 이전 sequence를 재사용할 수 없다. 새 세션에서만 초기화한다.
- 프레임은 현재 포인터 전체와 종료 포인터를 포함한다. 누락·중복 ID·잘못된 phase·
  비수치/비정상 좌표·범위를 벗어난 좌표를 거절한다. ID는 48자 이하 whitelist, 최대 5개.
- Android 상태 변경은 전체 프레임 검증 후 원자적으로 수행한다. 잘못된 프레임은 해제한다.
- 기존 수신 큐 64개/메인 배치 8개를 유지한다. 같은 세션·같은 포인터 집합의 MOVE-only
  프레임만 병합하고 DOWN/UP/CANCEL 경계는 병합하지 않는다.
- 브라우저 MOVE는 최신 위치로 병합하여 최대 32ms 간격에 제출한다. 정지 hold는 약
  200ms heartbeat. MOVE 전송 예산 2KiB, 경계 해제는 64KiB 이내의 별도 여유를 사용한다.
- Android 각 포인터의 마지막 갱신 시각을 추적한다. 약 2초 무갱신이면 해제하며
  250ms 주기로 만료를 확인한다. 브라우저 시간과 Android의 로컬 단조 시계를 혼동하지 않는다.
- 일반 pointercancel은 해당 포인터만 끝낸다. 모드·프로필·세션 종료·회전·blur·숨김·
  설정 창/편집·접근성 오류는 모든 입력과 자동 스크롤을 중지한다.
- 키를 누른 뒤 Ctrl/Alt 등을 누르더라도 keyup 해제를 무시하지 않는다. Alt+R/H/B는
  기존 전역 단축키를 유지하고 실행 전 held 입력을 해제한다.
- 설정 입력창·버튼에서는 게임 입력과 게임패드 polling을 실행하지 않는다. 화면 입력
  영역을 명시적으로 활성화한 동안만 polling한다. 자동 스크롤 상태는 저장/자동 재개하지 않는다.

### 접근성 멀티터치의 정확한 한계

진행 중인 stroke와 새 stroke를 하나의 GestureDescription에 넣고 24ms 구간을 함께
제출한다. 기존 stroke는 continueStroke의 끝점을 잇고, 새 포인터는 새 StrokeDescription,
종료 포인터는 willContinue=false로 끝낸다. 다음 구간은 이전 callback 완료 후 제출한다.

이것은 shell MotionEvent/네이티브 게임패드 주입이 아니다. Android/OEM이 연속 stroke
중 포인터 추가·종료 조합을 모두 허용한다고 가정하지 않는다. dispatchGesture가 취소·거절하면
상태를 정리하고 inputError를 전송한다. CANCEL 프로토콜은 안전한 stroke 종료로 구현되며,
특정 포인터에 raw ACTION_CANCEL을 정확하게 주입하는 기능이 아니다. 실제 UP/CANCEL,
다중 손가락 전환, 게임 반응은 실기기에서 확인해야 한다.

## 게임 모드

- WASD/방향키로 정규화 조이스틱을 유지하고 대각선을 정규화한다. 키 반복으로 DOWN을
  다시 만들지 않는다. 중심/반경과 아날로그 감도는 프로필별이다.
- 버튼은 hold, 70ms tap, 650ms longPress. hold는 keyup에 종료하며, 일회성 tap/longPress는
  해당 제한 시간에 종료한다. 포커스·세션 취소는 시간에 관계없이 해제한다.
- 화면 클릭으로 위치 선택, 키 할당, Mouse0~4, Pad0~16, 버튼 크기, 이동/시점 스틱 중심과
  반경, 편집/플레이 분리, 활성화/비활성화, 새 프로필·이름·불러오기·초기화를 제공한다.
- WASD/방향키는 이동용 예약 키다. 버튼 키와 중복하는 매핑은 저장 시 정리한다.
- 표준 Gamepad API 왼쪽 스틱/기본 D-pad는 이동, 선택한 오른쪽 스틱은 시점 터치,
  A/B/X/Y·숄더·트리거는 설정한 Pad 버튼 터치로 변환한다. D-pad도 버튼으로 별도 매핑하면
  이동 대신 그 버튼을 실행한다. 비표준 mapping은 거절하고 연결/해제·deadzone을 처리한다.
- 기본 동시 포인터 1개. 사용자가 실험을 활성화하면 5개까지 허용한다. 멀티터치 실험을
  끈 상태의 이동+공격/두 스틱 동시 입력은 제한된다. Android 게임이 네이티브 패드를
  인식한다고 표시하지 않는다. 앱 패키지/화면 내용 자동 수집이나 게임 자동 감지는 없다.

## 소설·웹툰 모드

- 세로 swipe, 좌우 페이지 swipe, 좌우 tap을 사용자 프로필에서 선택한다.
- Page Up/Down·방향키·Space 및 사용자 다음/이전 키. 좌우 클릭 영역과 반전 방향 설정.
- 휠은 pixel/line/page 단위를 정규화하여 최대 2,000px만 누적한다. 거리·감도가 실제
  swipe 길이에 반영되고, 한 번 실행 뒤 누적을 비운다. 명령 간 최소 300ms로 폭주를 제한한다.
- 자동 스크롤은 사용자가 시작해야 하며 속도/방향/단축키(기본 P), 일시정지·재개·중지를
  제공한다. 설정 범위에서 약 0.5~15초 주기로 제한된 220ms swipe를 생성한다.
- 수동 터치/휠, 모드 전환, 회전, blur, 숨김, 연결·입력 오류는 즉시 **추가 생성**을 중지한다.
  이미 Android에 전달된 220ms 제스처나 앱의 관성 스크롤까지 즉시 취소/정지한다고 보장하지
  않는다. phantom tap으로 취소하는 우회 동작은 하지 않는다.
- 속도/탐색 설정 편집 시 안전하게 중지하고 필요하면 사용자가 다시 시작한다.
- 원본 화면 비율 유지, 중앙 정렬, 맞춤, 50~300% 표시 확대, 확대 후 Shift 드래그 이동,
  전체 화면, 선택형 도구/커서 숨김을 제공한다. 영상의 실제 변환된 사각형을 좌표 계산에 쓴다.
- 브라우저 확대는 수신 영상 표시 크기만 바꾼다. 원본 해상도나 앱 글꼴·줄 간격을 개선하는
  기능이 아니다. 긴 웹툰 전체를 받아 오는 기능도 아니다. 정확한 앱 페이지·스크롤 위치는
  읽거나 저장하지 않는다. 완전한 연속 스크롤의 감각과 앱 호환성은 아직 미검증이다.

## 품질·프로필·보안

3단계 자동 품질, codec fallback, 통계, 열 보호와 MediaProjection 경로를 유지한다.
게임은 저지연/가능한 60fps, 소설·웹툰은 선명도/30fps를 권장하지만 현재 수동 선택을
임의로 덮어쓰지 않는다. 프로필 화질은 직접 적용하거나, 사용자가 선택 시 적용을 명시적으로
활성화했을 때만 사용한다. 자동 모드는 기존 1080p/30 기준선으로 시작한다.

설정 스키마 v1은 계정·기기 namespace, 모드별 selected ID와 수동 게임 프로필을 저장한다.
최대 12개 프로필·각 32개 매핑·64KiB 입력, 모드별 기본 프로필 보충, 좌표/크기 clamp,
중복 ID/키 정리, 알 수 없는 버전/손상 JSON의 안전한 기본값 복구를 제공한다.

개인 PC에서만 localStorage에 저장한다. 공용 PC는 메모리에서만 사용한다. 기존 개인 PC
저장을 사용자 지시 없이 지우지는 않는다. 초기화 버튼으로 현재 계정/기기의 조작 설정을
초기화할 수 있다. 저장되는 것은 이름·좌표·키·감도·화질 등 설정뿐이며 인증 토큰, SDP,
inputSessionId, 콘텐츠·영상은 저장하지 않는다. 기존 opacity/테마 설정 키도 유지한다.
기본 테마는 dark, 사용자가 저장한 light/dark는 존중한다.

보안 화면/FLAG_SECURE/전자책·웹툰 DRM 우회, 임의 shell 명령, 콘텐츠 서버 저장,
자동 다운로드·자동 녹화는 추가하지 않았다. 기존 사용자 시작 녹화 기능은 유지했다.
패널 OFF 파일/AIDL·서명·패키지 설정·로그인·기기 API·공개 다운로드는 변경하지 않았다.

## 자동화·빌드 결과

| 검사 | 결과 |
|---|---|
| Node 웹 테스트 | 73개 통과, 실패/스킵 0 |
| Android debug 단위 테스트 | 15개 통과, 실패/오류/스킵 0 |
| Android panelTest 단위 테스트 | 동일 정책 15개 통과, 실패/오류/스킵 0 |
| Python 안전/측정 도구 테스트 | 6개 통과 |
| 전체 ESLint / TypeScript / Vite / Worker 산출물 | 통과 |
| panelTest arm64 / debug / unsigned release APK | 빌드 통과 |
| instrumentation APK | 빌드 통과, 실행은 미검증 |
| 실제 Chromium 모드/입력/저장 시나리오 | 통과 (모의 WebRTC·패드·콘텐츠) |
| 실제 Android 터치·패드·앱별 스크롤·화면 OFF | 미검증 |

Chromium 검증: peer 수·수동 화질 유지, WASD 대각선, 이동+공격 snapshot, 개별 pointercancel,
수정키 상태 keyup, 편집 격리, 패드→터치/포커스 해제, 독서 키, 자동 시작/일시정지/재개/중지,
회전·권한 오류 중지, 확대/Shift 이동/맞춤/전체 화면, 공용 저장 없음과 개인 저장·재로드 복원.
이는 실제 갤럭시나 실제 하드웨어 게임패드 검증이 아니다.

Kotlin 테스트는 다중 상태·순서·좌표·중복/누락 ID·최대 수·타임아웃·세션 초기화 정책을
검사한다. 기존 단일 클릭/드래그/geometry/단축키/HTML 권한 및 3단계 스트리밍 테스트를
유지했다. opacity source assertion은 기존 opacity와 새 zoom transform의 병존을 반영했다.
기존 Android 16 LiveTouchTest는 변경·비활성화하지 않았다. 서비스 억제와 probe-window 관련
실패는 별도 추적이며, API 403으로 원본 Actions 결과를 재조회하지 못했다. 해결됐다고
보고하지 않는다. 현재 adb 장치가 없고 /dev/kvm도 없어 instrumentation은 실행하지 않았다.

### 재현

```sh
bash scripts/sites-env.sh -- bash scripts/install-ci.sh
npm run lint
bash scripts/test-web-streaming.sh

cd android-client
gradle :app:testDebugUnitTest :app:testPanelTestUnitTest \
  :app:assemblePanelTest :app:assembleDebug :app:assembleRelease \
  :app:assembleDebugAndroidTest --max-workers=3
```

브라우저 테스트는 로컬 dev 서버만 허용한다. 예시:

```sh
# 별도 터미널: bash scripts/sites-env.sh -- npm run dev -- --port 5175
# playwright 설치 위치와 Chromium 실행 경로를 실제 환경에 맞춘다.
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
CHROMIUM_EXECUTABLE=/path/to/chromium \
node scripts/test-interaction-browser.mjs
```

새 browser-interactions CI job은 외부 임시 디렉터리에 Playwright 1.56.1을 설치하여 모의
테스트를 실행한다. PR/수동 실행용이며 배포하지 않는다. GitHub Actions 실행 결과가 아니라
현재 환경에서 실제 수행한 검증 결과를 위 표에 기록했다.

### 테스트 산출물

- APK: `outputs/interaction-modes/GalaxyRemote-stage4-arm64-paneltest.apk`
- package: `com.galaxyremote.app.paneltest`, versionCode 17, arm64-v8a, debug 서명.
- SHA-256: `a7cc4ef2e03d5ec9452d71daebacb079042b8196b415b95b9c7c52091363fa68`
- v2 서명 및 16KiB ZIP 정렬 검사 통과. 기기 설치/전체 native ELF 호환성의 증거는 아니다.
- 모의 브라우저 화면: `outputs/interaction-modes/webtoon-view.png` (실제 휴대폰 콘텐츠가 아님).
- 위 파일은 ignored 로컬 산출물이며 운영 다운로드로 게시하지 않았다.

## 실기기 통합 검증 체크리스트·남은 기술 부채

- [ ] Android 15/16·One UI별 별도 테스트 앱 설치와 기존 앱/기기 등록 보존.
- [ ] 실제 동시 이동+공격, 두 버튼, 두 스틱, 포인터 추가·해제·CANCEL·hold.
- [ ] touchability·view insets·회전·전체 화면·확대 좌표의 실제 일치.
- [ ] 패드 종류별 deadzone/버튼/트리거·해제·브라우저 보호 정책.
- [ ] 접근성 비활성화·프로세스 종료·네트워크 손실의 실제 입력 해제.
- [ ] 소설 앱의 세로/가로/탭 탐색·웹툰 스크롤 관성·속도·DRM 지원 제한.
- [ ] 3단계 FPS·발열·인코더·종단 지연 목표를 실제 측정. 이번 단계에서 성능 달성 주장 없음.
- [ ] 외부 복구를 검증한 뒤에만 패널 OFF 시험. 영상/입력 유지와 비정상 복구는 미검증.

연속 멀티터치 보장은 불가하며 지원되지 않는 조합은 안전하게 취소한다. 안정적인 raw
멀티포인터가 필요하면 별도 승인형 shell 백엔드 구현·검증이 다음 기술 과제다.
스크롤은 세그먼트 기반이라 앱별 관성·정확한 페이지·진행률과 무중단 연속 스크롤을
보장하지 않는다. 오른쪽 스틱 시점 제어도 게임에 따라 상대 이동/재센터링 정책이 추가로
필요할 수 있다. 중복 키 편집은 저장 시 정리되므로 최종 매핑 편집 UX 보강이 필요하다.
현재 실용 UI는 기능 검증용이며 패널/단축키 접근성·오류 문구·작은 화면 레이아웃 등은
5단계에서 다듬을 수 있다. 이 제한 때문에 5단계를 막지는 않는다.

## 변경 파일

- `.github/workflows/web-streaming-tests.yml`
- `android-client/app/src/main/java/com/galaxyremote/app/RemoteAccessibilityService.kt`
- `android-client/app/src/main/java/com/galaxyremote/app/RemoteCommandProcessor.kt`
- `android-client/app/src/main/java/com/galaxyremote/app/RemoteControlService.kt`
- `android-client/app/src/main/java/com/galaxyremote/app/WebRtcSession.kt`
- `android-client/app/src/main/java/com/galaxyremote/app/interaction/MultiPointerController.kt`
- `android-client/app/src/main/java/com/galaxyremote/app/interaction/MultiPointerState.kt`
- `android-client/app/src/main/java/com/galaxyremote/app/interaction/PointerBackend.kt`
- `android-client/app/src/test/java/com/galaxyremote/app/interaction/MultiPointerStateTest.kt`
- `app/components/interaction-controls.tsx`
- `app/components/interaction-overlay.tsx`
- `app/components/theme-toggle.tsx`
- `app/globals.css`
- `app/remote-console.tsx`
- `lib/interaction/engine.ts`
- `lib/interaction/profiles.ts`
- `lib/interaction/use-interaction.ts`
- `lib/remote/client.ts`
- `scripts/test-interaction-browser.mjs`
- `tests/interaction-modes.test.mjs`
- `tests/remote-console-source.test.mjs`
- `tests/remote-protocol.test.mjs`
- `docs/INTERACTION-MODES-STAGE4.md`
