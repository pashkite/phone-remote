# 린로: 4번 수락 이후 OFF 사전 검사 상태 추적

후속: [패널 OFF 입력·영상 진단 v22](PANEL-OFF-INPUT-DIAGNOSTICS.md). 아래 v21 자료는 이전 버전 기록입니다.

## 확인한 사실과 한계

사용자 Galaxy 진단에는 정상 도움말(exit 255)에 `power-off`·`power-reset`이 있고, display 0은 내장 화면 ON, WebRTC 가상 화면은 display 0을 미러링한다. 사용자는 4번에서 명령 수락 메시지도 확인했다. `DisplayControl.turnOff()`의 `RECOVERY_NOT_VERIFIED`는 해당 요청이 **실제 OFF 명령 전에 차단**됐다는 뜻이다. 그 이전의 다른 OFF 요청 여부까지 증명하지는 않는다.

기존 코드는 재조회·서비스/권한 변경·WebRTC 해제·복구 요청 시 검사 상태를 해제하지만, 이유를 기록하지 않았다. 3번 조회로 최근 4번 진단을 덮어쓰기도 했다. 따라서 **이번 실기기에서 어떤 사건이 상태를 해제했는지는 아직 미확정**이다. 5초 지연과 비동기 처리가 있는 경로는 모의 테스트로 검증했으며 실제 Galaxy 재현 성공을 주장하지 않는다.

`dumpsys display`의 길이 제한은 명령 지원이나 복구 사전 검사를 막는 조건이 아니다. 이번에는 이를 조회 실패 대신 **일부 조회 완료**로 표시한다. 실제 제어 명령은 계속 exit 0, 시간 초과·잘림·권한 오류 없음 조건을 요구한다.

## 변경

- `PanelTrialGate.kt`: 검사 세대 번호·일회성 상태·최근 16개 상태 변경을 기록한다. 연결 해제 등 검사 중 발생한 사건 뒤에 늦게 도착한 성공 응답은 OFF를 허용하지 않는다.
- `DisplayControl.kt`: 최근 4번 결과와 최근 조회/오류를 별도로 보존한다. 전체 진단 맨 위에 상태와 해제 이유를 표시한다. 예약은 사용자가 확인한 검사 세대와 일치해야 하며, 이후 새 검사를 해도 오래된 예약은 실행되지 않는다.
- `PanelExperimentActivity.kt`: 검사 중과 OFF 확인·5초 대기 중에 중복 설정 조작을 막는다. 즉시 복구는 예약을 무효화한다. Activity 종료도 아직 예약된 요청을 무효화한다. 게임으로 이동하는 일반 onPause에서는 원래 5초 대기를 유지한다.
- `PanelPreflight.kt`·`PanelService.kt`: 길이 제한으로 잘린 상태 진단을 명령 실패와 구별한다.
- 테스트 앱 versionCode 20 → **21**, versionName **0.5.4-panel-experiment**. 기존 패키지·브랜드·아이콘·서명·인증·등록·시그널링 유지.

연결 해제 시 복구, 외부 복구 확인, 물리 매핑 확인, shell 권한, 명령 지원·사전 검사, 제한 시간, 입력 해제 조건을 완화하지 않았다. 새 shell 명령·화면 ID·임의 명령 API를 추가하지 않았다. 실제 OFF에서의 복구 수락·타이머 생존·영상/입력 유지는 여전히 미검증이다.

## 자동 검증

[기계 판독 결과](assets/panel-recovery-state-fix/validation-summary.json)와 같은 폴더의 로그 참조.

| 항목 | 결과 |
|---|---|
| Android JVM | debug 46 + panelTest 46 = **92 PASS**, 실패·오류·skip 0 |
| 추가 회귀 검사 | 수락 후 해제, 5초 대기 중 해제 후 재검사, 늦은 성공 응답, 재조회/복구/취소/권한/서비스 해제, 이력 상한, help 255 + 잘린 상태 진단 |
| 기존 웹/API | **94 PASS** |
| Python | **12 PASS** |
| TypeScript·웹 production 빌드·Worker 검증·lint | PASS |
| panelTest·debug·unsigned release·debug instrumentation APK | 빌드 PASS |
| 패키지·이름·arm64·기존 v20 인증서 일치·16KiB 정렬 | PASS |
| Android UI·Shizuku callback·실제 설치/업데이트·브라우저 런타임 | 이번 실기기 검증 미실시 |
| 물리 패널 OFF·실제 복구·캡처/게임/입력 유지 | **미검증** |

