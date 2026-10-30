# Galaxy Remote 2.0 — 6단계 통합 QA·안정화

2026-10-30 (한국 시간). **최종 판정: CONDITIONAL GO.** 자동화 범위의 주요 결함을 수정했고 7단계 실기기 검증 자료를 준비했다. 실제 Galaxy, 운영 인증, 네이티브 네트워크 전송과 패널 복구의 성공 판정은 아니다.

## 1. 범위와 기준

- 기준: `feature/galaxy-remote-2-ux-branding` / `4081a0c6019b650d987c340abef5f80be5774f6d`.
- 작업: `feature/galaxy-remote-2-integration-qa`.
- 인증/기기/세션 API, WebRTC 수명·재연결, 입력/스크롤/저장/브랜딩, Android 캡처/접근성/패널 안전성, 빌드/CI/전달 경로를 감사했다.
- 실제 코드 수정·새 회귀·실제 브라우저·로컬 Miniflare D1·빌드를 수행했다. 운영 사이트·DB·기존 공개 APK·main/master/기준 브랜치는 수정하지 않았다.
- 브랜드는 Galaxy Remote 2.0을 유지했다. 별도 검토된 **Linro와의 최종 결정은 릴리스 확인 사항**이며 이번 QA에서 이름·아이콘을 다시 변경하지 않았다.

## 2. 실제 실행 환경과 증거의 경계

Node 24.19.0, 실제 `/usr/bin/chromium` + Playwright, JDK17, Gradle8.11.1, SDK/platform/build-tools35를 사용했다. 연결된 ADB 기기, Android emulator, KVM, Firefox, WebKit 엔진은 없었다.

API 통합은 **실제 라우트 핸들러·Drizzle·마이그레이션·로컬 Miniflare D1**을 실행했다. `next/headers`와 `cloudflare:workers`의 바인딩만 테스트 컨텍스트로 공급했다. Sites 인증 헤더는 통제된 fixture이며 실제 OAuth/cookie/edge 신뢰 경계를 검증한 것은 아니다. 운영 DB에는 접근하지 않았다.

브라우저 앱 시험의 휴대폰·패드·시그널링 API는 fixture다. 별도 네이티브 WebRTC 시험은 모의 Peer를 사용하지 않았으나 실행 환경 정책으로 연결되지 않았다. 두 종류의 결과를 합산해 실제 영상 전송 성공으로 표시하지 않는다.

## 3. 전체 구조 감사

| 영역 | 근거 파일 | 감사/검증 결과 |
|---|---|---|
| 소유자 인증 | `app/chatgpt-auth.ts`, `lib/server.ts` | 기존 owner allowlist 유지; 기기 토큰에도 현재 소유자 정책 적용 |
| 등록·폐기 | `app/api/pairing/*`, `devices/*` | 1회 코드·만료·동시 제한·해제·토큰 비노출을 로컬 D1 검증 |
| 세션·SDP·ICE | `app/api/sessions/*`, `device/*` | 소유권/상태/만료와 CAS 결과 검사 보강 |
| 웹 연결 수명 | `app/remote-console.tsx`, `connection-scope.ts` | 취소·늦은 응답·기기 전환·401·시간 제한·pagehide 정리 |
| 캡처/코덱 | `WebRtcSession.kt`, `streaming/CaptureEngine.kt` | MediaProjection 교체 가능 인터페이스 유지, 새 캡처 엔진 가정 없음 |
| Android 비동기 | `RemoteControlService.kt`, `WebRtcSession.kt` | 이전 session/peer 콜백 차단, 이전 lease/peer 정리 보강 |
| 접근성·입력 | `RemoteCommandProcessor.kt`, `LiveTouchController.kt`, `interaction/*` | bounded queue·시퀀스·세션·watchdog·해제 정책 검사 |
| 패널 | `display/*`, AIDL | 고정 display 0·UID2000·사용자 동의·복구 게이트 유지; 실행 안 함 |
| 프로필/UI | `lib/interaction/*`, `app/components/*` | 기존 v1 저장값·공용 PC·quota·손상·초점·모드 유지 회귀 |
| 미디어/파일/로그 | `lib/remote/*`, Android 대응 클래스 | 종료 클라이언트 차단, 파일 승인/무결성·진단 비밀값 제외 회귀 |
| 메타데이터/아이콘 | `app/layout.tsx`, `public/brand`, Android res | 기존 생성 자산·manifest·MIME·XML·리소스 컴파일 검증 |
| 배포 | `.github/workflows/*`, `qa-artifacts/stage6` | CI 증거/7일 APK 전달, 새 QA 파일만 추가; 운영 배포 없음 |

