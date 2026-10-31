# 린로: 패널 OFF에서만 터치·최근 앱이 동작하지 않는 문제

후속: [v22 기록 분석과 Shizuku 직접 터치 비교 후보 v23](PANEL-SHELL-TOUCH-TRIAL.md). 아래 v22는 이전 진단 버전 기록입니다.

## 현재 판정

사용자는 실제 패널 OFF를 관찰했고, 웹 화면과 홈·최근 앱 빠른 제어가 동작한다고 보고했다. OFF에서 좌표 터치가 동작하지 않고 최근 앱 목록이 표시되지 않는다. 화면 ON으로 돌아오면 같은 웹의 클릭·드래그와 최근 앱 목록은 모두 정상이라고 확인했다.

따라서 **물리 OFF는 해당 사용자 기기의 관찰로 확인**, **OFF에서 게임 입력·최근 앱 표시 정상 동작은 실패 보고**, **원인과 수정 효과는 미검증**으로 기록한다. 갤럭시 모델/펌웨어 전체나 330초 세션, 자동·비정상 종료 복구 성공으로 일반화하지 않는다. 클라우드에는 실제 기기가 없다.

제공된 이력의 `#21`, `#24`는 OFF 요청 직전의 일회성 검사 사용을 기록하고, 이후 복구 요청이 이어진다. 현재 `ready=false`는 복구 요청 후 새 검사가 필요한 상태다. 기록만으로 OFF/복구 명령의 모든 실행 결과나 실제 패널 상태를 증명하지는 않는다. 최근 4번 `power-reset 0` exit 0과 최근 복구 명령 exit 0은 명령 수락 증거다. 물리 상태는 사용자의 관찰과 구분한다.

진단에 있는 ID 8은 display 0의 MediaProjection 미러 출력이다. 가상 화면의 `touch NONE`은 그 출력에 터치 장치가 없다는 뜻이며, 조작 대상을 ID 8로 바꾸라는 근거가 아니다. 앱의 접근성 제스처는 기본 디스플레이를 대상으로 한다. `FLAG_SECURE`가 표시된 내장 DisplayDeviceInfo만으로 개별 최근 앱의 보호 플래그나 미리보기 차단을 확정할 수도 없다.

## 코드에서 확인한 결함과 수정

홈·최근 앱은 `performGlobalAction()`을 사용한다. 좌표 입력은 `dispatchGesture()`와 continued strokes를 사용하므로 홈 성공이 좌표 입력 성공을 뜻하지 않는다. ON 정상/OFF 실패는 OFF 상태에서 달라지는 입력·화면 합성 경로를 우선 조사해야 한다는 근거이며, Samsung 정책이 원인이라는 확정은 아니다.

기존 `LiveTouchController`는 비동기 `onCancelled()`와 즉시 접수 거절에서 내부 상태만 초기화했다. 명령 처리기의 앞선 접수 결과와 실제 후속 취소를 구별해 웹에 전달하지 못했다. 이번 수정은:

- 단일 터치의 취소·거절·예외를 `inputError`로 전달하고 기존 `notice` 프로토콜로 한국어 안내를 보낸다. 웹 배포 없이 기존 notice 소비 경로를 사용한다. 단일 터치의 실제 전달/해결은 실기기 미검증이다.
- 단발 제스처·단일 연속 터치·멀티터치의 API 접수와 완료/취소/거절/오류를 각각 기록한다. 늦은 콜백은 접수 당시 구간에 귀속한다.
- `InteractionTrace`는 BASELINE/OFF_REQUESTED/RESTORE_REQUESTED별 누적 카운터, 요청 직전/종료 시점 비교 기록, 최근 32개 오류·구간 변경과 캡처 프레임/최신 프레임 경과 시간을 보관한다.
- 실험 화면에 **입력·영상 진단 보기 (ON/OFF 비교)** 버튼을 추가한다. 기존 전체 진단 맨 위에도 같은 내용이 포함된다. 상태바 여백·안전 게이트는 유지한다.
- 기록은 프로세스 메모리에만 남는다. 좌표·텍스트·화면 내용·대상 앱 이름·계정/세션/기기 ID를 저장하지 않고 서버로 새 진단 자료를 보내지 않는다. 프로세스 종료 시 사라진다.