JVM 테스트는 모의 상태 전이와 모의 명령 결과이며 물리 제어를 실행하지 않았다. 클라우드에 연결된 ADB 기기는 없다. 사용자 원본 진단의 기기 식별자/UID를 저장소에 복사하지 않았다.

## APK와 업데이트

[APK 직접 다운로드](https://github.com/pashkite/phone-remote/raw/refs/heads/fix/linro-panel-help-preflight/qa-artifacts/panel-recovery-state-fix/Linro-panel-recovery-state-fix-arm64-paneltest.apk) · [파일 페이지](https://github.com/pashkite/phone-remote/blob/fix/linro-panel-help-preflight/qa-artifacts/panel-recovery-state-fix/Linro-panel-recovery-state-fix-arm64-paneltest.apk)

저장소에 접근 가능한 계정에서 Download raw file을 선택한다. 비로그인 다운로드는 미검증이다.

- package `com.galaxyremote.app.paneltest`, 표시 이름 린로, ABI `arm64-v8a`.
- SHA-256: `4677a91bca3716b8470ad4f261a3b75c0bed10299b2c3113e614cf5167106ce0`.
- 인증서 SHA-256: `8f568dd3778c9b0f8a316427c1a2e048a2f454f153a9b6d40dd3e4337dd0748f` (v20과 일치).
- 크기 16,428,387 bytes. [APK 검사 JSON](../qa-artifacts/panel-recovery-state-fix/apk-info.json).

실제 패널이 ON이고 이전 시험이 종료·복구됐는지 직접 확인한 뒤 세션을 종료하고 업데이트한다. 기존 앱 삭제·데이터 초기화 금지. Windows에서는 다운로드 파일을 실행해 업데이트하거나:

```powershell
$Apk = "$env:USERPROFILE\Downloads\Linro-panel-recovery-state-fix-arm64-paneltest.apk"
Get-FileHash -Algorithm SHA256 $Apk
adb install -r $Apk
```

서명 불일치나 hash 불일치면 중단하고 앱을 삭제하지 않는다. 서명 일치는 저장소 v20 APK와 비교한 결과이며 실제 기기에 설치된 APK나 데이터 보존을 직접 확인한 결과가 아니다.

## 재시험 순서

1. 앱 버전 코드 **21**을 확인한다. Shizuku 실행·권한 승인 후 **2번 서비스 연결**을 다시 한다.
2. 화면 ON·잠금 해제 상태로 웹에서 WebRTC 연결을 먼저 유지한다.
3. **3번 조회 → 4번 사전 검사** 순서로 진행한다. 4번 이후 3번을 다시 누르면 새 4번 검사가 필요하다.
4. OFF를 누르지 않고도 상태 추적을 확인할 수 있다. 수락 후 3번 재조회 또는 웹 연결 해제를 하면 화면에 해제 이유가 나타나야 한다. 전체 진단에는 과거 4번의 `recovery preflight: power-reset 0` 결과도 남아야 한다.
5. 연결 복원 후 새 4번 검사를 한다. **외부 복구와 실제 패널 매핑을 별도로 검증하지 않았다면 확인 체크·OFF를 하지 않는다.** 명령 수락만으로 외부 복구 검증을 대신할 수 없다.
6. 자격을 갖춘 경우에만 30초 시험을 확인한다. 5초 대기 중 설정/재시험 버튼은 잠겨야 한다. 취소하려면 즉시 복구를 누른다. 연결 변경이 발생하면 기존 예약은 차단되어야 한다.
7. 다시 차단되면 긴 원문 전체 대신 진단 맨 위 **복구 사전 검사 상태·상태 변경 이력**과 최근 4번 결과의 exitCode를 전달한다. 현재 상태/해제 이유가 재현 원인을 좁히는 근거가 된다.
8. 이후 실제 패널·새 영상 프레임·게임·입력·정상/비정상 복구를 [기존 runbook](DEVICE-QA-RUNBOOK.md)으로 확인한다. 30초 성공·실제 복구 확인 전 330초 시험 금지.

## 제출 범위

기존 `fix/linro-panel-help-preflight` 브랜치에 후속 수정한다. 기준 main은 `6971be1511de9131580bcfe505821de10d0509aa`이며 이전 수정은 `2e92cc8a7ee166e14a040b6084e57e264939f523`이다. main/master 병합 및 운영 배포는 수행하지 않는다. PR API 접근이 거부되면 브랜치·커밋과 비교 링크를 보고한다.