캡처는 명시적으로 준비된 Android 대기 모드에서 idle 유지될 수 있다. Peer 종료와 MediaProjection 전체 종료는 같은 동작이 아니다. 일반 서비스 종료/Projection stop의 release 경로는 유지했다. Android native 수명·스레드·접근성 실제 동작은 컴파일/정적 감사만으로 확정하지 않는다.

## 4. 신규 결함·심각도·수정

P0=데이터 손실/계정 침해/기기 제어 안전, P1=핵심 연결·입력/권한, P2=부분 기능, P3=표시로 분류했다. 아래 실행 재현과 정적 발견을 구분한다.

| ID | 심각도 | 수정 전 재현/영향 | 수정과 근거 |
|---|---|---|---|
| Q1 | P1 | 세션 POST 응답을 지연하고 종료한 뒤 응답을 돌려주면 Peer가 새로 만들어짐 | ConnectionScope 취소·각 await 뒤 유효성 확인·요청/협상 제한. 브라우저 결과 1 peer→0 |
| Q2 | P1 | 연결 중 기기를 바꿔도 이전 기기 Peer/입력이 남을 수 있음 | 선택 시 이전 연결/포인터 해제, 목록에서 사라진 연결 기기 정리. 실제 UI 회귀 |
| Q3 | P1 | 기기 목록 401 후에도 기존 연결/제어가 남음 | 401에서 로컬 연결 취소·기기 목록 제거·오류. 실제 UI 회귀 |
| Q4 | P1 | 다른 소유자 session DELETE가 상태는 바꾸지 않지만 그 세션 ICE 후보를 삭제 | 소유자 조건 update의 returning 성공 후에만 ICE 정리. D1 회귀로 외부 후보 보존 |
| Q5 | P1 | 25개 동시 잘못된 코드 요청이 20회 제한을 우회 (429=0) | 원자적 SQLite UPSERT 증가/윈도 복귀. 수정 후 429=5, 다음 윈도 1부터 재시작 |
| Q6 | P1 | configured owner 변경 후 이전 소유자의 기기 토큰이 lease/heartbeat를 계속 사용 (200) | 공통 기기 인증에서 현재 owner 정책 확인. 수정 후 401 |
| Q7 | P1 | close 이후 retained client가 명령을 보내고 늦은 capabilities로 채널을 다시 생성 | closed gate·콜백 분리·확장 채널/리스너 정리. 명령·늦은 이벤트·오디오 startup 회귀 |
| Q8 | P2 | 숫자 code/object candidate/sessionId의 문자열 메서드에서 TypeError | 실제 타입 확인 후 처리, 잘못된 요청 4xx. D1 핸들러 회귀 |
| Q9 | P2 | 닫힌 세션의 opened/reject 요청에도 성공 상태 반환 | 허용 상태/decision·만료·CAS returning 확인, 409/410 회귀 |
| Q10 | P1 정적 | Android 새 요청과 이전 SDP/API 콜백·lease가 섞여 새 세션을 종료하거나 이전 권한이 남을 가능성 | 기존 session/peer ID 확인·volatile 공개·기존 lease/peer 종료. 빌드 통과, 실제 경합 재현은 미검증 |
| Q11 | P1 정적 | native DISCONNECTED가 FAILED가 될 때까지 패널 복구/입력 해제 요청이 지연될 가능성 | 일시 단절에서도 DisplayControl false/stopTouch 요청. 실제 복구 미검증 |
| Q12 | P2 | 저장소 차단·응답 없는 DELETE가 사용 종료 진행을 막을 수 있음 | 로그아웃 저장소 예외 격리·DELETE 3초 상한; HTTP helper 취소/시간 제한 회귀 |

