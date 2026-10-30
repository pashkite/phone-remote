# 린로(Linro) — 7단계 실기기 검증 준비 결과

판정: **CONDITIONAL GO**. arm64 시험 APK와 Windows·Galaxy 시험 절차를 준비했다. **7단계 QA 웹은 아직 생성·배포하지 않았고 실제 Galaxy 검증은 수행하지 않았다.** APK 설치·표시·권한 점검은 진행할 수 있지만, 새 웹 전체 연결 시험은 웹/APK의 서버 일치를 먼저 해결해야 한다. 물리 패널 OFF는 별도의 안전 게이트를 통과해야 한다.

- 저장소: `pashkite/phone-remote`
- 기준: `feature/galaxy-remote-2-integration-qa`, `b4a35e622aee65348da65c2989cd331771cbfa14`
- 결과 브랜치: `feature/linro-device-test-preparation`
- 코드 커밋: `462c5c3`(브랜딩·APK·origin 검증), `771bbae`(구버전/비 JSON 웹 응답 안내)
- 이 보고서와 APK를 포함한 최종 커밋 SHA는 GitHub 브랜치 및 제출 응답에서 확인한다.

## 1. 이름·아이콘 및 보존 사항

한국어 **린로**, 영문 **Linro**, 뜻 **Link Road**를 적용했다. 웹 제목은 `린로 | Linro`, PWA·웹 UI·Android 런처·앱 내부·알림·접근성/키보드 표시 문자열도 일치시켰다. 시험 앱도 런처 이름은 **린로**이며 아이콘의 **BETA**로 구별한다.

승인 자료를 먼저 조사하여 `assets/linro-brand-reference`의 `3f853b455594d14e26565e789dbc56124c4bae10`에서 두 검지손가락 참조를 찾았고, 사용자가 이번 대화에 제공한 이미지와 대조했다. 다른 심벌로 대체하지 않았다. [참조·출처](../assets/brand/linro/APPROVED-HANDOFF.md), [기계 판독 출처](../assets/brand/linro/identity.json)를 보존했다.

**원본 제공 한계:** canonical 1024px PNG/ZIP의 실제 파일 바이트에는 접근하지 못했다. 웹·legacy 아이콘은 승인된 256px WebP 참조에서 내보냈으며 512px 파일은 확대본이다. SVG는 래스터를 포함하는 래퍼로 순수 벡터가 아니다. Android adaptive foreground는 사용자가 제공한 이미지에서 생성한 투명 배경 파생본이다. 원본과 비트 단위 일치 또는 완전한 벡터 복원으로 표시하지 않는다. 원본 품질의 최종 납품에는 canonical PNG/ZIP 제공이 필요하다. [브라우저 아이콘·마스크 확인 이미지](assets/stage7/linro-icons-and-masks.png)를 남겼으며 실제 One UI 런처·테마 아이콘은 미검증이다.

저장소명, 운영/시험 Android package ID, 기기 등록·인증·시그널링 기본 프로토콜, 기존 서명 설정을 유지했다. 기존 데이터베이스·운영 APK·운영 배포 설정·패널 OFF 서비스/AIDL은 변경하지 않았다. `main`, `master`, 기준 브랜치와 브랜드 참조 브랜치는 푸시 대상이 아니다.

## 2. 테스트 웹과 APK의 실제 연결 준비 상태

| 항목 | 확인 결과 |
|---|---|
| APK 신규 등록 기본 origin | `https://galaxy-remote-control.ashkite.chatgpt.site` (기존 값 유지) |
| 기존 허용 origin | 위 주소 및 `https://remote.ashkite.kro.kr` (기존 두 주소만 유지) |
| 이미 등록한 앱의 origin | 저장값 유지. 연결 기기가 없어 실제 저장값은 미확인 |
| 현재 운영 사이트의 실제 배포 커밋·가용성·로그인 | **미검증** |
| 새 QA 웹 주소 | **미준비**, 생성·배포하지 않음 |
| 실제 Sites 계정 등록→연결→해제 | **미검증**. 로컬 자동화의 인증·기기 API 검증과 구분 |
| 웹/Android 소스 호환 | 기존 등록·세션·입력 메시지 형식 유지, control protocol 1. 실환경 호환은 미검증 |

