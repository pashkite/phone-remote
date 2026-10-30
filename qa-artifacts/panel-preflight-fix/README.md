# 린로 — 패널 사전 검사 수정 APK

[GitHub 파일 페이지](https://github.com/pashkite/phone-remote/blob/fix/linro-panel-help-preflight/qa-artifacts/panel-preflight-fix/Linro-panel-preflight-fix-arm64-paneltest.apk)에서 로그인 후 **Download raw file**을 선택하세요.

- package: `com.galaxyremote.app.paneltest`, arm64-v8a, 린로/BETA.
- versionCode **20**, 기존 19번 시험 APK와 동일 인증서.
- [SHA-256](SHA256SUMS.txt) · [검사 결과](apk-info.json) · [수정 원인·시험 절차](../../docs/PANEL-PREFLIGHT-FIX.md).
- 실제 패널 ON·이전 시험 복구·연결 종료를 확인한 뒤 `adb install -r Linro-panel-preflight-fix-arm64-paneltest.apk`로 업데이트하세요. 기존 앱 삭제/초기화는 하지 마세요. 서명 오류면 중단하세요.
- Shizuku 서비스 버전도 갱신했으므로 업데이트 후 실험 화면의 **2번 서비스 연결**을 다시 수행하세요.

정상 도움말의 -1/255 종료를 잘못된 제어 실패로 분류하던 문제를 수정했습니다. 실제 Galaxy·Shizuku·3/4번 사전 검사·상단 여백·물리 OFF·복구·데이터 보존은 **실기기 미검증**입니다. 명령 미지원/미확인 또는 외부 복구 미검증이면 OFF를 실행하지 마세요.