기준 스냅샷/수정 전 실패와 수정 후 결과는 [증거 폴더](assets/stage6)에 보관했다. 보안 문제는 localhost와 테스트 데이터로만 재현했다. 실제 사용자 계정/기기에 공격하지 않았다. 이번 범위에서 재현한 P0는 없으며, 자동화에서 재현한 위 권한/연결 결함은 수정했다. Android 실제 안전 동작까지 해결됐다고 선언하지 않는다.

## 5. 계정·기기·보안 통합 결과

`tests/api-integration.test.mjs`의 7개 테스트가 실제 핸들러와 로컬 D1을 검증한다.

- 인증 없음/허용되지 않은 계정 거절, 다른 소유자 기기·세션 조회/삭제/ICE 생성 거절.
- 새 코드, 동시 코드 소비 1개만 성공, 재사용/만료/새 코드로 교체된 이전 코드 거절.
- 등록→세션→offer→opened→approve→answer→각 방향 ICE→lease→종료→등록 해제.
- offer/answer 재생 거절, expired negotiation 접근 거절, 폐기 토큰 거절, 목록에 token/hash 비노출.
- 초기 SDP 만료와 **이미 연결된 세션 lease는 별개**다. 연결 중에는 협상 60초를 넘어서도 기기 lease를 확인하고, closed/기기 폐기/owner 변경은 거절한다.
- 등록 시도 원자적 제한과 10분 윈도 복귀.

Sites 최초 로그인·cookie 갱신/만료·edge 헤더 위조 차단·운영 계정 전환은 **미검증**이다. 단일 OWNER_EMAIL 정책을 공개 다중 사용자 서비스로 확장하지 않았다. 브라우저 401은 로컬 연결을 즉시 정리하지만 P2P의 외부 세션 강제 종료는 플랫폼/기기 감시까지 실제 검증해야 한다. 별도 원격 logout/revocation push 시스템을 구현했다고 주장하지 않는다.

## 6. WebRTC 안정성 결과

연결 준비는 하나의 scope가 네트워크·비동기 작업을 소유한다. 종료/기기 변경/401/unmount/pagehide에서 취소한다. 네트워크 요청은 기본 15초, 정리 DELETE는 3초, 협상 전체는 65초 상한이다. 늦은 응답으로 Peer를 생성하거나 새 세션을 덮지 않는다. 닫힌 RemoteClient는 후속 제어/확장 채널 생성을 차단한다.

기존 VP8 기본·선택 H.264/VP8 fallback·720/1080/1440·24/30/60 요청·기기 안전 제한·자동 품질 정책을 유지했다. 통계/정지 감지/fallback은 기존 단위 테스트를 포함해 통과했다. 브라우저에 RTT 300ms·손실 10%를 **주입**했을 때 자동은 720p로 낮추고 수동 1440p는 유지했다. 시그널링 중단은 오류로 종료·Peer 정리됐다. 이것은 실제 패킷 손실을 가한 Android 영상 측정이 아니다.

### 별도 네이티브 WebRTC 시험: BLOCKED

`scripts/test-webrtc-loopback-browser.mjs`는 실제 Chromium Peer 2개, canvas track, SDP/ICE, DataChannel echo, VP8/H.264, 송신 제한/정리를 시험한다. 이 환경에서는 VP8 ICE/Peer가 `new`, 수집은 complete, 영상 0 상태로 timeout 실패했다.

