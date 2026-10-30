# 린로(Linro) — 7.5단계 웹·Android 통합 UI/UX 리디자인

판정: **CONDITIONAL GO**. 시안을 기준으로 실제 React 화면과 Android Views를 수정했다. 정적 목업이 아니라 기존 기기·권한·전송·입력 기능을 연결한 구현이다. **QA 웹 배포, Android 런타임, 실제 Galaxy 연결·게임·물리 패널 OFF·복구는 미검증**이다.

## 기준과 PR 선처리

- 기준 브랜치: `feature/linro-device-test-preparation`
- 기준 커밋: `2b60ee1bbe166d70c5774502a1ed4fd5ec95c805`
- 결과 브랜치: `feature/linro-reference-ui-redesign`
- 기존 7단계 [PR #8](https://github.com/pashkite/phone-remote/pull/8): Git의 `refs/pull/8/head`가 위 기준 커밋과 정확히 일치함을 확인했다. API 조회·생성은 `Forbidden`이었지만, 이후 Git 참조에서 기존 PR을 발견하여 중복 생성하지 않았다. 열림·종료·병합 여부는 API 제한으로 미확인이다.
- [이번 작업 비교·PR 생성 링크](https://github.com/pashkite/phone-remote/compare/feature/linro-device-test-preparation...feature/linro-reference-ui-redesign?expand=1). 브랜치 푸시 후 새 PR 생성도 시도했으나 GitHub GraphQL API가 `Forbidden`을 반환했다. **새 PR 생성 완료는 확인하지 못했으며** 이 링크에서 접근 권한이 있는 사용자가 생성할 수 있다. 실패 기록은 `assets/stage7-5/new-pr-api.log`에 보관했다.
- `main`, `master`, 기준 개발 브랜치, 운영 환경·DB·도메인은 변경 대상이 아니다. 병합·자동 배포를 수행하지 않았다.

## 1. 참고 이미지 분석과 적용 범위

사용자가 대화에 첨부한 1672×941 LINRO 시안을 시각적 기준으로 사용했다. 시안은 노트북·두 휴대폰과 홍보 문구를 포함한 보드다. 구현 대상은 기기 프레임 안의 앱 화면이며, 노트북 베젤·휴대폰 상태바·예시 홈 화면·광고 문구를 앱 배경 이미지로 복제하지 않았다.

웹은 좌측 탐색 → 등록 기기 목록 → 중앙 원격 영상 → 우측 모드/제어 패널의 계층을 적용했다. 어두운 네이비·차콜, 청록색 강조, 얇은 경계, 작은 선 아이콘, 절제된 카드와 텍스트 계층을 사용했다. Android는 홈과 도구 화면의 카드·상태·행 단위를 확장하여 **홈 | 도구 | 기기 | 설정**을 실제 화면으로 구현했다.

시안의 예시 Galaxy 이름, IP, 배터리, 12ms, 60fps를 실제 값처럼 옮기지 않았다. 기기 목록은 기존 API 응답만 사용하고 통계가 없으면 **확인 불가**를 표시한다. 미연결 플레이어에는 대기 안내만 표시한다. 증거 이미지의 `Browser test phone`, `SIMULATED · NO ANDROID DEVICE`는 테스트 전용 fixture이며 운영 화면에 하드코딩된 데이터가 아니다.

### 브랜드 원본 한계

린로 / Linro / Link Road와 기존 승인된 두 손가락 자산을 유지했다. 파비콘·PWA·런처·알림 이름과 package ID도 유지했다. [승인 자산 출처](../assets/brand/linro/APPROVED-HANDOFF.md)의 256px 참조 및 기존 adaptive 파생본을 사용했으며 다른 로고를 만들지 않았다. canonical 1024px PNG 바이트는 여전히 미확보다.

첨부 디자인 보드도 대화에서는 볼 수 있지만 실행 환경에는 원본 이미지 파일 경로가 제공되지 않았다. 따라서 **시안 원본과 결과를 합성한 픽셀 비교 및 원본 파일 기반 정밀 시각 승인**은 미완료다. 아래 비교 캡처는 실제 구현의 수정 전후이며, 사용자 시안 원본이라고 표시하지 않는다. [정밀 시각 QA 상태](../design-qa.md)는 이 한계와 Android 화면 캡처 부재 때문에 `blocked`로 남겼다.

## 2. 공통 디자인 시스템

| 토큰 | 다크 | 라이트 |
|---|---|---|
| 페이지 | `#0B121A` | `#EDF2F5` |
| 카드 | `#121D27` | `#FFFFFF` |
| 보조 면 | `#192631` | `#F3F6F8` |
| 주요 글자 | `#E7EDF5` | `#142736` |
| 보조 글자 | `#A2B1C1` | `#4F6473` |
| 청록 강조 | `#69D4DF` | `#096876` |
| 경계 | `#2A3B48` | `#C6D4DD` |

웹은 기존 Geist와 한국어/system sans fallback, Android는 시스템 sans를 사용한다. Android의 OS/글꼴 확대에 따른 실제 모양은 미검증이다. 두 플랫폼에 같은 **Phosphor light** 계열을 적용했다. 웹은 정식 라이브러리 컴포넌트, Android는 해당 라이브러리의 경로를 변경 없이 VectorDrawable로 내보냈다. [내보내기 도구](../scripts/export-android-ui-icons.mjs), [MIT 라이선스](../assets/licenses/phosphor-icons.txt)를 보존했다. 승인 로고를 선 아이콘으로 대체하지 않았다.

웹 카드 반경은 12px, Android 주 카드 16dp·버튼 12dp를 사용한다. 모바일 웹 주요 조작은 44px 이상, Android 행 버튼은 최소 52dp, 하단 탐색은 최소 64dp다. 입력창과 탐색 버튼 높이를 내용에 따라 늘릴 수 있게 하여 고정 높이 잘림 위험을 줄였다. 실제 Android fontScale/One UI 검증은 별도다.

## 3. 웹 구현 전후와 기능 연결

기존 상단 헤더·영상·긴 설정 열에서 탐색/기기/영상/제어의 네 영역으로 변경했다. 플레이어는 모드·테마 전환 때 재생성하지 않는다. 원격 영상과 세션을 유지하는 기존 ref·연결 scope·입력 엔진을 사용한다.

| 화면 | 실제 연결한 기능 |
|---|---|
| 기본 탐색 | 원격 화면으로 이동, 내 기기 관리 대화상자, 설정 대화상자, 현재 선택 표시 |
| 기기 목록 | 실제 API 이름·최근 응답·선택·배터리(있을 때), 추가/등록, 새로고침, 오류·빈 목록, 등록 해제 |
| 연결 헤더 | 실제 선택 기기·연결 단계·경로·배터리. 경로/IP를 추측하거나 불필요하게 IP를 노출하지 않음 |
| 중앙 화면 | 동일 WebRTC video, 화면 비율·회전, 확대/맞춤·전체화면·분리 창, 기존 마우스/키보드/포인터 처리 |
| 하단 탐색 | 실제 Android 뒤로·홈·최근 앱 명령, 표시 확대 |
| 게임/소설/웹툰 | 기존 매핑·게임패드·읽기 키·자동 스크롤·확대/이동·프로필을 그대로 연결 |
| 빠른 제어 | 기존 홈·뒤로·최근·화면 잠금. **잠금은 물리 패널 OFF가 아님** |
| 연결 상태 | 실제 수신 FPS·해상도·네트워크 RTT·코덱, 자세한 스트리밍 통계. 미수집 값은 확인 불가 |
| 원격 도구 | 기존 파일·클립보드·소리·PNG·녹화·대기 모드·진단. 연결/Android capability에 따라 활성화하며 지원 필요 이유 표시 |
| 화면 OFF 실험 | 웹에서는 실행 버튼 없이 미검증·사전 조건·외부 복구 안내만 유지 |

개인/공용 PC 저장 정책, `gr_pref_theme`와 기존 프로필 저장 키·형식을 유지했다. 모드 변경으로 수동 화질을 덮어쓰지 않는다. 설정·기기 변경·초점 상실·종료 시 입력 해제와 자동 스크롤 종료 정책도 유지한다. 새 기기 관리 대화상자 역시 기존 modal 포커스 격리와 입력 차단을 사용한다.

지원되지 않는 Android 확장 도구는 비활성 상태와 이유를 표시한다. 브라우저 녹화·파일 저장·클립보드·전체화면은 브라우저의 지원과 사용자 정책에도 제한될 수 있다. 기존 오류 처리와 도움말을 유지했으며, 그 기능이 모든 브라우저/게임에서 성공한다고 표시하지 않았다.

### 실제 브라우저 시각 수정

초기 화면에서 기기 제목/상태가 중복되고 영상 높이가 작아지는 점을 발견했다. 최종 수정에서는 제목을 연결 헤더에 모으고 중복 상태를 줄여 영상 높이를 늘렸다. 동일한 1440×900·다크·미연결 fixture를 [나란히 비교한 브라우저 캡처](assets/stage7-5/player-proportion-comparison.png)를 남겼다. 첫 화면과 최종 화면의 원본 파일도 보존했다.

- [7단계 이전 화면](assets/stage7-5/before-stage7-1920.png)
- [초기 7.5단계 화면](assets/stage7-5/iteration-0-waiting-1440.png)
- [최종 1440×900 다크](assets/stage7-5/reference-ui/1440x900-game-dark.png)
- [최종 1440×900 라이트](assets/stage7-5/reference-ui/1440x900-game-light.png)
- [기기 관리](assets/stage7-5/reference-ui/devices-dialog.png), [등록 코드](assets/stage7-5/reference-ui/pair-dialog.png), [도구 동작](assets/stage7-5/reference-ui/tools-actions.png)

## 4. 반응형 결과

| CSS viewport | 구성과 확인 | 증거 |
|---|---|---|
| 1920×1080 | 전체 탐색·기기 패널·영상·제어 열 | [다크](assets/stage7-5/reference-ui/1920x1080-game-dark.png) / [라이트](assets/stage7-5/reference-ui/1920x1080-game-light.png) |
| 1440×900 | 동일 다중 패널, 중앙 영상 우선 | [다크](assets/stage7-5/reference-ui/1440x900-game-dark.png) / [라이트](assets/stage7-5/reference-ui/1440x900-game-light.png) |
| 1280×720 | 탐색·기기 폭 축소, 제어 열 스크롤 | [다크](assets/stage7-5/reference-ui/1280x720-game-dark.png) / [라이트](assets/stage7-5/reference-ui/1280x720-game-light.png) |
| 1024×768 | 아이콘 탐색, 접는 기기 목록, 영상+제어 | [다크](assets/stage7-5/reference-ui/1024x768-game-dark.png) / [라이트](assets/stage7-5/reference-ui/1024x768-game-light.png) |
| 390×844 | 상단 아이콘 탐색, 접는 목록, 영상 우선·제어 아래 배치/숨김 | [다크](assets/stage7-5/reference-ui/390x844-webtoon-dark.png) / [라이트](assets/stage7-5/reference-ui/390x844-webtoon-light.png) |

다섯 크기 × 두 테마 × 세 모드를 Chromium에서 렌더링·캡처했다. 가로 넘침 없이 영상 폭 100px·높이 200px 초과를 검사했다. 작은 화면의 기기 목록 열기/닫기와 아이콘 메뉴의 접근성 이름도 확인했다. 세로 스크롤과 제어 열 내부 스크롤은 의도된 동작이다. 접기 버튼은 기존 제어 패널 숨김/열기를 사용한다.

## 5. Android 구현 전후와 기능 연결

기존 단일 세로 설정 화면을 XML include 네 페이지와 고정 하단 탐색으로 나눴다. Compose 등 새 UI 프레임워크로 마이그레이션하지 않았다. 실제 Android 화면 캡처는 **없다**. XML/빌드 통과를 런타임 시각 검증으로 대체하지 않는다.

| 탭 | 구현 및 기존 동작 연결 |
|---|---|
| 홈 | 실제 모델·등록 정보·준비 상태·화면 공유 세션·알림 권한, 요청 대기/공유 중지, 등록/접근성/연결 정보 진입 |
| 도구 | 기존 파일 선택/수신 승인·SAF 저장 위치, 클립보드 보내기, 오디오 권한, 대기 모드, 진단/내보내기/전송 취소 |
| 기기 | 현재 기기 모델·등록 계정·저장된 origin·연결 상태, 기존 6자리 페어링과 등록 변경·오류/재시도. 가상의 PC 목록 없음 |
| 설정 | 시스템/다크/라이트 외관, 알림 설정·대기 관리·접근성·키보드·오디오·버전·빌드/origin 정보, 테스트 빌드의 실험 진입 |

`ConnectionReadiness`는 실제 등록·접근성·알림·리스너 실행·projection·연결 상태로 표시를 결정한다. 저장된 `standbyActive` 또는 대기 설정만으로 준비 완료를 표시하지 않는다. 등록 정보는 **기기에 저장됨**과 **서버 유효성 확인**을 구별한다.

외관 설정은 별도 `linro_appearance`에 저장하고 `AppCompat DayNight`로 시스템/명시 선택을 적용한다. 외관 변경은 Activity를 재생성할 수 있지만 서비스 종료를 호출하지 않는다. 이미 실행 중인 요청 대기 서비스에 대한 불필요한 재시작 요청도 피한다. 탭·등록 편집 상태를 Bundle로, 미제출 코드는 기존 EditText ID의 저장 상태로 유지한다. 수신 파일 승인 중인 manager/id는 ViewModel에 보관하고 **동일 transfer 객체/offer인지 확인한 뒤에만** 기존 SAF 결과를 처리한다. 프로세스 소멸 후 유효한 transfer가 없으면 수신을 재개한다고 가정하지 않는다.

기존 알림 승인, MediaProjection launcher, 접근성 동의, 파일 승인, 원격 키보드 API를 유지했다. 서비스 관찰용 getter/실행 flag 외에 WebRTC 전송 로직·인증·시그널링 프로토콜을 변경하지 않았다. 실제 테마 전환 중 세션 유지·회전·권한 철회·파일 선택 복원은 런타임 미검증이다. 이를 위한 instrumentation 검사를 추가했지만 이 환경에서는 **컴파일만** 했다.

## 6. 실행한 테스트와 결과

[검증 요약](assets/stage7-5/validation-summary.json), [수정 파일 전체 목록](assets/stage7-5/modified-files.txt), 같은 폴더의 로그를 확인한다.

| 검증 | 결과 |
|---|---|
| 전체 ESLint | PASS, 오류/경고 0 |
| TypeScript·웹 production·Worker | PASS: `bash scripts/test-web-streaming.sh` |
| 기존 웹/API 단위·통합 | **94 PASS**, 실패/skip 0. 인증·세션·입력 보안 검사 유지 |
| Python | **8 PASS**, 기존 APK 정책/사전 검사 도구 유지 |
| Android JVM | debug **23**, panelTest **23** PASS. 기존 40개 유지 + 준비 상태 검사 6회, 실패/오류/skip 0 |
| Android APK | panelTest arm64·debug x86_64·release unsigned arm64·debug instrumentation 빌드 PASS |
| 기존 조작 브라우저 | PASS: 매핑/멀티터치/게임패드/독서·자동 스크롤/입력 해제 |
| 기존 UX 브라우저 | PASS: 등록 실패·만료·포커스·회전 좌표·연결 단계·저장 손상·할당량·테마·반응형·guest |
| 새 UI 브라우저 | PASS: 탐색/카드/등록·클립보드/파일 offer·cancel·5크기×2테마×3모드·동일 peer/video·수동 화질 보존 |
| 빌드/origin 브라우저 | PASS: 인증된 진단 표시·불일치·구형 HTML 응답·기존 승인 아이콘 |
| 네트워크 브라우저 | PASS: 주입 RTT/손실의 자동 화질·수동 유지·1000 move 병합·시그널링 실패 정리 |
| 연결 생명주기 | 최종 PASS: 지연 응답 취소·다른 기기 선택 종료·인증 만료·100회 연결·30초 실제 시간 독서 soak |
| 네이티브 WebRTC | **BLOCKED/timeout**, 관리형 Chromium `disable_non_proxied_udp`, ICE/Peer new·수신 프레임 0. 우회하지 않음 |
| Android 런타임·실기기 | **미검증**, 연결 기기/에뮬레이터 없음. 스크린샷도 없음 |

기존 Android 16 LiveTouch 드래그와 새 `MainUiTest`도 instrumentation APK에 포함해 컴파일했다. 런타임 성공이나 원격 GitHub Actions 성공으로 표시하지 않았고 기존 드래그 assertion을 완화하지 않았다.

기존 테스트를 삭제하거나 skip 처리하지 않았다. 레이아웃에서 바뀐 등록 버튼·기기 선택 카드·줄바꿈에 맞춘 탐색자만 갱신했고, 프로토콜/준비 상태 기대값과 리소스 검사 임계값은 유지했다. 빌드 marker는 웹/APK 모두 `linro-reference-ui-stage7-5`, control protocol은 기존 **1**이다. 새 marker 비교는 진단이며 기존 기기 등록 프로토콜을 대체하지 않는다.

### 반복 세션의 관찰 한계

초기 100회 검사 한 번은 리스너 샘플 287→344로 기존 임계값을 넘었다. [원래 실패](assets/stage7-5/integration-initial-failure.log)를 보존했다. 별도 [관찰 계측](assets/stage7-5/listener-probe.log)은 10/50/100회 모두 287, 전역 리스너 종류/수도 동일했다. 그 후 **검사 임계값을 변경하지 않은 재실행**이 통과했다. [최종 자원 샘플](assets/stage7-5/cycle-resources.json)을 확인한다. 이를 일반적인 메모리 누수 부재 증명으로 확대하지 않는다. DOM/GC 샘플 변동의 원인은 확정하지 못했으며 장시간·실기기 검사에서 재관찰이 필요하다.

30초 soak는 브라우저의 로컬 모의 스트림/명령을 실제 시간으로 실행한 결과다. 330초 물리 OFF, 실제 파일 수신, 인터넷 지연·게임 60fps 성공과 구분한다. Firefox/WebKit, OS 파일 저장·실제 클립보드 권한도 별도 환경 검증 대상이다.

## 7. 다운로드 APK·서명·업데이트

[APK 직접 다운로드](https://github.com/pashkite/phone-remote/raw/refs/heads/feature/linro-reference-ui-redesign/qa-artifacts/stage7-5/Linro-stage7-5-arm64-paneltest.apk) · [GitHub 파일 페이지](https://github.com/pashkite/phone-remote/blob/feature/linro-reference-ui-redesign/qa-artifacts/stage7-5/Linro-stage7-5-arm64-paneltest.apk) · [검사 JSON](../qa-artifacts/stage7-5/apk-info.json) · [SHA256SUMS](../qa-artifacts/stage7-5/SHA256SUMS.txt)

GitHub 접근 계정으로 로그인한 뒤 파일 페이지의 **Download raw file**을 사용한다. 비로그인 공개 다운로드 성공은 미검증이다.

| 항목 | 값 |
|---|---|
| 파일 | `Linro-stage7-5-arm64-paneltest.apk` |
| 크기 | **16,631,295 bytes** |
| 런처 이름 / ABI | 린로 / arm64-v8a |
| package | `com.galaxyremote.app.paneltest` (유지) |
| versionCode | **19** (이전 18보다 증가) |
| versionName | `0.5.3-panel-experiment` |
| 인증서 | 기존 7단계 APK와 정확히 일치, APK v2 서명 검증 PASS |
| 정렬·Manifest·아이콘 | 16KiB ZIP alignment, package/label/ABI 검사 및 XML/기존 아이콘 리소스 검사 PASS |
| 실제 업데이트·데이터 보존 | **미검증**. 기존 앱 삭제/초기화·새 키 생성 없음 |

SHA-256:

```text
2c62620be32fdcced6d95010383b44218b1c50e743972bcf57a75f2b04f5cc00
```

인증서 SHA-256:

```text
8f568dd3778c9b0f8a316427c1a2e048a2f454f153a9b6d40dd3e4337dd0748f
```

Windows에서 [기존 ADB 준비 절차](DEVICE-QA-RUNBOOK.md)를 참고하고 이번 파일명/hash를 사용한다.

```powershell
$Apk = "$env:USERPROFILE\Downloads\Linro-stage7-5-arm64-paneltest.apk"
Get-FileHash -Algorithm SHA256 $Apk
adb install -r $Apk
```

여러 기기가 있으면 `adb -s 본인기기ID install -r $Apk`를 사용한다. hash가 일치할 때만 설치한다. 서명/업데이트 불일치 시 **중단하고 기존 앱을 삭제하거나 데이터를 지우지 않는다**. 실제 설치된 앱의 인증서를 조회한 것은 아니다. 운영 패키지 업데이트용 APK가 아니며 release 산출물은 unsigned다.

## 8. QA 웹·안전·실기기 시험 선행 조건

QA 웹은 여전히 **미배포**다. APK 신규 등록 기본 주소는 기존 `https://galaxy-remote-control.ashkite.chatgpt.site`이고, 기존 등록 origin/인증 데이터는 유지한다. 기존 `https://remote.ashkite.kro.kr` 외에 임의 origin을 추가하지 않았다. 현재 운영 사이트의 배포 버전·Sites 로그인 성공은 이 환경에서 확인하지 못했다. HTTPS·소유자 인증을 끄지 않았다.

[미적용 QA 제안](../config/linro-qa-target.proposal.json)은 새 buildId만 반영하고 `applied:false`, QA project/origin/DB ID는 비어 있다. 격리 Sites·DB와 실제 HTTPS 주소 생성·정확한 origin 검토·QA 배포·APK 재빌드는 **별도 사용자 승인**이 필요하다. 운영 배포, DB 변경, 신규 도메인 생성, 유료 서버 활성화를 하지 않았다.

실기기 확인 순서:

1. hash·기존 인증서 확인 후 `-r` 업데이트, 등록/설정 보존·린로 이름/BETA 아이콘 확인.
2. 홈·도구·기기·설정 전환, 미등록/권한 거부/준비/실제 연결의 표시를 각각 확인.
3. 시스템/다크/라이트·글꼴 확대·회전·Activity 재생성, 코드 입력과 파일 승인 상태·서비스 유지 확인.
4. 검토된 QA 웹/APK buildId·origin 일치와 실제 Sites 로그인 → 등록 → 화면 ON 연결 → 등록 해제 확인.
5. 클릭/길게 누르기/드래그/WASD/매핑/게임패드, 소설/웹툰/자동 스크롤, 파일/클립보드/소리/녹화, 수동 화질·통계 확인.
6. 네트워크 중단/재연결/권한 철회/정상·비정상 종료 때 영상·입력·자동 스크롤 정리 확인.
7. 그 후에만 [기존 패널 OFF 안전 게이트와 30초→330초 절차](DEVICE-QA-RUNBOOK.md)를 검토한다. **외부 복구와 실제 패널 매핑 검증이 없으면 OFF는 BLOCKED**다.

물리 패널 OFF·새 프레임/게임 입력 유지·자동 복구·재부팅 설정은 모두 미검증이다. 실험 모듈/AIDL/사전 검사/시간 제한을 변경하거나 실험을 자동 활성화하지 않았다. 화면 잠금·검은 오버레이·밝기 최소를 물리 OFF 성공으로 취급하지 않는다. DRM/FLAG_SECURE 우회도 없다.

## 9. 변경 파일·커밋·남은 작업

[전체 파일 목록](assets/stage7-5/modified-files.txt)에 생성 자산·검사 로그·APK까지 포함했다. 주요 신규/변경 항목:

- 웹: `app/remote-console.tsx`, `app/globals.css`, `app/public-console.tsx`, `ui-icon.tsx`, 테마/전송 도구 컴포넌트.
- Android: `MainActivity.kt`, 네 페이지 XML, DayNight 색상·테마·내비게이션·선 아이콘, `AppearancePreferences`, `ConnectionReadiness`, `MainUiOperations`.
- 관찰용 서비스 상태 getter/flag, 빌드 marker/versionCode, 기존 프로토콜 테스트의 marker 기대값, 신규 UI/준비 상태/instrumentation 검사 및 CI 연결.
- 운영 배포 설정·DB schema·인증/기기 등록 프로토콜·MediaProjection/WebRTC 엔진·실험 안전 게이트는 변경하지 않음.

기능 커밋:

- `e99a46d` — 웹 다중 패널·실제 기기 탐색·도구/테마·UI 회귀.
- `c488b8f` — Android 네 탭·실제 준비 상태·DayNight·수신 승인 상태 보존·빌드.
- `6ad2a6c` — 플레이어 공간 확대와 중복 제목 제거.

결과물/보고서 최종 커밋은 제출 응답과 GitHub 브랜치에서 확인한다. [전체 비교](https://github.com/pashkite/phone-remote/compare/2b60ee1bbe166d70c5774502a1ed4fd5ec95c805...feature/linro-reference-ui-redesign).

**다음 실기기 시험: CONDITIONAL GO.** 설치·로컬 UI/권한 확인은 준비됐다. 종합 연결 시험은 승인된 QA 웹 준비가 선행되어야 한다. Android 런타임 화면·서비스 유지·실제 게임·지연·OFF/복구와 시안 원본 파일을 사용한 정밀 시각 승인은 남아 있다. 이 항목을 성공으로 표시하지 않는다.
