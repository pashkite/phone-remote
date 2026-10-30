# 린로 — 물리 패널 OFF 사전 검사 오류 수정

후속 업데이트: [4번 수락 이후 OFF 상태 추적 수정 · v21](PANEL-RECOVERY-STATE-FIX.md). 아래 v20 APK와 검사 결과는 이전 버전 기록입니다.

판정: **CONDITIONAL GO — 수정 APK로 실기기 사전 검사 재확인 필요**. 자동화에서는 문제를 재현하고 수정했지만 실제 Galaxy·Shizuku·패널 OFF·복구·상단 여백은 이 환경에서 실행 검증하지 않았다. 연결된 실기기는 0대다.

## 기준과 원인

- 시작 시 최신 `main`: `6971be1511de9131580bcfe505821de10d0509aa`
- 수정 브랜치: `fix/linro-panel-help-preflight`
- 코드 커밋: `336a534` — 도움말/제어 분리·실패 시 차단·회귀 검사.
- 여백 보완: `e5ab5a5` — 스크롤 중에도 시스템 바 인셋 영역으로 내용이 그려지지 않게 처리.
- `main` 자동 병합·운영 배포·DB·계정 인증·허용 origin·패키지 ID·서명 정책 변경은 하지 않는다.

기존 `PanelService.inspect()`는 `cmd display help`를 제어 명령과 같은 `run()`으로 실행했다. 이 함수는 종료 코드가 0이 아니면 도움말의 첫 240자만 포함한 `COMMAND_FAILED`를 던졌다. Android ShellCommand가 정상 도움말을 출력하고 `-1`을 반환하면 명령 목록을 읽기 전에 중단됐다. 실제 프로세스/ADB에서는 이 값이 `255`로 관찰될 수도 있다.

같은 검사에서 `power-off` 또는 복구 명령이 없으면 전체 조회를 예외로 끝냈고, Activity가 논리 화면 정보와 원격 조회를 하나의 문자열로 합치던 구조 때문에 화면 ID/상태도 오류에 가려졌다. 기존 PC용 `panel-preflight.py`도 도움말에 엄격한 종료 코드 검사를 적용하는 같은 문제가 있었다.

## 수정한 동작

1. `PanelService`의 조회는 **출력·종료 코드·타임아웃·잘림·전송 오류**를 각각 수집한다. 정상적인 도움말을 종료 코드만으로 실패 처리하지 않는다. 실제 전원 제어는 별도 `control()`에서 종료 코드 0과 오류 없는 완료를 계속 요구한다.
2. `PanelPreflight`는 전체 수집된 도움말의 명령 선언 줄을 검사한다. 정확한 `power-off`, `power-reset`, `power-on`을 찾고 설명 문장·`power-off-extra` 같은 접두 일치는 제외한다. Android 도움말 헤더/목록이 없거나 읽기 실패·권한 오류·시간 초과·잘림이면 지원 미확인으로 처리하고 OFF를 차단한다.
3. 도움말과 `dumpsys display`를 독립적으로 수집한다. Activity의 앱 수준 논리 화면 ID/상태/잠금 정보도 별도 TextView에 먼저 표시하므로 Shizuku 조회 실패에 가려지지 않는다. **논리 display 상태는 물리 패널 매핑/전원 증명이 아니다.**
4. 4번은 현재 도움말에서 확인된 복구 후보만 사용한다. 둘 다 있으면 `power-reset`, 그것이 없고 `power-on`만 있으면 구형 `power-on`을 사용한다. 선택한 명령 실패 후 다른 명령을 추측하여 시도하지 않는다. 화면이 잠겼거나 display 0이 논리 ON이 아니면 Activity에서 사전 검사를 차단한다.
5. 새 조회를 시작할 때 이전 복구 검사/동의를 무효화한다. OFF에는 지원 목록 확인, 성공한 복구 명령 사전 검사, 기존 `PanelLease`, 외부 복구 검증에 대한 사용자 확인, 실제 WebRTC 연결을 모두 요구한다. 필요한 명령 하나라도 없으면 OFF는 지원 불가다. 복구 명령만 있으면 ON 사전 검사를 할 수 있지만 OFF는 계속 차단한다.
6. 정상 도움말/명령 미지원/권한 거부/서비스 미연결/실제 명령 실패를 짧은 한국어 상태로 구분한다. **전체 진단 보기**에서 원래 도움말과 exitCode, 화면 상태 결과, 제어 명령 결과/예외를 확인할 수 있다. Android 명령 출력은 명령당 64KiB까지 보관하며, 잘리면 그 사실을 기록하고 OFF를 차단한다.
7. Shizuku UserService 버전을 고정 1에서 APK versionCode로 바꿨다. APK 업데이트 후 오래된 daemon 코드가 재사용되어 이전 버그가 남는 것을 피하기 위한 변경이다. 현재 시험 APK는 **20**이다.
8. `WindowInsetsCompat`로 상태 표시줄·컷아웃·하단/키보드 인셋을 적용하고 dp 여백을 추가했다. ScrollView는 인셋 패딩 안쪽으로 내용을 제한하므로 스크롤 중 상단 내용이 시스템 바 영역으로 그려지지 않는다.