관리 정책 `/etc/chromium/policies/managed/misc.json`의 `WebRtcIPHandling=disable_non_proxied_udp`가 확인됐다. 프록시 없는 로컬 ICE 전송을 할 수 없는 환경이다. 정책/프록시를 변경하거나 우회하지 않았다. **VP8/H.264 native 전송 통과로 계산하지 않는다.** 네이티브 시험 스크립트는 실패를 그대로 반환하며 CI에도 연결했다. 일반 개발 PC/허용된 CI에서 재실행해야 한다. 실제 오디오, TURN/NAT, 첫 Android 프레임, 종단 지연·60fps는 미검증이다.

## 7. 게임 입력 검증

기존 클릭/길게 누르기/드래그·geometry·단축키·멀티 snapshot·시퀀스·세션/타임아웃·대기열 테스트를 유지했다. 실제 브라우저에서 WASD 대각선/이동+공격·개별 pointercancel·수정키 keyup·매핑 편집 격리·확대/회전·가상 패드 제거·설정/모드/연결/포커스 해제를 확인했다.

1000개 pointermove를 주입해 bounded snapshot으로 합쳐지고 마지막 up/cancel이 나오는지 확인했다. Android 큐의 10,000 MOVE coalescing과 단일/다중 포인터의 stale sequence/세션 경계는 기존 JVM 테스트를 재실행했다.

실제 MotionEvent 순서·게임별 접근성·연속 멀티터치·하드웨어 게임패드의 결과는 **미검증**이다. 브라우저의 전송/해제 요청을 실제 게임의 포인터 해제로 단정하지 않는다.

## 8. 소설·웹툰·장시간 시험

휠/페이지/탭·반전·속도·자동 시작/정지/일시정지/재개·저장·확대/팬/맞춤/전체화면·회전 회귀가 통과했다.

실제 벽시계 **300초** 동안 모의 연결에서 자동 스크롤을 실행했다. 관측 시간 304,059ms, 스와이프 100개였다. 통제된 document hidden 이벤트 뒤 추가 생성은 없었고, 다시 시작 후 Peer disconnected 이벤트 뒤 추가 생성도 없었다. [reading-soak.json](assets/stage6/reading-soak.json).

실제 Android 소설/웹툰 앱, 실제 탭/OS 백그라운드 정책, DRM은 미검증이다. hidden/네트워크 조건은 fixture 이벤트임을 구분한다. 최종 소스에서도 짧은 soak와 연결 100회 전체 스크립트를 다시 통과했다. 300초 결과와 짧은 재회귀 결과를 혼합하지 않았다.

## 9. 100회 연결과 리소스 관측

모의 WebRTC 연결/해제를 100회 반복했고 모드 전환도 함께 수행했다. 매 종료에서 활성 모의 Peer=0, track ended를 확인했다. 10회 이후와 100회 이후를 GC 후 비교했다.

| 항목 | 10회 뒤 | 100회 뒤 |
|---|---:|---:|
| 문서 | 2 | 2 |
| DOM 노드 | 1224 | 1224 |
| JS 리스너 | 274 | 274 |
| 주기 타이머 | 3 | 3 |
| JS heap used bytes | 7,912,756 | 9,092,112 |

[cycle-resources.json](assets/stage6/cycle-resources.json). 타이머/DOM/리스너 증가를 관찰하지 않았으나 heap은 약 1.18MB 증가했다. 이 표본으로 메모리 누수가 없다고 단정하지 않는다. 실제 native Peer·장시간 Android 메모리·앱 재시작 반복은 별도 QA다. UI 연결 반복과 실제 100회 ICE 연결은 다르다.

## 10. UI/UX·브랜딩

기존 두 브라우저 스크립트를 재실행했다. Chromium에서 1920×1080/1440×900/1280×720/1024×768/390×844 각각 게임/소설/웹툰, 라이트 테마, 로그인 안내/등록/승인/통계/설정/종료·재연결·오류, 키보드 focus/Escape/reduced motion/overflow를 확인했다.

기존 v1 fixture·개인/공용 전환·quota 실패·손상 원본 보존, 파비콘 응답/MIME/실제 이미지 디코딩·manifest·메타데이터·Android XML·launcher 이름/패키지를 확인했다. 실제 모바일 설치·북마크/홈 화면·PWA 설치 가능성은 미검증이다. 새 브랜딩을 추가하지 않았다.

