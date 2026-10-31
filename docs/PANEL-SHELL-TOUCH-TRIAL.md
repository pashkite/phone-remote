# 린로 v23: 사용자 선택형 Shizuku 직접 터치 비교

## 제공된 v22 기록에서 확인한 범위

| 관찰 | 해석 |
|---|---|
| 사용자: 실제 패널 OFF 관찰, ON에서 터치·최근 앱 정상, OFF에서 터치 실패·최근 앱 카드 누락 | 해당 기기의 실패 보고로 유지. 원인 확정이나 전체 Galaxy 지원 판정은 아님 |
| OFF 요청 시작 +417565ms → 복구 요청 +447894ms | 약 30.329초 요청 구간 |
| LIVE_TOUCH RECEIVED 9 / SUBMITTED 6 / COMPLETED 6 | 명령이 앱 처리 경로에 도달했고 접근성 제스처 분절 6회의 완료 콜백이 옴. 대상 앱 반응은 확인하지 못함 |
| OFF 구간 캡처 221, 구간 종료 시 최신 프레임 경과 70ms | OFF 직후 캡처 전체 중단이라는 설명은 지지하지 않음. 구간 전체 연속성·내용 변화·웹 수신·게임 FPS는 증명하지 않음 |
| GLOBAL RECEIVED/SUBMITTED 6 | 글로벌 API 접수. 좌표 입력과 별도 경로 |
| capture STOPPED +825414ms | OFF 요청 구간 종료 약 6분 17.5초 후. 내보낼 때의 STOPPED/오래된 프레임 값을 OFF 순간 원인으로 해석하면 안 됨 |

9개 수신 명령과 6개 분절 콜백은 서로 다른 계수다. 큐 병합/종료 처리가 있으므로 이 차이만으로 패킷 3개가 유실됐다고 단정하지 않는다. 제공 기록에 접근성 취소·거절이 없으므로 그것을 원인으로 단정하던 가설은 보류한다.