임의 shell 실행 인터페이스, 루팅·권한 우회·추측한 대체 명령은 추가하지 않았다. AIDL 메서드·고정 display 0·타이머 범위·독립 복구 프로세스·포인터 해제 원칙은 유지했다. 서버 제어 경로는 내부 enum의 고정 명령만 사용한다.

## 자동화 결과

[요약 JSON](assets/panel-preflight-fix/validation-summary.json) · [웹](assets/panel-preflight-fix/web.log) · [Android](assets/panel-preflight-fix/android.log) · [Python](assets/panel-preflight-fix/python.log) · [APK 서명 검사](assets/panel-preflight-fix/apk-verification.log)

| 요청 사례 | 자동화 결과 |
|---|---|
| 정상 도움말, exit 0 | PASS: 지원 목록/원문/exit 기록, 조회 중 전원 명령 없음 |
| 정상 도움말, exit -1 / 255 | PASS: 정상 목록으로 판정. 실제 제어의 비정상 종료는 계속 실패 |
| 명령 목록 없음·권한 오류·잘림/시간 초과 | PASS: 지원 미확인, OFF 차단 |
| `power-reset` 지원 | PASS: 확인된 reset만 선택 |
| 구형 `power-on` 지원 | PASS: reset이 없을 때 광고된 on만 선택 |
| OFF/복구 중 하나 없음 | PASS: OFF 차단. 미지원과 조회 불가 구별 |
| Shizuku 미실행·권한 거부·root UID | PASS: 공유 접근 정책의 거부 경계 단위 테스트 |
| 서비스 미연결·연결 실패 | PASS: 서비스 접근 거부 및 연결 오류 한국어 매핑 단위 테스트 |
| 실제 제어 명령 실패 | PASS: 모의 비정상 exit/권한 오류/timeout 결과를 실패 처리, 대체 복구 명령 시도 없음 |
| 복구 검증 전 OFF | PASS: 기존 lease·로컬 확인·새 조회 무효화·일회성 게이트 유지 |

위 표는 **모의 실행기를 사용하는 JVM/Python 자동화**다. 실제 Shizuku의 연결/거부 callback, 실제 shell 명령 또는 물리 복구를 기기에서 수행한 결과가 아니다.

- Android 단위 테스트: **debug 40 + panelTest 40 = 80 PASS**, 실패/오류/skip 0. 기존 46개를 유지하고 34회를 추가했다.
- 웹/API: **94 PASS**, 실패/skip 0. 기존 인증·세션·입력 검사 유지.
- Python: **12 PASS**, 기존 8개 유지 + 4개 추가.
- 전체 lint, TypeScript, 웹 production 빌드, Worker 검증: PASS.
- arm64 panelTest, x86_64 debug, arm64 unsigned release, debug instrumentation APK 및 unsigned release AAB: 빌드 PASS.
- 기존 Android 16 드래그 등 instrumentation은 **컴파일만**, 런타임 미검증.
- 이번 Android 버그 수정에서 웹 브라우저/네이티브 WebRTC 시험은 다시 실행하지 않았다. 기존 환경의 네이티브 WebRTC 제한과 실기기 미검증을 통과로 바꾸지 않는다.

## APK 다운로드·업데이트

