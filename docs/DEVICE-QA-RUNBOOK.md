# Galaxy Remote 2.0 — Windows·Galaxy 최종 실기기 QA

현재 판정: **CONDITIONAL GO**. 이 문서는 사용자가 수행할 절차다. 클라우드 개발 환경에서 실제 갤럭시 설치·화면 OFF·복구를 수행하거나 성공 판정하지 않았다.

**복구 경로와 해당 기기의 실제 패널 매핑이 충분히 검증되지 않았다면 패널 OFF 시험을 하지 마세요.** 화면 ON에서 복구 명령이 반환된 것만으로 OFF 후 복구가 검증된 것은 아니다. OFF를 건너뛰어도 나머지 QA는 진행할 수 있다.

## 1. 준비물과 먼저 확인할 조건

- Windows 10/11 PC, 신뢰하는 USB 케이블, arm64 Galaxy, 앱 설치/디버깅을 승인할 기기 소유자.
- Android 15/16·One UI 버전, 모델, 빌드 번호, 배터리/충전 상태를 기록한다. 업무 관리 기기의 제한은 우회하지 않는다.
- 시험 APK는 `com.galaxyremote.app.paneltest`; 운영 앱 `com.galaxyremote.app`을 삭제하지 않는다.
- **QA 웹 주소가 먼저 필요하다.** 6단계 브랜치를 운영 사이트에 자동 배포하지 않았다. APK도 기존 signaling URL/기존 등록 주소를 유지한다. 새 웹 전체를 시험하려면 검토된 QA 웹과 APK의 signaling origin이 일치하는지 담당자가 확인해야 한다. 검토되지 않은 주소를 allowlist에 넣거나 HTTPS 검사를 끄지 않는다.
- QA 웹이 준비되지 않았다면 APK 설치/표시/권한 점검까지만 진행한다. 기존 운영 사이트에서의 시험을 6단계 웹 검증으로 기록하지 않는다. 운영 데이터에 시험 기기를 등록하기 전 소유자가 범위를 결정한다.
- 다른 PC용 원격 제어 클라이언트는 필요 없다. 아래 ADB는 최초 개발 검증/복구에만 사용한다.

## 2. Windows용 ADB 설치