새 shell 입력 API, 루트, 권한 우회, 임의 명령, 캡처 엔진 전환을 추가하지 않았다. 기존 MediaProjection·접근성·복구·입력 해제·동의 조건을 유지한다. OFF 입력을 성공했다고 가정하거나 실패한 입력을 자동 재생하지 않는다.

## 짧은 비교 시험

1. 실제 화면이 ON이고 이전 시험에서 복구됐는지 확인한 뒤 세션을 종료하고 v22를 업데이트한다. 앱 삭제·데이터 초기화는 하지 않는다. Shizuku 시작/권한 → 2번 shell 연결을 다시 한다.
2. 화면 ON에서 웹 연결을 시작한다. 민감하지 않은 앱에서 클릭·드래그·최근 앱 표시를 확인한다. 초시계처럼 눈으로 변화 여부를 판별할 수 있는 화면도 준비한다.
3. 3번 → 4번 순서로 검사한다. **실제 패널 매핑과 별도 외부 복구가 검증되지 않았다면 OFF를 실행하지 않는다.** 4번 수락만으로 그 검증을 대신하지 않는다.
4. 자격을 갖춘 경우에만 기존 **30초** 시험을 사용한다. 5초 동안 시험할 앱으로 돌아간다. 처음에는 홈·최근 앱을 누르지 않고 앱 내용이 계속 변하는지와 클릭 1회·짧은 드래그 1회를 확인한다. 웹의 실행 결과/오류 안내도 본다.
5. 다음으로 홈·최근 앱을 시험하여 전체 영상이 멈춘 것인지, 배경/애니메이션은 움직이지만 카드만 없는 것인지 구분한다. 웹 스트림 통계의 송신/수신 FPS도 참고한다. frame counter 증가만으로 영상 내용 변화나 웹 수신 성공을 판정하지 않는다.
6. 즉시 복구 또는 기존 제한 시간으로 ON 복귀를 확인한다. **입력·영상 진단 보기**를 열어 내용을 선택·복사한다. 프로세스를 강제 종료하지 말고 그 짧은 진단과 웹에 나타난 메시지를 전달한다. 긴 `cmd display help`/`dumpsys` 원문은 다시 보낼 필요가 없다.
7. ON으로 돌아왔을 때 같은 클릭·드래그가 다시 동작하는지 확인한다. 30초 입력·표시·실제 복구가 통과하기 전 330초 시험은 진행하지 않는다.

`RESTORE_REQUESTED`는 ON 검증값이 아니라 앱의 복구 요청 구간이다. OFF 시험 전 ON 비교가 그 구간에 집계될 수도 있다. 카운터는 프로세스 누적이므로 최근 OFF 직전/종료 기록과 함께 해석한다. 구간 종료 후 늦은 콜백은 현재 표의 원래 구간에 추가되며 종료 순간 스냅샷에는 포함되지 않을 수 있다.

| 짧은 진단 결과 | 해석·다음 조사 |
|---|---|
| OFF 구간 RECEIVED 증가 없음 | 웹 이벤트/명령 처리/연결 경로부터 조사. 이 표만으로 Android 터치 거절이라고 판정하지 않음 |
| RECEIVED 증가, CANCELLED/REJECTED/ERROR 증가 | 접근성 제스처 취소·거절·예외를 확인. 별도 동의·세션·일회성 범위를 유지하는 Shizuku 입력 후보의 후속 검토 근거 |
| SUBMITTED/COMPLETED 증가하지만 앱 반응 없음 | API 접수/콜백은 대상 앱 반응 증거가 아님. 입력 대상·좌표/화면 크기·포커스·OS 전달과 실제 영상 변화를 구분 |
| OFF 구간 캡처 프레임이 없거나 오래됨 | 캡처 중지/정체 조사. 캡처 엔진 교체 후보 검토는 필요하지만 shell 캡처를 바로 WebRTC에 연결할 수 있다고 가정하지 않음 |
| 프레임/내용은 갱신되는데 최근 앱 카드만 없음 | One UI 합성/미리보기/보호 정책 등의 후보를 기기에서 추가 검증. 보호 콘텐츠 우회나 지원 성공으로 판정하지 않음 |

## 검증·APK

[검증 JSON](assets/panel-off-input-diagnostics/validation-summary.json)과 같은 폴더의 로그 참조.

