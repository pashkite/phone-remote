# 린로 (Linro) — 7단계 Galaxy 시험 APK

[Linro-stage7-arm64-paneltest.apk 다운로드 페이지](https://github.com/pashkite/phone-remote/blob/feature/linro-device-test-preparation/qa-artifacts/stage7/Linro-stage7-arm64-paneltest.apk)에서 **Download raw file**을 선택하세요. 비공개 저장소라면 GitHub 로그인이 필요합니다.

비로그인 직접 다운로드 점검은 HTTP 404였고 공개 여부 조회 API도 Forbidden이었습니다. 비로그인 공개 다운로드는 미검증이므로 저장소 접근 권한이 있는 계정으로 로그인해 위 파일 페이지를 이용하세요. 파일은 해당 원격 브랜치에 커밋·푸시했습니다.

- 런처 이름: **린로**. 아이콘에 **BETA** 표시.
- 패키지: `com.galaxyremote.app.paneltest`, ABI: arm64-v8a.
- versionCode **18** (6단계 17보다 증가), versionName 0.5.3.
- 기존 6단계 APK와 **동일한 테스트 인증서**. 새 키를 만들지 않았습니다.
- [SHA-256](SHA256SUMS.txt) · [검사 결과](apk-info.json).
- 기존 앱 삭제/데이터 초기화 없이 `adb install -r Linro-stage7-arm64-paneltest.apk`로 업데이트합니다. 서명 불일치 시 중단하고 기존 앱을 삭제하지 마세요.

**실제 설치·게임·패널 OFF·복구는 미검증입니다.** 기존 등록 데이터와 주소는 자동으로 바뀌지 않습니다. 이 APK의 신규 등록 기본 주소는 기존 `https://galaxy-remote-control.ashkite.chatgpt.site`이며, 7단계 QA 웹은 아직 생성/배포하지 않았습니다. 현재 운영 사이트를 7단계 웹이라고 가정하지 마세요. 먼저 [연결 준비 상태와 승인 항목](../../docs/LINRO-DEVICE-TEST-READY.md)을 확인하세요.

아이콘은 승인된 두 손가락 참조와 Android 전경 파생본입니다. canonical 1024px PNG 자체와 비트 단위 일치는 확인하지 못했으며 실기기 런처 표시는 별도 확인 항목입니다.

Windows·권한·화면 ON·입력·독서·복구 절차는 [실기기 runbook](../../docs/DEVICE-QA-RUNBOOK.md)에 있습니다. 복구 방법을 충분히 검증하기 전 OFF를 시험하지 마세요. 운영 앱 업데이트용 APK가 아닙니다.
