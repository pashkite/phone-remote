# Galaxy Remote

ChatGPT 계정으로 로그인한 PC에서 자신의 갤럭시 화면을 보고 조작하는 USB 없는 원격 제어 MVP입니다. 웹 콘솔과 Android 동반 앱이 한 저장소에 들어 있습니다.

## 구성

- `app/`: ChatGPT 로그인, 기기 등록, WebRTC 시그널링, 원격 화면·조작 UI
- `app/api/`: 일회용 페어링, 기기 인증, 상태 확인, offer/answer 교환 API
- `db/`, `drizzle/`: D1 기기·세션·페어링 스키마와 마이그레이션
- `android-client/`: MediaProjection, AccessibilityService, WebRTC 기반 Android 앱

## 동작 방식

1. 웹 사용자가 ChatGPT 계정으로 로그인해 10분 유효한 6자리 코드를 만듭니다.
2. Android 앱이 코드를 한 번 사용해 기기 전용 토큰을 발급받고 Android Keystore에 암호화해 저장합니다.
3. 앱의 연결 요청 알림 서비스가 등록된 PC의 요청만 가볍게 확인합니다.
4. PC에서 연결을 시작하면 휴대폰 알림에서 승인하고 Android 화면 공유 확인창을 허용합니다.
5. PC와 휴대폰이 trickle ICE로 WebRTC 연결을 만들고, 화면은 영상 트랙으로, 터치·스와이프·키·볼륨 명령은 암호화된 데이터 채널로 전달됩니다.

로그인만으로 Android의 화면 공유 및 조작 권한을 대신할 수는 없습니다. Android 보안 정책에 따라 연결 요청마다 휴대폰 알림과 시스템 화면 공유 창을 승인해야 하고, 조작에는 접근성 권한이 필요합니다.

## 로컬 웹 개발

필수 환경은 Node.js 22.13 이상입니다.

```bash
npm ci
npm run dev
```

스키마를 바꾼 뒤에는 `npm run db:generate`로 D1 마이그레이션을 생성합니다.

## Android APK

Galaxy arm64 v0.4.2 APK는 웹 콘솔의 기기 등록·설정 창에서 받을 수 있습니다. v0.4.0·v0.4.1과 같은 릴리스 키로 서명되어 해당 버전에서는 앱을 삭제하지 않고 바로 업데이트할 수 있으며, 페어링과 설정도 유지됩니다. v0.3.1 이하는 서명키가 달라 기존 앱을 삭제한 뒤 설치해야 합니다. 업데이트 후 앱에서 Android 화면 공유를 한 번 허용하면, 화면 공유 서비스를 중지하거나 휴대폰을 재부팅하기 전까지 등록된 PC의 연결 요청을 자동으로 승인합니다. 직접 빌드할 때의 설치·권한 설정은 [`android-client/README.md`](android-client/README.md)를 참고하세요.

## 배포 환경

`.openai/hosting.json`의 D1 바인딩 이름은 `DB`입니다. 직접 연결이 불가능한 NAT/회사망을 포함해 인터넷 어디서나 안정적으로 연결하려면 배포 환경에 Cloudflare Realtime TURN의 다음 보안 값을 추가합니다.

- `TURN_KEY_ID`
- `TURN_API_TOKEN`

값이 없으면 `stun:stun.cloudflare.com:3478`을 사용하며, 일부 네트워크 조합에서는 연결되지 않을 수 있습니다.