- Android JVM: **debug 52 + panelTest 52 = 104 PASS**. 실패·오류·skip 0. 추가 6개 테스트를 두 변형에서 수행했다.
- 새 테스트: 접수와 완료 구별, OFF 결과/프레임 보존, 미수신·중지 상태, 알려진 입력 종류만 기록, 입력 폭주 시 메모리 상한, 글로벌 명령과 좌표 입력 구분, 늦은 콜백의 구간 귀속.
- 웹/API **94 PASS**, Python **12 PASS**, lint·TypeScript·웹 production 빌드·Worker 검증 PASS.
- panelTest/debug/unsigned release/debug instrumentation APK 빌드 PASS. instrumentation은 컴파일만 했고 Android 16 드래그 런타임을 수행한 결과가 아니다.
- 패키지·이름·arm64·기존 v21 인증서 일치·16KiB 정렬 PASS. 앱 이름·아이콘은 유지한다.
- 실제 신규 APK 설치/업데이트·오류 안내·OFF 입력·최근 앱 표시·게임/캡처 연속성·타이머 복구는 **미검증**. 브라우저 런타임도 이번에는 재실행하지 않았다.

[APK 직접 다운로드](https://github.com/pashkite/phone-remote/raw/refs/heads/fix/linro-panel-help-preflight/qa-artifacts/panel-off-input-diagnostics/Linro-panel-off-input-diagnostics-arm64-paneltest.apk) · [파일 페이지](https://github.com/pashkite/phone-remote/blob/fix/linro-panel-help-preflight/qa-artifacts/panel-off-input-diagnostics/Linro-panel-off-input-diagnostics-arm64-paneltest.apk)

- versionCode **22**, versionName `0.5.5-panel-experiment`, package `com.galaxyremote.app.paneltest`, arm64-v8a, 표시 이름 린로.
- SHA-256: `19c2a7238aae22fdbc61007d6b5cab025fbb2dd9d45a8b0899274cbdd9dd3158`.
- 크기 16,512,752 bytes.
- 인증서 SHA-256: `8f568dd3778c9b0f8a316427c1a2e048a2f454f153a9b6d40dd3e4337dd0748f` (v21과 일치).

저장소 접근 계정에서 Download raw file로 다운로드한다. 비로그인 다운로드 가능 여부는 미검증이다. Windows에서:

```powershell
$Apk = "$env:USERPROFILE\Downloads\Linro-panel-off-input-diagnostics-arm64-paneltest.apk"
Get-FileHash -Algorithm SHA256 $Apk
adb install -r $Apk
```

서명/hash 불일치면 중단하고 기존 앱을 삭제하지 않는다. 데이터 보존은 동일 패키지·서명을 유지하는 업데이트 정책이며 실제 사용자 데이터 보존을 클라우드에서 확인한 것은 아니다.

## 근거·제출 범위

- [Android AccessibilityService.dispatchGesture](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService#dispatchGesture(android.accessibilityservice.GestureDescription,%20android.accessibilityservice.AccessibilityService.GestureResultCallback,%20android.os.Handler)): API 반환과 비동기 콜백을 구분해야 한다. 패널 OFF에서 모든 앱의 입력을 보장하는 근거가 아니다.
- [Android MediaProjection](https://developer.android.com/media/grow/media-projection): 사용자 동의와 캡처 수명 주기. One UI 최근 앱 썸네일이 OFF에서 표시된다는 보장은 아니다.
- [scrcpy 공식 Controller](https://github.com/Genymobile/scrcpy/blob/master/server/src/main/java/com/genymobile/scrcpy/control/Controller.java): 좌표·키 이벤트와 display ID를 직접 주입하는 별도 경로다. 현재 접근성 경로와 같다고 가정하지 않는다.

이 문서의 기기 판정은 사용자 보고 범위다. 테스트는 모의 상태/카운터와 빌드 검증이며 Samsung 펌웨어에서 원인을 재현한 결과가 아니다. 동일 버그 수정 브랜치 `fix/linro-panel-help-preflight`에서 이전 `53fabe7706d6756c1fe2d08bddaef5b6594089d3`에 후속 커밋·푸시한다. main/master 및 운영 배포는 변경하지 않는다.

전체 게임 플레이 GO 조건은 아직 충족되지 않았으며 다음 단계 판정은 **CONDITIONAL GO: 원인 구분용 단기 검증**이다.
