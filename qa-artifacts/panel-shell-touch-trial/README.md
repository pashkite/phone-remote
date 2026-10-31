# 린로 v23 · Shizuku 직접 터치 비교 후보

[APK 직접 다운로드](https://github.com/pashkite/phone-remote/raw/refs/heads/fix/linro-panel-help-preflight/qa-artifacts/panel-shell-touch-trial/Linro-panel-shell-touch-trial-arm64-paneltest.apk)

versionCode 23 / 0.5.6-panel-experiment, `com.galaxyremote.app.paneltest`, arm64-v8a, 표시 이름 린로. 기존 v22와 인증서가 일치한다. 앱 삭제·데이터 초기화 없이 업데이트한다.

[비교 절차·지원 범위·미검증 사항](../../docs/PANEL-SHELL-TOUCH-TRIAL.md) · [SHA-256](SHA256SUMS.txt) · [APK 검사](apk-info.json).

기본 입력은 기존 접근성이다. 새 후보는 앱에서 직접 선택·확인해야 한다. **화면 ON에서 30초 직접 터치 비교를 먼저 하고**, 해당 경로가 동작하며 기존 외부 복구·물리 매핑 조건도 충족된 경우에만 30초 OFF 비교를 한다. 단일 터치·길게 누르기·드래그만 지원하며, 후보 선택 시 330초 OFF는 차단한다.

실제 Samsung 펌웨어의 API/권한·입력 전달·OFF 입력·최근 앱 미리보기·자동 복구는 미검증이다. 성공 판정 APK가 아니다. 임의 shell 명령·루팅·보호 콘텐츠 우회를 추가하지 않았다.
