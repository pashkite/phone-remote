# Galaxy Remote 2.0 — 3단계 WebRTC 저지연 엔진

판정: **GO — 4단계 독립 기능 개발 진행 가능.** 실기기 성능·패널 OFF의 성공 판정은 아니다.

- 기준: `experiment/galaxy-remote-2-panel-off`, `e3025397a344cfdc197f78637b88ae88e274ab37` 포함 확인.
- 작업: `feature/galaxy-remote-2-low-latency`.
- 구현 커밋: f4d75567e3a4a4919edf1a43834b11ad84604691
- PR: API 접근이 403 Forbidden을 반환하여 생성하지 못함.
- [PR 작성용 비교 화면](https://github.com/pashkite/phone-remote/compare/experiment/galaxy-remote-2-panel-off...feature/galaxy-remote-2-low-latency?expand=1) — 실제 생성된 PR 링크가 아님.
- `main`, `master`, 운영 사이트, 공개 다운로드 APK, 서명키, 계정·기기 데이터는 변경하지 않음.
- 사용자 변경 원칙에 따라 화면 OFF 실기기 검증은 독립 개발의 선행 조건에서 제외함.
  화면 OFF는 계속 **미검증 실험 기능**이며 최종 종합 검증에서 별도로 평가한다.

## 기존 엔진 분석: 코드로 확인한 문제와 실측하지 않은 가설

확인된 구조적 문제:

1. 기본 1080p 출력에도 캡처 surface는 1440 짧은 변으로 시작했다. 출력 어댑터의
   FPS 제한만 있었고 RTP maxFramerate는 명시하지 않았다. 캡처 FPS 인자는
   ScreenCapturerAndroid에서 무시된다.
2. 화면 회전 시 RemoteControlService가 사용자의 선택과 관계없이 1080p/30fps로
   초기화했다.
3. 브라우저 손실률은 세션 누적값이었다. 여러 candidate pair가 있으면 RTT가 실제
   선택된 경로와 다를 수 있었다. 인코딩·디코딩 시간과 실제 송신 FPS는 표시하지 않았다.
4. Android RemoteCommandProcessor는 모든 메시지를 main Handler에 개별 게시했다.
   LiveTouchController의 move 병합보다 앞선 수신 큐에는 명시적 상한이 없었다.
5. 브라우저 touch 2KiB 예산이 MOVE와 UP/CANCEL에 동일 적용되어 혼잡 시 해제 명령도
   거절될 수 있었다. 기존 1.5초 Android watchdog은 최후 해제 경로로 남아 있다.

병목 **가설**: 인코더 큐, native VP8 fallback, GPU/CPU 부하, 네트워크 재전송,
브라우저 playout buffer가 체감 지연에 기여할 수 있다. Galaxy에서 측정하지 않았으며,
위 변경으로 실제 지연이 얼마 줄었다고 주장하지 않는다. libwebrtc 내부 큐의 깊이를
임의로 조작하거나 측정값으로 가장하지 않는다.

## 실제 적용

### 캡처와 전송

- CaptureEngine 인터페이스와 MediaProjectionCapture 구현 분리. 세션 생성 시 factory
  주입 가능. 기본은 기존 ScreenCapturerAndroid + MediaProjection이다.
- 엔진이 캡처 생명주기·projection·원본 프레임 카운터를 소유한다. WebRtcSession은
  VideoSource/VideoTrack/PeerConnection을 소유한다. shell 캡처가 압축 비트스트림을
  제공한다면 별도의 WebRTC encoder/프레임 브리지가 필요하며 이 인터페이스만으로
  바로 연결된다고 가정하지 않는다. 콜백은 기존 VideoFrame을 빌려
  전달하며 복사·프레임 보관 큐를 추가하지 않았다.
- surface가 기본 1080p로 시작하고 해상도 변경 때만 resize한다. FPS 변경만으로
  MediaProjection을 다시 획득하거나 PeerConnection을 재생성하지 않는다.
- VideoSource 출력 어댑터와 RTP maxFramerate/maxBitrateBps를 함께 요청한다.
  RTP 설정을 구현체가 거절하면 세션을 파괴하지 않고 출력 제한을 유지하며 통계에서
  `rtpLimitsApplied=false`로 표시하고 재시도한다. 설정값과 실제 송신값은 별개다.
- 회전 시 선택 품질을 유지하고 현재 가로·세로 크기로 재계산한다. 브라우저도 수신
  크기 변경 시 기존 포인터를 취소하여 이전 방향 좌표를 새 화면에 이어 붙이지 않는다.
- 종료 시 통계 작업·입력·peer를 정리하고 캡처 전체 종료 시 projection/source/helper/
  factory/EGL을 정리한다. 캡처 초기화 중 예외에도 생성된 리소스를 정리한다.
- 패널 DisplayControl/PanelService/AIDL/manifest는 변경하지 않았다. MediaProjection
  종료를 화면 OFF 성공으로 해석하거나 자동 우회하지 않는다.

### 품질·코덱·안전 제한

| 모드 | 짧은 변 / FPS | 비트레이트 상한 요청 |
|---|---|---|
| 데이터 절약 | 540 / 24 | 1.2Mbps |
| 안정성 우선 | 720 / 30 | 2.5Mbps |
| 균형·기본 | 1080 / 30 | 4.5Mbps |
| 부드러움 | 1080 / 60 | 7.65Mbps |
| 고화질 | 최대 1440 / 30 | 7Mbps |
| 자동 | 균형으로 시작, 단계적 조절 | 위 단계별 상한 |

p는 짧은 변 기준이며 물리 화면보다 확대하지 않는다. 기존 사용자 지정 540p/60fps
반응 우선 설정도 유지한다. 1440p는 30fps로 제한한다. 기존 bitrateFor의 1.7배 식을
유지하므로 1080p/60은 7.65Mbps이며, 실제 송신 비트레이트와는 다르다.

- 기본 VP8 유지. Android DefaultVideoEncoderFactory가 실제 제공하는 VP8/H.264만
  광고하며 VP8를 먼저 둔다. H.264를 강제 제공하거나 성능 우위를 주장하지 않는다.
- 웹에서 H.264 우선을 명시적으로 선택한 경우만 H.264+VP8를 제안한다. 상대가 VP8만
  지원하면 표준 SDP 협상으로 VP8를 사용한다. 협상 오류/연결 실패 또는 연결 후 10초간 첫 영상 없음은 VP8 기준선으로
  재시도한다. 사용자의 연결 거절이나 인증 오류를 코덱 재시도 대상으로 취급하지 않는다.
- 수동 품질 선택은 자동 네트워크 조절에서 제외한다. 다만 기기 안전 제한은 적용한다.
  Android thermal status 3 이상/지속 인코더 과부하는 최대 720p/30, status 4 이상은
  540p/24로 낮춘다. 온도 수치는 아니라 OS 열 상태 단계다.
- 열 제한 복구는 30초 안정 구간을 요구한다. 인코더 과부하는 3개 불량 표본 후 제한,
  15개 안정 표본(약 30초) 뒤 해제한다. 프로세스 CPU 시간도 수집하지만 전체 기기 CPU
  사용률로 오인하지 않으며, raw CPU 값만으로 무리하게 제한하지 않는다.
- 구버전 앱은 capability 광고로 구분한다. 720 옵션은 연결된 구버전에서 비활성화하고
  자동 모드는 720 지원이 없으면 540 단계로 이동한다. 지원하지 않는 통계는 알 수 없음.

### 자동 모드

사용자 opt-in이며 기본 수동 1080p/30을 변경하지 않는다. 구간 손실·RTT·지터 버퍼·
입력 bufferedAmount·Android send delay/인코더 과부하/열 상태와 실제 FPS를 사용한다.

- 3개 연속 불량 표본이면 한 단계 하향.
- 20개 연속 안정 표본이면 한 단계 상향, 자동 최대 1080p/60.
- 변경 간 최소 10초. 장시간 표본 공백은 연속 판정을 초기화한다.
- sender 통계는 6초 이상 지나면 사용하지 않는다.
- 정적인 화면의 낮은 FPS만으로 하향하지 않는다. 새 프레임 없음은 정지 화면일 수도
  있으므로 UI에서 그 한계를 표시한다. 백그라운드 탭에서는 자동 판단을 중지한다.

### 입력과 브라우저

- DOWN/MOVE/UP/CANCEL은 기존 reliable ordered 채널에 유지한다. 별도 unordered
  입력 채널을 도입하지 않아 경계 이벤트 순서를 보존한다.
- 새 Android capability에 한해 브라우저 최신 MOVE 샘플 간격 16ms, 구버전은 32ms 유지.
  정지 heartbeat 약 500ms, 움직임은 최신값만 전송한다. Android 24ms stroke 처리
  때문에 실제 게임 입력이 60Hz라는 의미는 아니다.
- Android 수신 대기 최대 64개, 같은 touch ID의 인접 MOVE만 병합, main loop당 8개 처리.
  과부하 시 큐를 버리고 기존 포인터를 해제한다. 사용자 입력은 자동 재생하지 않는다.
- 접근성 stroke 대기에도 16개 상한을 적용한다. 이는 멀티터치 구현이 아니다.
- UP/CANCEL은 MOVE보다 큰 64KiB 이내 전송 여유를 사용한다. 이 한도를 넘는 혼잡이나
  채널 중단은 여전히 watchdog/종료 해제가 필요하다. zero-loss 해제를 보장하지 않는다.
- 클릭/길게 누르기/드래그/letterbox 좌표/blur/pagehide/숨김/회전/연결 종료 동작 보존.
- 지원하는 브라우저만 jitterBufferTarget/playoutDelayHint=0 힌트를 요청한다.
  실제 zero-buffer 보장이나 임의 브라우저 내부 버퍼 조작은 하지 않는다.

## 통계와 성능 비교

웹에 네트워크 RTT, 수신 FPS/해상도/비트레이트, 구간 손실, codec, 평균 디코딩 시간,
지터 버퍼 체류시간, 구간 드롭, 새 프레임 없음, 입력 전송 대기를 표시한다.
Android는 어댑터 이전 capture FPS와 framesEncoded 기반 송신 FPS, 송신 비트레이트,
평균 인코딩 시간, 평균 packet-send delay, encoderImplementation,
powerEfficientEncoder(제공될 경우), 열 상태, 프로세스 CPU core-percent를 보고한다.

powerEfficientEncoder는 이름 그대로 전력 효율 지표다. 모든 기기에서 하드웨어 사용을
증명하는 지표라고 단정하지 않는다. 실제 인코더 이름/구현체 정보를 함께 확인해야 하며
통계가 없으면 미확인이다. 평균 packet-send delay는 큐 깊이 그 자체가 아니다.
일부 libwebrtc/브라우저가 제공하지 않는 값은 null/확인 불가이며 0으로 꾸미지 않는다.

| 비교 항목 | 변경 전 | 변경 후 | 실측 결과 |
|---|---|---|---|
| 기본 codec | VP8만 | VP8 기본, H.264 opt-in+fallback | 실기기 미측정 |
| 기본 설정 FPS | 30 | 30 | 실제 FPS 미측정 |
| 기본 출력 짧은 변 | 1080 | 1080 | 실효 해상도 미측정 |
| 시작 캡처 surface 짧은 변 | 1440 | 1080 | 부하 절감량 미측정 |
| RTP FPS 상한 | 명시 없음 | 품질별 maxFramerate 요청 | 기기 수락/실효 제한 미검증 |
| 기본 bitrate 상한 요청 | 4.5Mbps | 4.5Mbps | 실제 bitrate 미측정 |
| 손실 | 세션 누적 | 표본 구간 delta | 실기기 손실 미측정 |
| 입력 수신 큐 | Handler 개별 게시 | 64개 상한·MOVE 병합·공정 배치 | 실효 입력 지연 미측정 |
| RTT / 종단 지연 / p95 / 최악값 | 미측정 | 측정 경로와 도구 추가 | 전부 미측정 |
| 메모리 / Android CPU / 인코더 부하 | 미측정 | CPU·인코더 진단 추가 | 전후 수치 미측정 |
| 연결 안정성 | 기존 재연결 | 기존 경로 유지·코덱 fallback | 실기기 미검증 |

## 자동 검증 결과와 재현

환경: Node 24.19, JDK 17.0.18, Gradle 8.11.1, SDK 35/build-tools 35.0.0.

```sh
# 의존성이 없으면 먼저 설치. 실행 비트 없는 기존 helper는 bash로 호출.
bash scripts/sites-env.sh -- bash scripts/install-ci.sh
bash scripts/test-web-streaming.sh

cd android-client
gradle :app:testDebugUnitTest :app:testPanelTestUnitTest \
  :app:assemblePanelTest :app:assembleDebug :app:assembleRelease \
  :app:assembleDebugAndroidTest --max-workers=3
```

| 검사 | 결과 |
|---|---|
| 전체 Vite 웹 빌드·Worker 산출물 검증 | 통과 |
| TypeScript | 통과 |
| 변경 TS/TSX 파일 ESLint | 통과 |
| 웹 Node 테스트 | 52개 통과, 실패·스킵 0 |
| Android debug 단위 테스트 | 10개 통과, 실패·스킵 0 |
| Android panelTest 단위 테스트 | 동일 정책 10개 통과, 실패·스킵 0 |
| Python 사전 검사·측정 도구 | 6개 통과, 실패·스킵 0 |
| arm64 panelTest, debug, unsigned release APK | 빌드 통과 |
| debug instrumentation APK | 컴파일 통과, 실행 미검증 |
| 로컬 HTTP 홈페이지·소유자 품질 UI·기기 목록·익명 API 401 | 통과 |
| Galaxy 설치·실제 인코더 협상·프레임 전송·입력·재연결 | 미검증 |
| 실제 패널 OFF·정상/비정상 복구 | 미검증 |

기존 전체 lint는 이전 단계에서 theme-toggle.tsx의 set-state-in-effect 오류가 있었고
이 범위에서 수정하지 않았다. 변경 파일 lint 통과를 전체 저장소 lint 통과로 확대하지 않는다.

새 테스트는 품질/FPS/bitrate/thermal 상한, 해상도 회전, codec 허용/fallback 정책,
입력 MOVE 폭주·경계 순서·상한·취소, 선택 ICE 경로·통계 reset·손실 delta·freeze,
자동 모드 히스테리시스/구버전/오래된 telemetry, 16ms sender 및 해제 여유를 검사한다.
기존 클릭·드래그·blur·geometry·단축키·HTML 권한 테스트를 유지했다.
기존 source assertion 일부는 720 지원/1440p FPS 제한 및 정책 분리의 변경된 계약에
맞춰 갱신했으며 테스트를 비활성화하거나 실패를 무시하지 않았다.

ProjectionSmokeService/Receiver는 실제 첫 프레임 수신 후 세 가지 품질 전환의 새 프레임,
peer 종료와 재연결을 추가 검사한다. 이 확장으로 결과 제한 시간을 100초로 조정했다.
이 경로의 성공은 실제 instrumentation 실행 전까지 주장하지 않는다.

현재 arm64 테스트 APK 사본은
`outputs/low-latency/GalaxyRemote-stage3-arm64-paneltest.apk`에 있으며 공개 다운로드나
운영 APK를 덮어쓰지 않았다. APK 서명 및 16KiB ZIP 정렬 검사를 통과했다. 이는 native
ELF의 모든 페이지 크기 호환성이나 기기 설치 성공을 입증하지 않는다.
SHA-256: `9ee74e024c052e830b128dd83e8aa16899419717dfc004661dcd1dc53451bc25`.

현재 adb 장치 목록은 비어 있고 /dev/kvm 및 설치된 에뮬레이터가 없다. native 초기화,
실제 SDP/encoder fallback과 캡처 종료 리소스 검증은 instrumentation/실기기에서 남아 있다.
기존 Android 16 드래그 실패는 UiAutomation 서비스 억제 및 후속 probe-window 문제로
독립 추적한다. LiveTouchTest를 그대로 유지했다. API 403으로 원본 Actions 로그에 접근하지
못했으며 이 작업에서 해결됐다고 주장하지 않는다.

새 web-streaming-tests workflow는 PR/수동 실행에서만 위 웹 검증을 수행하며 배포하지
않는다. Android workflow의 기존 instrumentation/결과 보관도 유지한다. 로컬 검증 결과는
GitHub Actions 실행 성공의 증거가 아니다.

## 최종 실기기 종합 검증 준비

1. 기존 앱을 삭제하지 말고 별도 arm64 panelTest APK를 설치·등록한다. debug 서명이며
   기존 운영 APK 업데이트용이 아니다. 서명키/데이터를 이전하거나 교체하지 않는다.
2. Android 15/16, One UI·모델·SoC·패치·브라우저 버전, 연결 경로를 기록한다.
3. 각 품질 모드에서 30초 워밍업 후 움직이는 동일 게임 장면을 5분 이상 실행한다.
   stats와 실제 codec/encoder/thermal/CPU를 수집한다. 통계 export는 기기 IP·토큰·게임
   화면을 담지 않도록 제한한 기존 Diagnostics 경로를 사용한다.
4. 1080p/60 안정화와 LAN 종단 지연 100ms 이하를 목표로 **측정**한다. 아직 달성하지 않았다.
   고속 카메라로 입력 표시 LED/이벤트와 브라우저 게임 반응을 같은 시간축에 촬영하고,
   각 표본의 입력→첫 변화 차이를 latency_ms로 기록한다. 카메라 시간 해상도 오차도 적는다.
5. 독립 측정 CSV를 `python3 scripts/latency-summary.py measurements.csv`로 요약한다.
   median/nearest-rank p95/최악값/표본 수를 보고하며 RTT를 종단 지연으로 변환하지 않는다.
6. 네트워크 shaping·변동, 화면 회전, 탭 숨김·focus 상실, 장시간 hold, 단절·재연결,
   수동 모드 존중, 자동 모드 단계 변경을 검사한다. 장애 때 입력이 해제되는지 확인한다.
7. 기본 VP8와 명시적 H.264를 별도 비교한다. 지원 안 함/협상 실패는 VP8로 돌아오는지,
   사용자 거절·인증 실패에는 재승인 요청을 자동 반복하지 않는지 검사한다.
8. 다른 독립 기능 개발을 마친 뒤 PANEL-OFF-EXPERIMENT.md의 외부 복구 사전 검증부터
   시작한다. 복구가 검증되지 않으면 실제 OFF 명령을 실행하지 않는다. 패널 OFF 후
   MediaProjection 종료 가능성을 별도 결과로 기록한다. shell 캡처 엔진은 아직 미구현이다.

## 수정 파일

- `.github/workflows/web-streaming-tests.yml`
- `android-client/app/src/main/java/com/galaxyremote/app/WebRtcSession.kt`
- `android-client/app/src/main/java/com/galaxyremote/app/RemoteControlService.kt`
- `android-client/app/src/main/java/com/galaxyremote/app/RemoteCommandProcessor.kt`
- `android-client/app/src/main/java/com/galaxyremote/app/LiveTouchController.kt`
- `android-client/app/src/main/java/com/galaxyremote/app/streaming/CaptureEngine.kt`
- `android-client/app/src/main/java/com/galaxyremote/app/streaming/StreamQuality.kt`
- `android-client/app/src/main/java/com/galaxyremote/app/streaming/BoundedInputQueue.kt`
- `android-client/app/src/test/java/com/galaxyremote/app/streaming/StreamingPolicyTest.kt`
- `android-client/app/src/debug/java/com/galaxyremote/app/ProjectionSmokeService.kt`
- `android-client/app/src/debug/java/com/galaxyremote/app/WebRtcLoopbackReceiver.kt`
- `android-client/app/src/androidTest/java/com/galaxyremote/app/ProjectionSmokeTest.kt`
- `app/remote-console.tsx`
- `lib/remote/streaming.ts`, `client.ts`, `diagnostics.ts`, `live-touch.ts`
- `tests/streaming.test.mjs`, `live-touch.test.mjs`, `remote-protocol.test.mjs`, `remote-console-source.test.mjs`
- `scripts/test-web-streaming.sh`, `latency-summary.py`, `scripts/tests/test_latency_summary.py`
- `docs/WEBRTC-LOW-LATENCY-STAGE3.md`, `docs/PANEL-OFF-EXPERIMENT.md`(개발 진행 조건 갱신)

## 남은 제한과 다음 단계

멀티터치, WASD/게임패드, 게임 입력 매핑은 다음 단계 대상이며 이번에는 기존 단일
포인터 경로를 보존했다. H.264의 성능 우위, 60FPS, 100ms, 전력 절감, 전체 Galaxy 호환성은
보장하지 않는다. STUN 직접 연결이 실패하는 네트워크의 무료 연결 보장도 추가하지 않는다.

**GO: 다음 독립 기능의 개발을 진행할 수 있다. 운영 공개·성능 달성·패널 OFF 성공 판정은 아니다.**