[APK 다운로드 페이지](https://github.com/pashkite/phone-remote/blob/fix/linro-panel-help-preflight/qa-artifacts/panel-preflight-fix/Linro-panel-preflight-fix-arm64-paneltest.apk) · [직접 다운로드](https://github.com/pashkite/phone-remote/raw/refs/heads/fix/linro-panel-help-preflight/qa-artifacts/panel-preflight-fix/Linro-panel-preflight-fix-arm64-paneltest.apk)

저장소에 접근 가능한 계정으로 로그인한 뒤 **Download raw file**을 선택한다. 비로그인 공개 다운로드는 미검증이다. [APK 검사 JSON](../qa-artifacts/panel-preflight-fix/apk-info.json), [SHA256SUMS](../qa-artifacts/panel-preflight-fix/SHA256SUMS.txt).

- 표시 이름: **린로**, 기존 BETA 아이콘 유지.
- package: `com.galaxyremote.app.paneltest`, ABI `arm64-v8a`.
- versionCode **20**, 이전 시험 APK 19보다 증가.
- versionName `0.5.3-panel-experiment`, 서명·package 정책 유지.
- APK v2 서명 및 16KiB ZIP 정렬 검사 PASS. 기존 19번 APK와 인증서 집합 일치.
- 크기: `16,407,574` bytes.

APK SHA-256:

```text
21c1a170bfbf9edccf4a8caa737486133fafeef96c46e0c56ff74c685620a510
```

서명 인증서 SHA-256:

```text
8f568dd3778c9b0f8a316427c1a2e048a2f454f153a9b6d40dd3e4337dd0748f
```

**먼저 실제 패널이 ON이고 이전 OFF 시험이 종료·복구됐는지 직접 확인한다.** 원격 세션을 종료하고 업데이트한다. 기존 앱 삭제/데이터 초기화는 하지 않는다.

```powershell
$Apk = "$env:USERPROFILE\Downloads\Linro-panel-preflight-fix-arm64-paneltest.apk"
Get-FileHash -Algorithm SHA256 $Apk
adb install -r $Apk
```

여러 기기가 있으면 `adb -s 본인기기ID install -r $Apk`를 사용한다. hash 불일치 또는 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`이면 중단하고 기존 앱을 삭제하지 않는다. 비교는 저장소의 기존 시험 APK와 수행했으며 사용자 기기에 설치된 인증서/실제 데이터 보존은 미검증이다.

## Galaxy에서 우선 재확인할 절차

1. 설정의 앱 버전 코드가 **20**인지 확인한다. 기존 등록·권한 설정을 유지한 채 업데이트했는지 확인한다.
2. 실험 화면에서 상단 제목이 상태 표시줄 아래에 있고 맨 아래 진단 버튼도 시스템 바에 가리지 않는지 확인한다. 스크롤·회전에서도 확인한다.
3. Shizuku를 공식 사용자 승인 절차로 시작하고 권한 승인 → **2번 서비스 연결**을 다시 한다. 버전 갱신된 shell 서비스가 연결된 상태에서 진행한다.
4. **3번 조회**를 누른다. 논리 화면 ID/상태와 명령 지원이 각각 표시되어야 한다. 도움말 exit가 -1/255여도 정상 목록이면 지원 판정이 표시되어야 한다. 명령이 없거나 미확인이면 OFF는 중단한다.
5. **전체 진단 보기**에서 help exitCode/전체 수집 출력, `dumpsys display` 결과를 확인한다. `power-reset` 또는 구형 `power-on` 후보가 실제 선언 목록에 있는지 확인한다.
6. 기기 잠금 해제·display 0 논리 ON 상태에서 **4번 사전 검사**를 누른다. 확인된 복구 명령만 실행돼야 하며 실제 명령 실패는 오류로 남아야 한다. 사전 검사 수락은 **OFF에서의 실제 복구 성공이 아니다.**
7. 이번 오류 재검증은 3·4번까지만으로 수행할 수 있다. OFF 버튼에는 WebRTC 연결과 외부 복구 검증 확인도 필요하다. **외부 복구와 물리 매핑이 충분히 검증되지 않으면 확인 체크/OFF 실행을 하지 않는다.**
8. 실제 OFF 자격이 갖춰진 경우에만 기존 [실기기 runbook](DEVICE-QA-RUNBOOK.md)의 30초→실제 복구→330초 순서를 따른다. 이 수정으로 하드웨어 OFF·캡처 유지·게임 입력·자동 복구가 검증됐다고 가정하지 않는다.

## GitHub 결과

[main과 비교·PR 생성](https://github.com/pashkite/phone-remote/compare/main...fix/linro-panel-help-preflight?expand=1). 새 브랜치 푸시 후 PR 생성을 시도했지만 GitHub GraphQL API가 `Forbidden`을 반환했다. **PR 생성 완료는 확인하지 못했다.** [실제 API 실패 기록](assets/panel-preflight-fix/pr.log)을 남겼으며 브랜치와 최종 커밋을 제출한다. main 자동 병합과 운영 배포는 하지 않았다. [수정 파일 목록](assets/panel-preflight-fix/modified-files.txt)에 코드·테스트·APK·증거 파일을 기록한다.

실기기 결과가 없는 항목은 계속 **미검증**이다. 지원하지 않는 펌웨어를 지원한다고 만들거나 안전 게이트를 완화한 수정이 아니다.