대표 캡처: [1920 게임](assets/stage6/06-1920x1080-game-dark.png), [390 웹툰](assets/stage6/06-390x844-webtoon-dark.png), [라이트](assets/stage6/07-light-1440.png). 모두 로컬 UI와 모의 휴대폰이다. Firefox/WebKit은 제공되지 않아 미검증이다.

## 11. Android 16 LiveTouchTest 조사

기존 문서의 UiAutomation 서비스 억제/그 이후 probe-window 문제를 재검토했다. 현재 코드에는 `FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES`가 있다. 실제 기존 Actions 로그는 API Forbidden으로 가져오지 못했고 장치/emulator/KVM이 없어 새 실행으로 원인을 확정하지 못했다.

테스트의 **기존 assertion과 15초 상한을 유지**했다. debug probe에 run ID·created/resumed/paused·focus 정보를 기록하고, 매 시험의 run/lifecycle/focus를 확인하도록 강화했다. clear-top으로 기존 Activity 재사용 문제를 피하고 실패 메시지에 접근성 연결·probe 상태/이벤트 카운트를 남긴다. timeout을 늘리거나 실패를 스킵하지 않았다.

instrumentation APK는 컴파일 통과했지만 실행은 **미검증/원인 미확정**이다. CI에서 JUnit/logcat/activity/accessibility/input을 함께 업로드하도록 보강했다. [실기기 절차](DEVICE-QA-RUNBOOK.md)의 재현 명령으로 접근성 연결→probe focus→DOWN/MOVE/UP→callback/timeout을 대조해야 한다. 이 변경이 실제 Android 16 드래그 문제를 해결했다는 판정은 하지 않는다.

## 12. 화면 OFF 안전성 감사

**이번 단계에서 실제 OFF 명령은 실행하지 않았다.** 다음은 정적 코드·JVM/Python 정책 검사다.

| 항목 | 확인한 구현/한계 |
|---|---|
| 권한/사용자 동의 | local Shizuku 승인, shell UID2000, panelTest gate, 로컬 확인과 알림 |
| 세션/표시 제한 | active WebRTC 필요, 기본 release/debug 비활성, fixed display 0 |
| 사전 검사 | 지원 명령 탐지 + ON 복구 명령 검사 + 별도 외부 복구 attestation |
| 시험 한계 | UI 30/330초, backend 10..330초 bound, one-shot 승인 소비 |
| heartbeat | shell 8초 누락 복구, 앱 1초 감시·연결/권한/기한 확인 |
| Binder 종료 | linkToDeath 복구 요청 |
| 종료/오류 | 정상 종료·Projection stop·Shizuku 중단·native 일시 단절 시 복구/입력 해제 요청 |
| 타이머 | shell scheduled restore와 독립 고정-command 자식 fallback |
| 미검증 | 실제 패널 매핑·명령 효과·fallback 자식 생존·강제 종료/재부팅 복구 |

`PanelLeaseTest`에 30/330초 모두 새 동의를 소비하는 검사를 추가했다. 패널 모듈/AIDL의 권한/안전 게이트나 명령 API를 완화하지 않았다. 웹 임의 shell API도 추가하지 않았다. ON 상태 반환값은 실제 OFF 후 복구 증거가 아니다. 복구 자격이 없으면 OFF는 BLOCKED이며 다른 개발/QA를 계속한다.

## 13. 최종 자동화·빌드 결과

