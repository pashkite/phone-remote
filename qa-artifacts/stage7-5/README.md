# 린로 7.5단계 arm64 시험 APK

[GitHub 다운로드 페이지](https://github.com/pashkite/phone-remote/blob/feature/linro-reference-ui-redesign/qa-artifacts/stage7-5/Linro-stage7-5-arm64-paneltest.apk)에서 **Download raw file**을 선택하세요. 저장소 접근 계정 로그인이 필요할 수 있습니다. 비로그인 공개 다운로드는 미검증입니다.

- 이름: **린로**, 기존 승인 아이콘/BETA 유지.
- package: `com.galaxyremote.app.paneltest`, arm64-v8a.
- versionCode **19**, 기존 18에서 증가. versionName `0.5.3-panel-experiment`.
- 기존 7단계 APK와 같은 인증서. [검사 결과](apk-info.json), [SHA-256](SHA256SUMS.txt).
- `adb install -r Linro-stage7-5-arm64-paneltest.apk`로 업데이트합니다. 기존 앱 삭제·데이터 초기화는 하지 마세요. 서명 불일치 시 중단하세요.

웹 다중 패널과 Android 홈·도구·기기·설정을 구현했습니다. **Android 실제 실행·업데이트·데이터 보존·화면 OFF·복구는 미검증**입니다. 운영 앱 업데이트용 APK가 아닙니다.

웹/APK buildId는 `linro-reference-ui-stage7-5`입니다. 신규 등록 기본 signaling URL은 기존 주소를 유지하며 기존 등록 정보도 바꾸지 않습니다. **QA 웹은 미배포**이므로 [연결 선행 조건과 전체 보고서](../../docs/LINRO-REFERENCE-UI-REDESIGN.md)를 먼저 확인하세요. 복구 방법이 충분히 검증되지 않으면 OFF를 시험하지 마세요.