Android 16 `MotionEventInjector.handleMessage()`는 다음 입력 처리 단계에 이벤트를 전달한 뒤 마지막 분절에서 성공 콜백을 보낸다. 대상 게임이 터치를 소비했는지 반환받는 구조가 아니다. [AOSP 원본](https://github.com/aosp-mirror/platform_frameworks_base/blob/android16-release/services/accessibility/java/com/android/server/accessibility/MotionEventInjector.java).

## 이번 변경: 실제 입력 경로 비교 후보

기존 MediaProjection + WebRTC와 기본 접근성 입력은 유지한다. 앱의 **이번 비교에 Shizuku 직접 터치 후보 사용**을 선택·확인한 시험에서만 shell UID 2000의 UserService가 Android InputManager 계열의 `injectInputEvent`에 고정 display 0 단일 포인터를 전달한다. `INJECT_EVENTS`의 실제 허용과 Samsung 호환성은 실기기 미검증이다. 루트 UID는 기존 정책대로 거부한다.

[scrcpy 공식 InputManager wrapper](https://github.com/Genymobile/scrcpy/blob/master/server/src/main/java/com/genymobile/scrcpy/wrappers/InputManager.java)의 직접 이벤트 주입/표시 대상 지정과 같은 Android 메커니즘을 비교 대상으로 삼았다. 전체 scrcpy 구현을 이식한 것이 아니다. API 해석은 reflection으로 시도하지만 hidden-API 제한을 해제하거나 예외 목록/시스템 설정을 변경하지 않는다. API가 없거나 거부되면 미지원/실패를 표시하며 다른 권한·명령을 추측하지 않는다.

- **허용**: display 0의 단일 클릭·길게 누르기·드래그·단일 포인터 프레임.
- **미지원**: 이 후보의 동시 멀티터치, 게임패드 복합 입력, 임의 키/명령/다른 display ID. 두 포인터 이상은 명시적으로 거절한다. 기존 접근성의 멀티터치 기능을 삭제한 것은 아니다.
- **선택 범위**: 새 후보 기본 OFF. 사용자 체크와 별도 확인 대화상자, 현재 WebRTC·Shizuku 권한·서비스·새 사전 검사·기존 외부 복구 확인을 요구한다. 브라우저에서 직접 이 후보를 켜는 API는 없다.
- **30초 ON 비교**: 입력만 30초 비교하며 `power-off`는 실행하지 않는다. 종료/즉시 복구에서는 기존 확인된 reset 경로도 사용한다.
- **30초 OFF 비교**: 기존 OFF/복구 게이트·타이머·독립 복구 프로세스를 유지한다. 후보 선택 시 330초 OFF는 앱·서비스 공통 정책으로 차단한다.
- **무효화/해제**: 매 시험 세대 토큰, 소유 Binder 생존, 8초 heartbeat, 제한 시간, 1.5초 포인터 heartbeat(서비스 주기 포함 통상 최대 약 2.5초에 취소 시도), 화면 크기/회전 변경·잘못된 좌표/순서 시 취소를 적용한다.
- **입력 큐**: 전용 단일 worker, 대기 최대 32개, 대기 1.5초 초과 명령 폐기. 단발 길게/스와이프는 최대 1.2초, 16ms 단위 작업이다. 복구 타이머와 UI를 이 worker에서 기다리지 않는다. 큐 포화·시험 종료 시 새 입력을 막고 해제를 요청한다.
- **실패 처리**: 선택한 시험 안에서 접근성으로 자동 재생/대체하지 않는다. 서비스/권한 상실·복구 실패 시 직접 입력을 중단한 채 실패를 알린다. 정상 복구 명령 수락 또는 새로 승인한 시험 이후의 기본 경로와 구분한다.

AIDL에는 토큰·동작 번호·정규화 좌표만 전달한다. 허용 동작은 DOWN/UP/MOVE/CANCEL이며 문자열 shell API, 호출자가 선택하는 display/경로/프로그램은 없다. 앱은 좌표를 입력 전달에만 사용하고 진단에는 저장하지 않는다. `SHELL_TOUCH/SUBMITTED`와 `API_ACCEPTED`는 OS API 접수일 뿐 대상 앱 전달 성공이 아니다.

## 수정 파일

- `display/ShellTouchState.kt`: 순수 단일 포인터 상태·제한 시간·이전 토큰 거부·좌표/회전 검사·해제와 짧은 OFF 정책.
- `display/ShellTouchInjector.kt`: shell 프로세스에서 고정 framework API/geometry 조회, display 0 MotionEvent 생성·주입·결과 기록.
- `display/ShellTouchClient.kt`: 앱의 짧은 제스처/스트림 변환, bounded worker, 취소·실패 전달.
- `display/IPanelService.aidl`, `PanelService.kt`: 승인한 소유자와 armed lease에 한정한 후보 준비·토큰/이벤트·읽기 전용 진단, 기존 복구 경로에서 포인터 해제.
- `DisplayControl.kt`, `PanelExperimentActivity.kt`: 지역 동의·ON 비교·선택한 OFF 시험 경로와 후보 실패 차단.
- `RemoteAccessibilityService.kt`, `WebRtcSession.kt`: 활성 후보의 좌표 입력 라우팅, 입력 해제, 기존 notice/inputError 전달. 글로벌 버튼/문자 입력/로그인/등록 프로토콜은 그대로다.
- `interaction/InteractionTrace.kt`: SHELL_TOUCH 분류. 버전 코드 22 → 23, 앱 이름/아이콘/패키지/서명 유지.
- `ShellTouchStateTest.kt`: 아래 자동 검증. 문서·로그·APK/검사 JSON을 함께 제출한다.

위 경로는 `android-client/app/src/main/java/com/galaxyremote/app/` 기준이며 AIDL은 같은 패키지의 `src/main/aidl`, 테스트는 `src/test`에 있다.

## 사용자가 진행할 순서

1. 이전 시험의 실제 패널 ON 복귀와 입력 해제를 확인한다. 원격 세션을 종료하고 **v23**을 업데이트한다. 기존 앱 삭제/데이터 초기화 금지.
2. Shizuku를 shell 방식으로 시작·권한 승인 후 **2번 서비스 연결**을 다시 한다. 앱 업데이트가 이전 daemon을 교체하므로 재연결이 필요하다.
3. 화면 ON·잠금 해제 상태에서 웹 연결을 유지한다. 시험 대상 앱에서 기존 접근성 입력이 정상인지 확인한다.
4. **3번 → 4번**을 진행한다. 실제 매핑/외부 복구는 별도로 검증된 경우에만 그 확인란을 체크한다. 새 후보 체크박스 **‘이번 비교에 Shizuku 직접 터치 후보 사용’**도 선택한다. 선택하지 않으면 기존 입력 방식이다.
5. **‘선택한 Shizuku 터치: 화면 ON에서 30초 비교’**를 누르고 승인한다. 웹에서 민감하지 않은 앱의 클릭·길게 누르기·드래그를 각각 한 번 확인한다. 앱 입력 경로 표시에 Shizuku 후보가 보여야 한다. ON에서도 실패하면 OFF로 진행하지 않는다. API 미지원/권한 거부는 경로를 추측해 실행하지 말고 그대로 보고한다.
6. 즉시 복구 또는 30초 종료 후 실제 화면·입력을 확인한다. **4번을 다시 수행**하고 기존 매핑/외부 복구 확인을 새로 한다. 직접 터치 후보 체크는 유지한다.
7. ON 비교가 실제로 동작했고 외부 복구·물리 매핑 조건도 충족된 경우에만 **30초 OFF**를 누른다. 확인 대화상자의 입력 경로가 **Shizuku 단일 직접 터치 후보**인지 본다. 5초 동안 시험할 앱으로 돌아간다.
8. 먼저 해당 앱의 단일 클릭·길게·드래그와 화면 내용 변화를 확인한다. 이어 홈·최근 앱을 별도로 본다. 입력과 최근 앱 미리보기를 하나의 성공으로 합치지 않는다. 후보로 멀티터치/복합 게임 입력을 시험하지 않는다.
9. 실제 복구 후 **‘입력·영상 진단 보기’**의 `shell touch` 상태·`lastFailure`, `SHELL_TOUCH` 행과 ON/OFF 각각 앱이 반응했는지를 보고한다. `API_ACCEPTED`만으로 성공 처리하지 않는다. 프레임 카운터만으로 실제 게임 영상 갱신을 판정하지 않는다.
10. 후보의 330초 시험은 막혀 있다. 실제 짧은 입력·영상·복구가 통과한 뒤 지원 범위를 확대할지 판단한다.

ON 비교도 기존 외부 복구/매핑 확인과 새 검사 조건을 공유한다. 그 조건이 검증되지 않았다면 확인란을 체크하거나 OFF로 진행하지 않는다. 임의로 권한을 추가하거나 인증·복구 게이트를 해제하지 않는다.

## 알려진 한계와 복구

- 새 직접 입력 경로는 **실제 Android/Galaxy에서 실행하지 않았다.** API 해석과 `INJECT_EVENTS` 권한/삼성 입력 정책이 모두 미검증이다. 준비 중 실패는 OFF 전에 중단하지만 API의 실제 허용은 ON 비교에서 확인해야 한다.
- 입력 API가 수락돼도 게임 반응/포커스/합성/실제 내용 갱신은 별도 관찰 대상이다. 기존 문제의 정확한 OS 원인이 확정된 것이 아니다.
- 최근 앱 미리보기 누락과 캡처 내용 문제는 **해결하지 않았다.** MediaProjection을 유지했으며 shell 캡처를 바로 WebRTC에 연결했다고 가정하지 않는다. 권한 있는 shell 비교에서도 입력과 최근 앱 문제가 남으면 입력 라우팅·합성·캡처를 분리한 후속 실험이 필요하다.
- 정상 종료·연결 해제·소유 앱 종료·deadline·포인터 heartbeat 때 CANCEL을 시도한다. 서비스 프로세스 강제 종료나 OS 거부까지 포함한 실제 해제 성공을 보장하지 않는다. 독립 화면 복구는 유지하되 터치 해제까지 증명하는 장치는 아니다. 비정상 종료 시험은 정상 단기 비교 통과 뒤 실제 외부 복구 경로를 확보한 상태에서 수행한다.
- 실기기 없이는 자동 복구/영상/입력/키보드/게임/열/배터리/지연 성능을 성공으로 판정하지 않는다. 클라우드에서 실제 터치나 OFF/ON 명령을 실행하지 않았다.

## 자동 검증 및 APK

[검증 JSON](assets/panel-shell-touch-trial/validation-summary.json)과 같은 폴더 로그, [공식 소스 URL·읽은 파일 해시](assets/panel-shell-touch-trial/source-references.json) 참조.

- Android 단위: **debug 64 + panelTest 64 = 128 PASS**, 실패·오류·skip 0.
- 추가 12개 순수 테스트: 동의/준비 전 거부, DOWN/MOVE/UP 좌표·downTime, 비정상/중복 down 취소, 동작·geometry 범위, 회전 변경 취소, 이전 토큰/해제 차단, 소유자/heartbeat/시간/stop 해제, 포인터 timeout, 유효 기간, 주입 거절, 후보 30초 제한, emitter 예외.
- 웹/API **94 PASS**, Python **12 PASS**, lint·TypeScript·웹 production 빌드·Worker 검증 PASS.
- arm64 panelTest, debug, unsigned release, debug instrumentation APK 빌드 PASS. instrumentation은 컴파일만 수행했다.
- APK 이름·arm64·패키지·v22 인증서 일치·16KiB 정렬 검사 PASS. 실제 설치/업데이트·UI·새 shell 경로·최근 앱·비정상 종료·브라우저 런타임은 미검증이다.

[APK 직접 다운로드](https://github.com/pashkite/phone-remote/raw/refs/heads/fix/linro-panel-help-preflight/qa-artifacts/panel-shell-touch-trial/Linro-panel-shell-touch-trial-arm64-paneltest.apk) · [파일 페이지](https://github.com/pashkite/phone-remote/blob/fix/linro-panel-help-preflight/qa-artifacts/panel-shell-touch-trial/Linro-panel-shell-touch-trial-arm64-paneltest.apk)

- versionCode **23**, versionName `0.5.6-panel-experiment`, package `com.galaxyremote.app.paneltest`, ABI arm64-v8a, 앱 이름 린로.
- SHA-256: `1d56424175dd28658a5e96c97f3e6e9ccad75860fd0bef2a0e6d94cc1a0f5d12`.
- 크기 16,463,160 bytes.
- 인증서 SHA-256: `8f568dd3778c9b0f8a316427c1a2e048a2f454f153a9b6d40dd3e4337dd0748f` (v22와 일치).

GitHub 접근 계정에서 Download raw file로 받는다. 비로그인 다운로드 여부는 미검증이다.

```powershell
$Apk = "$env:USERPROFILE\Downloads\Linro-panel-shell-touch-trial-arm64-paneltest.apk"
Get-FileHash -Algorithm SHA256 $Apk
adb install -r $Apk
```

서명/hash 불일치면 중단하고 기존 앱을 삭제하지 않는다. 동일 인증서/패키지 업데이트 정책을 유지했지만 실제 사용자 데이터 보존을 클라우드에서 확인한 것은 아니다.

## Git 범위와 판정

이전 커밋 `915bbf66bf7d8c1297c8154fdc3e132f68c7e141`에서 같은 `fix/linro-panel-help-preflight` 브랜치에 후속 수정한다. 기준 main은 여전히 `6971be1511de9131580bcfe505821de10d0509aa`다. main/master 병합·운영 배포·새 도메인·DB/인증 변경은 하지 않는다. PR API가 거부되면 브랜치와 커밋을 보고한다.

**CONDITIONAL GO: 새 입력 경로의 ON → 짧은 OFF 비교 후보. 전체 게임 플레이와 최근 앱 문제 해결 판정은 보류.**