| 검사 | 결과 |
|---|---|
| 전체 ESLint | 통과, 오류/경고 0 |
| TypeScript | 통과 |
| production 웹/Worker 산출물 | 통과 |
| Node 웹/실제 API 로컬 D1 | **92 통과**, 실패/스킵 0 (기존 80 + API7 + scope3 + client2) |
| Python | **6 통과** |
| Android debug JVM | **16 통과**, 실패/오류/스킵 0 |
| Android panelTest JVM | **16 통과**, 실패/오류/스킵 0 |
| 기존 interaction 브라우저 | 통과 |
| 기존 UX/브랜드 브라우저 | 11개 그룹 통과 |
| 신규 수명/100회/soak 브라우저 | 5개 그룹 통과 |
| 신규 손실/폭주/중단 브라우저 | 3개 그룹 통과 |
| 별도 native loopback 브라우저 | **BLOCKED: 관리 UDP 정책 환경에서 timeout**, 통과 아님 |
| panelTest arm64 / debug x86_64 / unsigned release arm64 | 빌드 통과 |
| instrumentation APK | 빌드 통과, 실행 미검증 |
| 실제 Galaxy/운영 OAuth/TURN·오디오/종단 지연/OFF | 미검증 |

증거는 [web.log](assets/stage6/web.log), [lint.log](assets/stage6/lint.log), 브라우저별 log와 [apk-build.json](assets/stage6/apk-build.json)에 있다. 수정 전 실패 로그도 보존했다. 실패를 비활성화하거나 성공으로 바꾸지 않았다.

재실행:

```bash
bash scripts/sites-env.sh -- npm run lint
bash scripts/test-web-streaming.sh
# 로컬 서버를 별도 터미널에서 실행
bash scripts/sites-env.sh -- npm run dev -- --port 5175
# Playwright/Chromium 경로는 각 실행 환경에 맞게 설정
node scripts/test-interaction-browser.mjs
node scripts/test-ux-branding-browser.mjs
QA_SOAK_SECONDS=300 node scripts/test-integration-browser.mjs
node scripts/test-network-browser.mjs
node scripts/test-webrtc-loopback-browser.mjs
```

브라우저 스크립트는 `PLAYWRIGHT_MODULE`/`CHROMIUM_EXECUTABLE`을 지원한다. native 스크립트는 정책을 우회하지 않으며 이 환경에서는 계속 실패한다. 다른 엔진을 시험한 것으로 계산하지 않는다.

## 14. APK와 전달 경로

GitHub 브랜치의 [시험 APK](../qa-artifacts/stage6/GalaxyRemote-2.0-stage6-arm64-paneltest.apk), [서명/용도 안내](../qa-artifacts/stage6/README.md), [hash](../qa-artifacts/stage6/SHA256SUMS.txt)를 제공한다. 사용자가 `/workspace`에 접근할 필요 없이 저장소에서 Download raw file로 받는다. 약 16.3MB 시험 바이너리만 새 QA 디렉터리에 추가했다.

- `com.galaxyremote.app.paneltest`, Galaxy Remote 2.0 Test, arm64-v8a, 기존 debug 서명.
- APK Signature v2와 16KiB ZIP 정렬 검사 통과. 전체 native ELF/설치/실기기 호환성의 증거는 아니다.
- 인증서 SHA-256 `8f568dd3778c9b0f8a316427c1a2e048a2f454f153a9b6d40dd3e4337dd0748f`는 4/5단계 시험 APK와 동일하다.
- release는 **unsigned**다. 운영 키를 생성/변경하지 않았으며 운영 업데이트 호환성은 미검증이다.
- 기존 IDs·versionCode17·versionName0.5.3·사용자 저장값·signaling URL을 유지했다. 실제 테스트 APK 설치 성공/데이터 유지는 사용자가 확인해야 한다.

새 QA 웹은 미배포다. **앱 URL과 검토된 QA 웹 origin 정합성은 7단계 전 필수 조건**이다. 기존 운영 웹을 사용하면 새 웹 코드 전체 시험이 되지 않는다. 이를 해결하려고 이번 QA에서 인증/HTTPS/domain allowlist를 우회하지 않았다.

## 15. GitHub Actions 결과와 개선

로컬 성공과 원격 CI 성공을 분리한다. Actions API 읽기와 PR API 읽기가 모두 `Forbidden`이었다. 새 Actions run을 실행/성공 확인하지 않았으며 PR도 생성하지 않았다.

