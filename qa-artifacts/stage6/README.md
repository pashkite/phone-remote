# Galaxy Remote 2.0 Test — stage 6

[시험 APK 다운로드 페이지](https://github.com/pashkite/phone-remote/blob/feature/galaxy-remote-2-integration-qa/qa-artifacts/stage6/GalaxyRemote-2.0-stage6-arm64-paneltest.apk)에서 **Download raw file**을 선택하세요. 비공개 저장소라면 GitHub 로그인이 필요합니다.

- arm64-v8a, `com.galaxyremote.app.paneltest`, 표시 이름 `Galaxy Remote 2.0 Test`.
- 기존 개발 환경의 debug 서명. 운영 앱 업데이트용 APK가 아닙니다.
- SHA-256: `e0d465694df5c59fb1a2384e89ed432d08653265891469c6cc3f43f4697ada92`.
- 기존 공개 다운로드 파일과 운영 앱은 교체하지 않았습니다.
- 이 APK는 빌드/서명/정렬 검사만 통과했습니다. 실제 설치·게임·화면 OFF·복구는 미검증입니다.
- 앱의 기존 signaling URL 설정을 보존했습니다. 새 QA 웹 환경은 자동 배포하지 않았으므로, **6단계 전체 통합 시험 전에 검토된 QA 웹과 APK의 signaling origin이 일치해야 합니다.** 기존 운영 사이트를 사용하면 새 웹 변경사항을 검증할 수 없습니다.

[Windows·Galaxy 실기기 절차](../../docs/DEVICE-QA-RUNBOOK.md)를 먼저 읽으세요. 복구 경로가 충분히 검증되지 않았다면 패널 OFF를 시험하지 마세요.

GitHub Actions 대안: `Build and test Android APK` 워크플로를 이 브랜치로 수동 실행 → `galaxy-remote-apk-build` 아티팩트의 `panelTest/app-panelTest.apk`. 아티팩트 보관 기간은 7일이며, 만료되면 재실행해야 합니다. Actions의 새 debug 키는 기존 설치와 다를 수 있습니다. 서명 불일치 시 기존 앱을 삭제하지 말고 중단하세요. 이 세션에서 Actions 실행 성공은 확인하지 못했습니다.
