# Galaxy Remote Android

Galaxy Remote 웹 콘솔에 갤럭시를 등록하고, 사용자가 직접 승인한 화면을 WebRTC로 전송하는 Android 동반 앱입니다. USB와 루팅은 사용하지 않습니다.

## APK 만들기

1. PC에 최신 Android Studio를 설치합니다.
2. Android Studio에서 이 `android-client` 폴더를 엽니다.
3. SDK Manager에서 Android SDK 35를 설치하고 Gradle 동기화를 완료합니다.
4. **Build → Build App Bundle(s) / APK(s) → Build APK(s)** 를 선택합니다.
5. 만들어진 `app/build/outputs/apk/debug/app-debug.apk`를 Quick Share, Google Drive, 메신저 등으로 갤럭시에 옮겨 설치합니다. USB는 필요 없습니다. 배포용 arm64 APK는 별도의 고정 릴리스 키로 서명해야 기존 버전에 그대로 업데이트할 수 있습니다.

처음 설치할 때 갤럭시가 요청하면 APK를 연 앱에 대해 ‘알 수 없는 앱 설치’를 이번에만 허용합니다. 테스트가 끝나면 해당 권한을 다시 끄는 것을 권장합니다.

GitHub **Actions → Build and test Android APK → Run workflow**로도 컴파일·에뮬레이터 검사를 실행할 수 있습니다. `galaxy-remote-apk-build`에는 테스트용 Debug APK와 서명 전 Release APK가 들어 있습니다. 기존 설치 앱에 덮어 설치하는 업데이트는 원본 릴리스 키로 서명해야 합니다.

## 새 도메인 및 업데이트 서명

목표 주소는 `https://remote.ashkite.kro.kr`입니다. DNS와 HTTPS 인증이 완료되기 전에는 기존 서버 주소를 유지합니다. 인증 완료 후 다음 옵션으로 새 앱의 최초 등록 주소를 지정할 수 있습니다. 이미 등록된 앱은 저장된 서버 주소와 기기 토큰을 유지합니다.

```bash
gradle :app:assembleRelease -PsignalingBaseUrl=https://remote.ashkite.kro.kr
```

Android SDK build-tools의 `apksigner`, `zipalign`을 PATH에 추가하고 원본 키를 사용합니다. 비밀번호는 명령 인수가 아닌 `GALAXY_STORE_PASSWORD`, `GALAXY_KEY_PASSWORD` 환경 변수로만 전달합니다.

```bash
python3 ../scripts/sign-update-apk.py \
  app/build/outputs/apk/release/app-release-unsigned.apk \
  ../public/downloads/GalaxyRemote-0.4.5-rotation-fixed-release.apk \
  ../outputs/GalaxyRemote-0.5.2-release.apk \
  --keystore /secure/original-release.jks --alias ORIGINAL_ALIAS
```

이 도구는 기존 APK와 새 APK의 서명 인증서가 다르면 결과물을 발행하지 않습니다. 서명 일치와 ZIP 정렬 검사는 실제 휴대폰에서의 업데이트 설치 검증을 대신하지 않습니다. 설치 후 기기 등록·설정이 유지되는지 확인한 뒤 다운로드 링크를 교체합니다.

## 연결 순서

1. PC에서 Galaxy Remote 사이트에 ChatGPT 계정으로 로그인합니다.
2. **기기 등록**을 눌러 6자리 일회용 코드를 만듭니다.
3. 앱에서 코드를 입력합니다. 이때 기기 전용 토큰이 Android Keystore로 암호화되어 저장됩니다.
4. 앱의 **접근성 설정 열기**에서 `Galaxy Remote 조작`을 허용합니다.
5. Discord처럼 복잡한 채팅 앱을 자주 쓴다면 선택 사항인 **Galaxy Remote 키보드**를 켜고 현재 키보드로 선택합니다.
6. 앱의 **연결 요청 알림**을 켜 둔 뒤 PC 사이트에서 **연결 시작**을 누릅니다.
7. 휴대폰에 도착한 알림에서 **승인**을 누르고 Android의 화면 공유 확인창에서 전체 화면을 허용합니다.

일반 연결은 휴대폰 알림에서 승인합니다. 앱의 **자동 연결 준비**를 누르고 Android 화면 공유를 허용하면, 공유 권한이 유지되는 동안 등록된 PC 요청에 추가 승인 없이 연결됩니다. 앱의 **화면 공유 중지**로 자동 연결을 끌 수 있습니다. 대기 알림의 **끄기** 또는 공유 알림의 **공유 중지**로 언제든 종료할 수 있습니다.

## 보안과 네트워크

- 화면·음성은 서버에 녹화하거나 저장하지 않습니다. v0.5.2 소스는 별도 허용을 받은 앱 재생 소리 전송을 지원하며 마이크를 열지 않습니다. 현재 배포된 v0.4.5 APK에는 이 기능이 없습니다.
- PC 로그인 계정과 일회용 코드로 기기를 묶고, 기기 API 토큰은 AES-GCM/Android Keystore로 보호합니다.
- 화면은 WebRTC DTLS-SRTP로 전송되고 조작 명령은 같은 암호화 연결의 데이터 채널을 사용합니다.
- 먼저 STUN으로 무료 직접 연결을 시도합니다. 서로 다른 통신사·회사망처럼 직접 경로가 막힌 경우에만 서버에 설정된 TURN 릴레이를 사용하며, 웹 콘솔에서 실제 경로와 지연·비트레이트·손실률을 확인할 수 있습니다.
- 일부 삼성 기기에서는 장시간 대기를 위해 **설정 → 배터리 → 백그라운드 사용 제한 → 절전 예외 앱**에 Galaxy Remote를 추가해야 할 수 있습니다.

## 개발 정보

- 최소 Android 8.0 (API 26), 대상 Android 15 (API 35)
- Kotlin/JVM 17, Android Gradle Plugin 8.9.2, Gradle 8.11.1
- WebRTC SDK: `io.github.webrtc-sdk:android:144.7559.09`
- 기본 서버: `https://galaxy-remote-control.ashkite.chatgpt.site`
