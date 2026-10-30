# Linro 7.5 — 시각 QA

**Findings**

- [해결 P2] 중복된 기기 제목·연결 상태가 중앙 영상의 높이를 줄였다. 첫 구현에서 확인한 뒤 제목을 헤더로 모으고 중복 상태 줄을 숨겼다. `6ad2a6c`에 반영했으며 [같은 viewport/대기 상태 전후](docs/assets/stage7-5/player-proportion-comparison.png)와 [최종 연결 상태](docs/assets/stage7-5/reference-ui/1440x900-game-dark.png)를 열어 확인했다.
- [검증 차단] 사용자 첨부 시안은 대화의 1672×941 보드가 시각 기준이다. 원본 파일 경로/바이트가 실행 환경에 없어 **시안 원본과 구현을 함께 놓은 정규화 비교 이미지**를 만들지 못했다. 구현 전후 합성을 시안 원본 비교라고 주장하지 않는다.
- [검증 차단] Android 기기·에뮬레이터가 없어 네 탭·테마·회전의 실제 화면을 열거나 캡처하지 못했다. XML/빌드/instrumentation 컴파일을 시각 검증 성공으로 표시하지 않는다.

**Source and capture**

- Source visual truth: 이번 대화의 사용자 LINRO 첨부 이미지, 1672×941. 로컬 원본 파일 없음.
- 앱 영역: 노트북 내부의 네 패널 및 두 휴대폰의 앱 콘텐츠. 외부 포스터/베젤/OS 상태바는 구현 대상에서 제외한다.
- Implementation: [1440×900 다크](docs/assets/stage7-5/reference-ui/1440x900-game-dark.png), [라이트](docs/assets/stage7-5/reference-ui/1440x900-game-light.png), [390×844 웹툰](docs/assets/stage7-5/reference-ui/390x844-webtoon-light.png) 등 5크기×2테마×3모드.
- Chromium CSS viewport는 파일명과 동일, deviceScaleFactor 1. fullPage 캡처이므로 세로 스크롤 화면은 파일 높이가 CSS viewport보다 크다.
- 전후 비교는 1440×900 CSS 대기 상태의 구현 캡처를 960px 폭으로 표시하고 각각 첫 900 원본 픽셀 높이를 잘라 같은 HTML에 배치하여 Chromium으로 촬영했다. 결과 2000×800. 원본 이미지 픽셀을 수정하지 않았다.
- 전체 구도와 카드·탐색·플레이어 비율·작은 화면을 실제 렌더링에서 확인했다. 포커스/등록/도구/empty 상태의 개별 캡처도 같은 증거 디렉터리에 있다. 시안의 기기/수치를 복제하지 않아 콘텐츠 상태는 시안과 다르다.

**Required fidelity surfaces**

| 영역 | 확인·한계 |
|---|---|
| 글꼴/텍스트 | 웹 Geist·한국어/system fallback, Android sans. 크기/굵기/행간 계층과 웹 줄바꿈을 확인. 시안의 정확한 폰트 파일, Android fallback/fontScale는 미검증 |
| 간격/구성 | 네 패널·중앙 영상 우선·얇은 경계·모바일 접기 적용. 중복 헤더의 P2를 수정하고 재촬영. 원본과 픽셀 단위 비율 일치 판정은 보류 |
| 색상/토큰 | 네이비/차콜·청록 및 대응 라이트 토큰을 CSS와 Android에 적용. 라이트/다크 실제 웹 캡처 확인 |
| 이미지/아이콘 | 승인 로고 유지, Phosphor light 라이브러리 경로 사용. 시안의 가짜 기기 홈 화면·숫자·장식 이미지를 대체 삽입하지 않음. canonical 1024px 로고 바이트 및 설치 런처는 미검증 |
| 실제 앱 문구 | API 기기·상태/수집 통계만 표시, 모르는 값은 확인 불가. 테스트 캔버스는 SIMULATED/NO ANDROID DEVICE로 명시. Android 화면 준비 완료는 관찰 상태를 조건으로 계산 |

**Interaction evidence**

Chromium에서 탐색·기기 관리·등록 대화상자·포커스 복귀·Android 명령·파일 offer/cancel·클립보드 보내기·테마/모드·맞춤/확대·수동 화질/동일 peer/video 보존·모바일 목록·종료·빈 상태를 확인했다. [신규 브라우저 결과](docs/assets/stage7-5/reference-ui/results.json)의 pageerror는 0이다. 외부 네트워크 폰트/서비스·OS 저장 권한·네이티브 WebRTC 제한은 별도이며 실제 Sites 로그인/Android 성공을 뜻하지 않는다.

**Comparison history**

1. 초기 구현 실제 캡처에서 제목 중복·영상 비율 문제(P2)를 발견했다. [초기 증거](docs/assets/stage7-5/iteration-0-waiting-1440.png).
2. 제목/상태를 정리하고 영상 공간을 확대했다. [동일 상태 전후](docs/assets/stage7-5/player-proportion-comparison.png)를 열어 확인했고 신규 브라우저 검증을 다시 통과했다.
3. 최종 캡처의 탐색·카드·작은 화면에서 추가 P0/P1/P2 기능/레이아웃 문제를 발견하지 않았지만, 원본 시안의 합성 비교와 Android 런타임 화면은 확보하지 못했다. 따라서 정밀 시각 승인 전체를 passed로 올리지 않는다.

**Implementation Checklist**

- 웹 실제 렌더링·주요 상호작용·작은 화면·다크/라이트 검사 완료.
- 제공 시안의 원본 파일을 확보하면 앱 영역을 정규화하여 원본과 결과를 함께 비교.
- Android 실기기/에뮬레이터에서 네 탭·두 테마·시스템 테마·글꼴 확대·회전 화면 캡처 및 재검토.
- WebRTC 네이티브/실제 Galaxy·패널 OFF·복구는 별도 검증 상태 유지.

**Follow-up Polish**

운영 전 한국어 폰트 fallback과 실제 One UI 런처·테마 아이콘을 확인한다. 웹은 기능이 많은 제어 열을 스크롤하는 구성이며 정보 밀도 선호에 따라 접힌 섹션의 기본값을 조정할 수 있다.

final result: blocked