환경의 outbound 정책이 위 두 호스트를 허용하지 않고 Sites 관리 도구도 제공되지 않았다. GitHub deployments 조회도 `Forbidden`으로 거부되어 실제 배포 상태를 확정할 수 없다. 이 결과는 사이트 장애나 미배포의 증거가 아니다. [관찰 기록](assets/stage7/deployment-observations.json)과 [API 조회 결과](assets/stage7/deployments.log)를 보존했다. 정책을 우회하거나 임의 도메인을 허용하지 않았다.

새로운 읽기 전용 `/api/build-info`는 **기존 Sites 소유자 인증**을 요구하며 `buildId=linro-device-test-stage7`, `protocolVersion=1`, 요청 origin, `physicalDeviceVerified=false`를 반환한다. `no-store`이며 토큰·등록 코드·DB 값을 노출하거나 변경하지 않는다. 웹 설정의 **테스트 연결 정보**와 Android **전송·대기·진단 → 테스트 연결 정보**에서 빌드/origin을 비교한다. 웹은 타임아웃·로그인 만료·잘못된 빌드·HTML 응답을 오류로 표시한다. 이 부가 진단 API는 기존 등록 프로토콜을 대체하지 않는다.

사용자가 기존 사이트를 읽기 전용으로 확인하려면 HTTPS로 로그인한 뒤 `/api/build-info`를 열어 위 빌드/프로토콜/origin을 확인한다. 404·HTML·다른 buildId는 해당 URL에 7단계가 준비되었다는 증거가 아니다. **이번 작업은 그 사이트를 업데이트하지 않았다.** 운영 기기에 연결하거나 시험 등록을 만들기 전에는 별도로 시험 범위를 결정한다.

Android는 기존 두 origin만 canonical HTTPS로 허용하고, 등록 요청 주소와 응답 주소가 일치해야 토큰을 저장한다. 경로·query·userinfo·임의 포트/도메인 및 다른 origin으로의 등록 응답을 거부한다. API redirect를 따라 토큰을 다른 곳으로 보내지 않는다. 기존 정상 등록 주소와 데이터를 재설정하지 않는다.

### 운영과 분리할 제안 및 별도 승인 사항

[미적용 QA 대상 제안](../config/linro-qa-target.proposal.json)은 `applied:false`이며 origin/project/DB ID가 모두 비어 있다. 실제 Sites 인증과 기존 소유자 정책을 유지한 **별도 Sites 프로젝트 + 별도 D1**을 제안한다. 운영 데이터는 복사하지 않는다. 추가 유료 서비스는 활성화하지 않았다. 이용 가능한 무료 자원 여부도 실제 생성 전 확인이 필요하다.

다음 작업은 **사용자의 별도 승인과 실제 대상 정보**가 필요하며 실행하지 않았다.

1. 격리된 QA Sites 프로젝트와 D1 생성/연결 및 필요한 스키마 적용.
2. 실제 HTTPS QA origin 확정. 신규 공개 도메인이 필요하면 별도 승인.
3. 확정한 정확한 origin의 보안 검토 후 Gradle 설정·앱 origin 정책을 함께 반영하고 APK 재빌드. 현재 APK에 임의 호스트를 추가하지 않음.
4. 검토된 브랜치를 **QA에만** 배포하고 실제 Sites 로그인/owner 제한·등록·연결·해제를 확인.

기존 사이트의 배포 상태를 이 클라우드에서 다시 읽으려면 해당 호스트에 대한 환경 네트워크 접근 검토도 필요하다. 이는 앱 보안 allowlist 변경과 별개다. QA 주소를 확정하지 않은 현재 상태에서 임의 URL이나 실행 가능한 배포 명령을 만들어 운영에 적용하지 않는다.

## 3. Galaxy arm64 시험 APK