웹 workflow는 기존 테스트 + 새 D1/API/수명 테스트, 300초 soak/폭주/네이티브 스크립트를 PR/수동 실행에 연결했다. 실패 로그/JSON/캡처/dev log를 7일 보관한다. 네이티브 스크립트 실패는 CI 실패로 남는다.

Android workflow는 instrumentation APK 컴파일, JVM 결과 always 업로드, 기존 emulator 실패 종료 코드 유지, activity/accessibility/input 로그를 추가했다. APK 아티팩트 `galaxy-remote-apk-build`의 panelTest/debug/unsigned release/instrumentation/AAB와 signing tools를 **7일** 보관한다. Android16 보고서는 `galaxy-remote-android16-test-reports`, JVM은 `galaxy-remote-unit-test-reports`다. 실패 전에 만들어진 APK가 있더라도 테스트 통과로 간주하지 않는다. 매 CI runner의 debug 서명 차이에 유의한다.

## 16. 실기기 패키지·잔여 한계

[Windows·Galaxy runbook](DEVICE-QA-RUNBOOK.md) 20단계와 [기록 양식](DEVICE-QA-RESULTS-TEMPLATE.md)을 제공한다. ADB/설치/권한/계정·화면 ON/게임·독서·화질·Shizuku/외부 복구/30초·330초/실패 복구/재부팅/개인정보 로그를 포함한다.

남은 조건:

1. QA 웹과 앱 origin을 검토·준비한다. 운영 자동 배포는 하지 않는다.
2. Android 16 probe 실제 실패 원인, native video/audio·코덱·NAT/TURN, 실제 지연/열/장시간 native 메모리를 재검증한다.
3. 실제 입력 고착·게임/독서 앱 호환성, 실제 백그라운드/프로세스 재시작·로그아웃을 검증한다.
4. 패널 OFF/복구·독립 fallback 생존은 충분한 복구 자격과 새 로컬 동의 후에만 검증한다.
5. Firefox/WebKit·설치/PWA/운영 인증·원래 운영 서명/데이터 유지·최종 Galaxy Remote/Linro 브랜드 결정을 확인한다.

## 17. 변경 파일·커밋

전체 경로는 [modified-files.txt](assets/stage6/modified-files.txt)에 있다.

- `99da602` — 브라우저/Android 연결 수명, owner/세션/코드 경쟁 수정, 실제 D1/클라이언트/취소 회귀, probe 진단·패널 동의 정책 검사.
- `61c939f` — 브라우저 100회/soak·네트워크/native 시험, CI 로그, 별도 다운로드 가능한 arm64 시험 APK.
- 문서 커밋 — runbook/기록 양식/이 보고서/증거 (최종 SHA는 Git 로그/최종 응답에서 확인).

Android build/signing 설정, package IDs, 계정/기기 schema, 기존 공개 다운로드, Shizuku 고정 명령/게이트는 변경하지 않았다. 이 단계의 API 변경은 권한·타입·상태 검사를 강화했고 기존 정상 계약을 보존한다.

## 18. PR 또는 비교

PR API 접근이 Forbidden이라 PR을 생성하지 않았다.

[5단계 기준과 6단계 변경 비교](https://github.com/pashkite/phone-remote/compare/feature/galaxy-remote-2-ux-branding...feature/galaxy-remote-2-integration-qa)

## 19. 7단계 진행 여부

**CONDITIONAL GO.** 수정한 자동화 경로는 회귀를 통과했고 설치할 시험 APK·재현 가능한 CI·실기기 절차를 제공했다. 원격 CI/실제 Sites 인증/네이티브 전송·Android16/패널 OFF·복구는 미검증 조건이다. 특히 **QA 웹 origin 정합성**과 **실제 복구 검증** 없이 전체 실기기 시험/OFF를 시작하면 안 된다.

실제 확인하지 않은 기능은 PASS로 표시하지 않는다. 이번 단계의 성공 범위는 코드 안정화·통제된 자동화·빌드·실기기 검증 준비다.