Google 공식 [SDK Platform Tools](https://developer.android.com/tools/releases/platform-tools) Windows ZIP을 내려받아 예를 들어 `C:\Android\platform-tools`에 푼다. 관리자 권한이나 추가 원격 제어 프로그램은 보통 필요하지 않다. 필요 시 삼성 공식 USB 드라이버를 사용한다.

PowerShell:

```powershell
$Adb = 'C:\Android\platform-tools\adb.exe'
& $Adb version
& $Adb devices -l
```

ADB 창에서 본 기기 일련번호는 외부 보고서에서 가린다. 여러 기기가 있으면 이후 모든 명령에 `-s $Serial`을 사용한다.

## 3. Galaxy USB 디버깅 설정

설정 → 휴대전화 정보 → 소프트웨어 정보 → 빌드 번호를 눌러 개발자 옵션을 켠다. 개발자 옵션에서 USB 디버깅을 켜고 PC 연결 후 RSA 지문을 확인해 기기에서 승인한다. 신뢰하지 않는 PC는 승인하지 않는다.

```powershell
& $Adb devices -l
$Serial = '목록에서 확인한 본인 기기의 ID'
& $Adb -s $Serial shell getprop ro.build.version.release
& $Adb -s $Serial shell getprop ro.build.version.sdk
```

`unauthorized`라면 휴대폰 승인을 확인한다. One UI 또는 관리 정책이 막으면 지원되는 설정 절차를 확인하고 중단 여부를 판단한다. 보안 정책 우회나 루팅은 하지 않는다.

## 4. APK 다운로드·무결성·설치

GitHub에서 저장소에 로그인 → `feature/galaxy-remote-2-integration-qa` 브랜치 → [시험 APK 파일](../qa-artifacts/stage6/GalaxyRemote-2.0-stage6-arm64-paneltest.apk) → **Download raw file**을 선택한다. 로컬 `/workspace` 경로에 접근할 필요가 없다.

[apk-info.json](../qa-artifacts/stage6/apk-info.json)과 [SHA256SUMS](../qa-artifacts/stage6/SHA256SUMS.txt)의 hash를 확인한다.

```powershell
$Apk = "$env:USERPROFILE\Downloads\GalaxyRemote-2.0-stage6-arm64-paneltest.apk"
Get-FileHash -Algorithm SHA256 $Apk
& $Adb -s $Serial install -r $Apk
```

`INSTALL_FAILED_UPDATE_INCOMPATIBLE`이면 **기존 앱을 삭제하거나 데이터 초기화하지 말고 중단**한다. 기존 시험 앱과 인증서를 비교해야 한다. 제공 파일은 기존 개발 환경의 debug 서명이며 운영 업데이트용이 아니다. 실제 업데이트/데이터 보존은 아직 미검증이다.

대안은 GitHub Actions → `Build and test Android APK` → Run workflow → 이 브랜치 선택 → `galaxy-remote-apk-build` 다운로드 → `panelTest/app-panelTest.apk`다. 보관 기간은 7일이다. 만료되면 재실행한다. Actions의 새 debug 키는 기존 설치와 다를 수 있다. 이번 세션에서는 Actions API가 Forbidden이어서 새 원격 실행 성공을 확인하지 못했다.

## 5. 운영 앱과 테스트 앱 구분

| 용도 | 이름 | 패키지/표식 |
|---|---|---|
| 기존 운영 앱 | Galaxy Remote 또는 Galaxy Remote 2.0 | `com.galaxyremote.app` |
| 이번 시험 앱 | Galaxy Remote 2.0 Test | `com.galaxyremote.app.paneltest`, 작은 앰버 점 |

```powershell
& $Adb -s $Serial shell pm list packages galaxyremote
```

제공 arm64 panelTest만 Galaxy용이다. CI의 debug x86_64 APK는 에뮬레이터용이며 release-unsigned는 서명 전 설치용이 아니다. package ID와 기존 키를 바꾸지 않았다. 브랜드는 이번 QA에서도 Galaxy Remote 2.0이다. 별도 Linro 브랜딩 결정은 최종 릴리스 전에 확인하며 임의 변경하지 않는다.

## 6. 테스트 앱 계정·기기 연결

검토된 QA 웹 주소/앱 origin 일치를 다시 확인한다. 웹에서 소유자 계정 로그인 → 새 기기 등록 → 6자리 코드 생성 → **Test 앱**에서 입력 → 웹에서 새 기기 등록 확인 순서다.

잘못된 코드, 만료, 재사용, 네트워크 중단을 각각 시험하고 기대 오류를 기록한다. 재사용 코드는 새 기기를 생성하면 안 된다. 다른 계정으로 바꾼 뒤 이전 기기가 보이거나 조작되면 중단한다. Sites의 실제 로그인/세션 만료는 별도 실환경 검증 항목이다.

시험 뒤 불필요한 기기는 웹 설정에서 **등록 해제**한다. 운영 기기와 구분한 이름을 사용한다. 기기 토큰/등록 코드를 화면 캡처나 공개 이슈에 올리지 않는다.

## 7. Android 권한 승인

앱 설명을 읽고 기기 소유자가 직접 승인한다.

- 접근성: Galaxy Remote 2.0 조작/해당 Test 앱 서비스인지 확인.
- 화면 공유: Android MediaProjection 확인창에서 현재 세션을 승인.
- 연결 요청 알림: 앱에서 요청 대기를 켜고 알림 권한 확인.
- 원격 키보드: 필요할 때만 켜고 선택. 개인정보/암호 입력은 시험하지 않는다.
- 오디오: 지원되는 경우 앱의 재생 소리 캡처 권한을 별도로 승인. 보호된 앱의 소리는 무음일 수 있다.

Shizuku 권한은 일반 연결의 필수 권한이 아니다. 패널 OFF 실험 전에만 별도로 다룬다. 권한 거절/철회 시 UI와 입력 중지를 확인한다.

## 8. 화면 ON 기본 연결

잠금 해제하고 화면 ON 상태에서 시작한다. 연결 요청 → 응답 대기 → 화면 공유 승인 → 협상 → 연결됨을 구분한다. 연결됨 표시만으로 영상 성공을 판정하지 않는다.

움직이는 테스트 화면에서 새 프레임, 브라우저 영상, 회전, 종료/재연결을 확인한다. 기기 선택을 바꾸면 이전 기기 연결이 종료돼야 한다. 사용 종료/로그아웃 뒤 이전 화면·입력이 남으면 실패다. 직접 연결/TURN/코덱은 측정 가능한 통계만 기록하고 확인 불가는 그대로 둔다.

## 9. 게임 입력 시험

먼저 테스트 화면이나 손실 위험이 없는 게임 메뉴에서 수행한다.

- 클릭, 1초 길게 누르기, 양방향 드래그: DOWN→MOVE→UP 관찰.
- WASD/방향키·대각선·이동+공격: 키를 놓으면 반드시 해제.
- 매핑 편집 중 실제 게임 입력 없음; 드래그/좌표/중복 키 경고 확인.
- 확대/회전 뒤 좌표, 설정창·모드 변경·포커스 상실·연결 종료 시 입력 해제.
- 멀티터치는 실험 옵션을 직접 켠 뒤 2개, 최대 5개 포인터의 추가/제거/CANCEL 시험. 미동의 기본값과 구분.
- 표준 게임패드→터치 매핑과 패드 제거 시험. Android 네이티브 게임패드가 아니다.

고착이 생기면 즉시 연결을 종료하고 로컬에서 앱을 복구한다. watchdog/취소 요청이 실제 게임에서 작동했다고 미리 가정하지 않는다. 실제 접근성 멀티터치 호환성은 게임별로 기록한다.

## 10. 소설·웹툰 시험

소설은 이전/다음, 휠·Page Up/Down·Space, 좌우 탭/스와이프, 반전, 사용자 키를 확인한다. 웹툰은 세로 비율·휠 감도·확대/Shift 이동·맞춤·전체화면·자동 도구 숨김을 확인한다.

자동 스크롤 시작/일시정지/재개/중지·속도·방향을 시험한다. 탭 숨김/다른 앱으로 초점 이동/네트워크 단절/연결 종료 후 **새 명령이 멈춰야** 한다. 개인 PC 저장/재읽기와 공용 PC 미저장을 확인한다. 자동 스크롤은 반복 스와이프이며 실제 페이지·독서 진도를 알지 못한다. DRM/FLAG_SECURE 차단은 우회하지 않는다.

## 11. 화질·FPS·지연·오디오 측정

720/1080/1440p와 24/30/60fps 요청, 자동/수동 전환을 시험한다. 1440p·열 상태·기기 성능에 따른 안전 제한과 실제 수신값을 구분한다. 60fps 선택이 실제 60fps 달성을 뜻하지 않는다.

- 수신 FPS/해상도/비트레이트/손실/RTT/드롭/디코딩/코덱/경로/발열 제한을 기록.
- 종단 지연은 PC 입력과 Galaxy/브라우저 반응이 함께 보이도록 별도 고속 촬영해 최소 30회 측정. 네트워크 RTT를 종단 지연으로 사용하지 않는다.
- 연결 전/후, 같은 Wi-Fi/가능한 다른 네트워크에서 기록. 유료 TURN을 자동 활성화하지 않는다.
- 오디오는 명시적으로 켜고 끄기, 권한 거부, 종료 후 무음/리소스 해제를 확인한다. 보호된 콘텐츠 제한을 기록한다.

100ms/60fps 목표는 실측 전 달성 판정하지 않는다. 측정 불가능한 값은 `미측정`이다.

## 12. Shizuku 설정

공식 [Shizuku 설정 안내](https://shizuku.rikka.app/guide/setup/)를 따른다. Android 11 이상 무선 디버깅의 사용자 승인형 시작 또는 공식 ADB 시작 절차를 사용한다. 루팅은 사용하지 않는다.

Test 앱의 화면 OFF 실험에서 Shizuku 권한 요청 → 기기에서 승인 → shell 서비스 연결을 수행한다. 구현은 UID 2000 shell만 지원한다. Shizuku가 꺼졌거나 권한이 거절됐으면 OFF를 시험하지 않는다. 재부팅 후 Shizuku 재시작/승인이 다시 필요할 수 있다.

## 13. 외부 패널 복구 경로 확인 — 필수 중단 지점

먼저 **읽기 전용**으로 조회한다.

```powershell
& $Adb -s $Serial shell cmd display help
& $Adb -s $Serial shell dumpsys display
```

실제 패널이 display 0인지 모델/펌웨어에서 확인한다. 접이식/다중 디스플레이에서 다른 ID라면 현재 시제품은 지원하지 않으므로 OFF를 건너뛴다. 명령 이름은 펌웨어별로 다르다. help에 `power-off`와 `power-reset` 또는 `power-on`이 없다면 OFF 미지원으로 기록한다.

화면 ON에서, help가 지원하는 **복구 명령만** 별도 ADB 창에서 확인한다. 두 명령을 무작정 실행하지 않는다.

```powershell
# help에서 power-reset을 지원하는 경우에만, 화면 ON에서 복구 명령 확인
& $Adb -s $Serial shell cmd display power-reset 0
# power-reset 대신 power-on을 지원한다면 위 명령 대신 다음을 사용
# & $Adb -s $Serial shell cmd display power-on 0
```

이 성공은 OFF 후 물리 복구의 증거가 아니다. 외부 ADB 경로, 케이블 유지, 로컬 물리 복구 방법, 담당자의 해당 기기/펌웨어 복구 검증 기록을 확보한다. **충분한 복구 검증 기록이 없다면 14/15번은 BLOCKED로 남긴다.** 강제 재부팅은 최후 복구 수단일 수 있으나 세션·게임 진행을 잃을 수 있다. 사용자 데이터 삭제/초기화 명령은 사용하지 않는다.

## 14. 30초 패널 OFF 시험 — 조건 충족 후 사용자만 실행

이번 개발 세션에서는 실행하지 않았다. 위 복구/패널 매핑이 충분히 확인됐고, 화면 ON 영상·입력 시험이 통과한 경우에만 진행한다.

외부 복구 ADB 창을 준비한 상태에서 Test 앱 → 실험 → 명령 조회 → 화면 ON 복구 사전 검사 → 실제 외부 복구 검증 확인 → **30초 시험**을 선택한다. 승인 후 5초 지연이 있으므로 홈을 통해 게임으로 돌아간다. 뒤로 가기로 실험 Activity를 종료하면 예약이 취소될 수 있다.

직접 눈으로 실제 패널 전원 OFF를 확인한다. 검은 화면/밝기 최소/오버레이는 성공이 아니다. PC에서 새 게임 프레임·입력·게임 실행이 계속되는지 확인하고 30초 후 물리 복구를 확인한다. 잠금과 패널 OFF를 구분한다. 화면 전송이 멈추면 실패로 기록하고 준비된 복구 절차를 사용한다.

## 15. 장시간 패널 OFF 시험

30초 시험과 실제 복구가 통과한 뒤에만 새 사전 검사·새 로컬 승인을 거쳐 **330초 시험**을 사용한다. 5분 이상 영상의 새 프레임, 실제 입력, 게임 실행, 발열, 프레임/지연 변화를 기록한다. 제한 시간을 늘리거나 안전 장치를 바꾸지 않는다.

일반 MediaProjection이 중단되면 실패/제한으로 남긴다. shell 캡처 대안은 별도 구현 과제이며 기존 WebRTC에 이미 연결된 기능이 아니다.

## 16. 연결 종료·오류 복구

각 상황을 **화면 ON에서 먼저**, 이후 자격이 된 OFF 시험에서 개별 확인한다.

- 정상 종료, 기기 변경, 로그아웃, 브라우저 닫기/탭 숨김.
- 네트워크 단절, Peer 실패/일시 단절, 접근성 권한 해제.
- Shizuku 권한 거절/중단, 앱 정상 중지, 앱 프로세스 종료.

앱·shell 서비스는 연결/heartbeat/Binder/타이머에 따라 복구를 요청한다. 요청/명령 반환을 실제 복구 성공으로 기록하지 않는다. 독립 shell 자식이 Shizuku 종료 후 생존하는지도 기기별 미검증이다. 필요한 실패 시험의 강제 종료는 소유자가 로컬에서 범위를 확인한 뒤 실행한다. 시험을 묶어 한 번에 여러 경로를 끊지 않는다.

## 17. 재부팅 후 절차

설치/계정/기기 등록/프로필 보존을 먼저 확인한다. USB/Wireless ADB 승인을 확인하고 Shizuku를 다시 시작한다. 화면 공유·알림/접근성·키보드 상태를 직접 확인한다. 패널 OFF는 이전 승인으로 재사용하지 않고 실제 복구 경로·사전 검사·로컬 동의를 다시 진행한다. 자동으로 OFF가 되면 실패다.

## 18. 오류 로그 수집

개인 폴더에 저장한다. 실기기 검증 전 앱 토큰이나 저장소 전체를 덤프하지 않는다.

```powershell
New-Item -ItemType Directory -Force .\qa-private | Out-Null
& $Adb -s $Serial logcat -d -v threadtime > .\qa-private\logcat.txt
& $Adb -s $Serial shell dumpsys accessibility > .\qa-private\accessibility.txt
& $Adb -s $Serial shell dumpsys activity activities > .\qa-private\activities.txt
& $Adb -s $Serial shell dumpsys input > .\qa-private\input.txt
& $Adb -s $Serial shell dumpsys display > .\qa-private\display.txt
```

앱/웹의 진단 내보내기를 우선 사용하고, 전체 logcat은 필요한 경우만 수집한다. Android 16 드래그 문제는 emulator debug/instrumentation 전용 시험이다. 현재 arm64 Test APK에 instrumentation을 실행하는 시험과 혼동하지 않는다.

Android SDK/JDK17/Gradle8.11.1과 API36 x86_64 에뮬레이터가 있는 개발 PC/CI에서:

```text
gradle -p android-client :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.galaxyremote.app.LiveTouchTest
```

접근성 연결, probe run ID/lifecycle/focus, DOWN/MOVE/UP/CANCEL, dispatchGesture callback과 JUnit 실패를 같이 수집한다. timeout/assertion을 완화해 통과시키지 않는다. CI의 `galaxy-remote-android16-test-reports`는 7일 보관한다.

## 19. 개인정보가 포함된 로그 처리

이메일·기기 일련번호·Bearer/device token·페어링 코드·SDP/ICE(IP/자격정보)·알림/클립보드/입력 텍스트·화면 내용을 가린다. 전체 logcat/dumpsys/녹화는 민감한 정보가 있을 수 있다. 공개 GitHub 이슈/PR에 원본을 첨부하지 않는다. 필요한 최소 구간만 검토 후 공유하고 로컬 원본은 소유자의 보관 정책에 따라 삭제한다.

CI emulator 로그도 사용자 계정 로그인 없이 fixture로 수집한다. 실제 계정/토큰을 CI secret 없이 테스트 코드나 artifact에 넣지 않는다.

## 20. 성공/실패 기록과 다음 단계

[DEVICE-QA-RESULTS-TEMPLATE.md](DEVICE-QA-RESULTS-TEMPLATE.md)를 복사해 모델/OS/One UI/펌웨어/APK hash/웹 commit/origin/네트워크를 기입한다. 항목마다 `PASS / FAIL / BLOCKED / 미검증`과 실제 근거를 남긴다.

동의·복구·실제 패널·새 프레임·입력·5분·정상/비정상 복구를 모두 확인해야 해당 조건의 OFF 성공이라고 할 수 있다. 모의 테스트나 명령 반환으로 대체하지 않는다. P0/P1 증상이 있으면 중단하고 재현 로그를 검토한다. QA 완료 후 불필요한 테스트 등록/권한/USB 디버깅은 소유자의 사용 계획에 따라 정리한다.