[APK 직접 다운로드](https://github.com/pashkite/phone-remote/raw/refs/heads/feature/linro-device-test-preparation/qa-artifacts/stage7/Linro-stage7-arm64-paneltest.apk) · [GitHub 파일 페이지](https://github.com/pashkite/phone-remote/blob/feature/linro-device-test-preparation/qa-artifacts/stage7/Linro-stage7-arm64-paneltest.apk) · [검사 JSON](../qa-artifacts/stage7/apk-info.json) · [SHA256SUMS](../qa-artifacts/stage7/SHA256SUMS.txt)

비공개 저장소라면 로그인 후 파일 페이지에서 **Download raw file**을 사용한다. 푸시 후 비로그인 직접 다운로드 점검은 HTTP 404였으며, 저장소 공개 여부를 확인하는 GitHub API도 `Forbidden`이었다. 따라서 비로그인 공개 다운로드 성공은 미검증이다. GitHub에 저장소 접근 권한이 있는 계정으로 로그인하여 파일 페이지를 이용한다. APK는 해당 원격 브랜치에 커밋·푸시했다.

| 항목 | 결과 |
|---|---|
| 파일 | `Linro-stage7-arm64-paneltest.apk` |
| 크기 | 16,426,752 bytes |
| 런처 이름 / ABI | 린로 / arm64-v8a |
| package ID | `com.galaxyremote.app.paneltest` |
| versionCode | **18**, 기존 6단계 17에서 증가 |
| versionName | `0.5.3-panel-experiment` |
| Manifest·아이콘 | aapt/ZIP 검사 및 PNG·adaptive/round/monochrome 리소스 확인 |
| 서명 | 기존 6단계 시험 APK와 인증서 집합 일치, APK v2 검증 통과 |
| 정렬 | zipalign 16KiB 검사 통과 |
| 설치·업데이트·데이터 보존 | **실기기 미검증**, 삭제/초기화하지 않음 |

APK SHA-256:

```text
df061de6dc3804785216c489b54a0b6928e4d7ae3872ed25fecd59caeb03907e
```

기존/이번 시험 APK의 서명 인증서 SHA-256:

```text
8f568dd3778c9b0f8a316427c1a2e048a2f454f153a9b6d40dd3e4337dd0748f
```

Windows PowerShell에서 [ADB 준비·설치 절차](DEVICE-QA-RUNBOOK.md)를 따른다.

```powershell
$Adb = 'C:\Android\platform-tools\adb.exe'
$Serial = '본인의 Galaxy 일련번호'
$Apk = "$env:USERPROFILE\Downloads\Linro-stage7-arm64-paneltest.apk"
Get-FileHash -Algorithm SHA256 $Apk
& $Adb -s $Serial install -r $Apk
```

hash가 일치한 경우에만 설치한다. `-r`로 기존 시험 앱 업데이트를 요청한다. **서명/업데이트 불일치 시 중단하고 기존 앱을 삭제하거나 데이터를 지우지 않는다.** 사용자 기기에 설치된 APK의 인증서까지 확인한 것은 아니다. 이번 파일은 기존 개발 환경의 시험 서명이며 운영 앱 업데이트용이 아니다. 새 키를 생성하거나 운영 키를 교체하지 않았다. 운영 release 서명키 가용성은 확인하지 못했으며 release 빌드는 unsigned다. GitHub Actions의 임시 debug 키로 다시 빌드하면 같은 인증서가 아닐 수 있으므로 이번 다운로드 파일과 구분한다.

## 4. 자동화 검증과 한계

[검증 요약 JSON](assets/stage7/validation-summary.json) 및 같은 폴더의 원시 로그/스크린샷을 남겼다.

| 검증 | 결과·범위 |
|---|---|
| ESLint | PASS, 경고/오류 0 |
| 웹 전체 검사·빌드 | PASS: Wrangler 타입, TypeScript, vinext production, Worker 검증 |
| Node 웹/API 테스트 | **94 PASS**, 실패/skip 0. 인증 없는 진단 API 거부 및 owner 응답 포함 |
| Python | **8 PASS**, APK 검사 정책·기존 도구 테스트 |
| Android JVM | debug **20 PASS**, panelTest **20 PASS**, 실패/오류/skip 0 |
| Android 빌드 | arm64 panelTest, x86_64 debug, arm64 unsigned release, instrumentation APK compile PASS |
| 브라우저 조작·UX | PASS: 기존 조작, 11개 UX 그룹, 5개 화면 크기, 3개 모드, 밝은 테마·접근성 |
| 린로 준비 브라우저 | PASS: 이름, 인증된 빌드/origin 표시, 다른 빌드·HTML 응답 안내, 아이콘 decode·크기·adaptive/BETA 마스크 |
| 생명주기·네트워크 브라우저 | PASS: 모의 연결 100회, **실시간 30초** 독서 soak, 숨김/단절 중지, 주입 RTT/손실·수동 화질·포인터 이동·시그널링 단절 |
| 실제 네이티브 WebRTC 브라우저 | **BLOCKED/테스트 timeout**. 관리형 Chromium 정책 `WebRtcIPHandling=disable_non_proxied_udp`; ICE/Peer new, 수신 프레임 0. 통과로 집계하지 않음 |
| Android 16 실제 드래그 instrumentation | **미검증**. APK compile만 통과, 기기/에뮬레이터 런타임 수행 안 함 |
| 실제 Galaxy | 연결 기기 0, 설치·게임·OFF·복구 모두 **미검증** |

모의 스트림의 연속 프레임 생성을 수정하여 기존 회전 검증이 두 번째 크기 변경도 관찰하도록 했다. assertion·기대 동작을 완화하지 않았다. 관리형 WebRTC 정책을 우회하지 않았고 실패 로그와 CI의 비정상 종료를 유지했다. Firefox/WebKit은 이 환경에서 검증하지 못했다. 모의 지연/프레임 검증은 실제 게임 지연·60fps·장시간 안정성의 증거가 아니다. 6단계 장시간 기록을 이번 30초 실행 결과와 혼동하지 않는다.

주요 증거: [웹](assets/stage7/web.log), [Android](assets/stage7/android-build-summary.txt), [APK](assets/stage7/apk-verification.log), [브라우저](assets/stage7/preparation-browser.log), [생명주기](assets/stage7/browser-results.json), [soak](assets/stage7/reading-soak.json), [네이티브 실패](assets/stage7/native.log), [기기 미연결](assets/stage7/device-availability.txt).

## 5. 사용자가 수행할 실기기 체크리스트

현재 아래 항목은 모두 **미검증**이다. 3번부터는 검토된 QA 웹과 APK origin 일치가 선행 조건이다. [상세 Windows runbook](DEVICE-QA-RUNBOOK.md), [결과 기록 양식](DEVICE-QA-RESULTS-TEMPLATE.md)에 모델·Android·One UI·실제 결과를 기록한다.

| 순서 | 시험·통과 관찰 | 현재 상태 |
|---|---|---|
| 1 | 린로 설치·실행, BETA 아이콘/이름, 업데이트 후 기존 데이터 | 미검증 |
| 2 | 접근성·알림·현재 세션 화면 공유 등 사용자가 필요한 권한만 승인 | 미검증 |
| 3 | 실제 HTTPS QA 웹에서 Sites 소유자 로그인 및 build/origin 비교 | 미검증, QA 웹 미준비 |
| 4 | 갤럭시 등록, 잘못된/만료/재사용 코드 거부, 시험 뒤 해제 | 미검증 |
| 5 | 화면 ON에서 실제 새 프레임·회전·종료/재연결 | 미검증 |
| 6 | 마우스 클릭·길게 누르기·드래그, 좌표/멀티터치 | 미검증 |
| 7 | WASD·키 매핑·표준 게임패드→터치, 키/패드 해제 | 미검증 |
| 8 | 소설 페이지 이동·웹툰 휠/확대/맞춤 | 미검증 |
| 9 | 자동 스크롤 시작/중지, 숨김·단절 후 새 명령 중지 | 미검증 |
| 10 | 720p/1080p/60fps 등 요청값과 실수신값·지연·발열 구분 | 미검증 |
| 11 | 네트워크 중단·복구·재연결, 중복 세션/오래된 입력 없음 | 미검증 |
| 12 | 정상 종료·포커스 상실·로그아웃 시 모든 입력 해제 | 미검증 |
| 13 | 공식 절차로 Shizuku 시작·승인, 거부/중단 대응 | 미검증 |
| 14 | 실제 패널 ID·명령 지원·별도 PC ADB·물리 복구 경로 검증 기록 확보 | 미검증, OFF 게이트 |
| 15 | 조건 충족 시에만 30초 실제 패널 OFF, 새 게임 프레임·입력·복구 | 미검증, 선행 조건 전 BLOCKED |
| 16 | 30초와 복구 통과 후에만 330초 OFF, 게임·입력·발열·복구 | 미검증, 선행 조건 전 BLOCKED |
| 17 | 정상/비정상 종료 각각 복구, 재부팅 후 Shizuku/권한 재설정 | 미검증 |

### 화면 OFF 안전 게이트

실험 기능의 사전 검사·로컬 동의·시간 제한·복구 요청 경로를 유지했다. 실제 OFF 명령은 실행하지 않았다. **실제 패널 매핑과 외부 복구 방법이 충분히 검증되지 않았다면 OFF를 실행하지 않는다.** 화면 ON에서 복구 명령의 반환값이 성공인 것만으로 OFF 후 물리 복구가 검증되는 것은 아니다. 임의의 display ID/명령을 추측하지 않는다. 현재 시제품이 지원하지 않는 패널 매핑이면 중단한다.

30초 성공과 실제 복구를 기록한 뒤에만 330초를 시도한다. 검은 오버레이·밝기 최소화·잠금은 물리 OFF 성공이 아니다. 타이머/heartbeat/Binder 오류의 **복구 요청**과 실제 패널 ON을 구분한다. 앱/Shizuku 종료 때 독립 복구 프로세스가 생존하는지, 입력 해제와 자동 복구가 실제 기기에서 작동하는지도 미검증이다. ADB/물리 복구 창을 유지하고 실패 시 종료·검증된 복구 절차를 사용한다. 데이터 삭제 명령은 사용하지 않는다.

MediaProjection은 OFF 때 중단될 수 있다. 게임/보안 콘텐츠도 캡처·접근성 입력을 제한할 수 있다. 실패를 그대로 기록하며 shell 캡처가 이미 WebRTC에 연결된 것으로 가정하지 않는다. 패널 OFF가 차단되어도 화면 ON의 독립 기능 시험은 계속할 수 있다. 루팅·유료 서버·PC 원격 제어 프로그램 설치는 요구하지 않으며 ADB는 최초 검증·외부 복구용이다.

## 6. 변경 범위·진행 판정

[수정 파일 목록](assets/stage7/modified-files.txt)과 Git diff에서 전체 변경을 확인한다. 핵심 근거는 `lib/brand.ts`, `app/api/build-info/route.ts`, `app/components/test-connection-info.tsx`, Android `ApiOriginPolicy.kt`/`MainActivity.kt` 및 리소스, `scripts/generate-linro-assets.py`, `scripts/verify-device-test-apk.py`, 해당 자동화 테스트다. 생성된 APK·검사 결과·미적용 QA 제안·실기기 문서를 같은 브랜치에 보관한다. 운영 배포·DB 변경·도메인 생성은 하지 않았다.

**다음 단계: CONDITIONAL GO.** 시험 APK와 절차 준비는 완료했다. 격리 QA 웹의 실제 인증/서버 정렬을 승인·검증한 뒤 화면 ON 종합 시험을 진행한다. 실제 게임 호환성·지연·영상/입력 유지·설치 데이터 보존·Android 16 드래그·물리 OFF·자동 복구·재부팅 절차는 사용자 실기기 시험 전까지 미검증으로 유지한다. 화면 OFF 경로는 검증된 복구 기록이 생기기 전까지 NO-GO다.
