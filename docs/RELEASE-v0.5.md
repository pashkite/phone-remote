# Galaxy Remote v0.5 implementation and verification

The implementation preserves the current Site's v0.4.5 fixes, Android package `com.galaxyremote.app`, registration storage, D1 schema, account authorization, old APKs, screen rotation and detached window controls. Android source version is 0.5.2 / versionCode 16. No new release signing key was generated.

| Feature | Implemented behavior | Verification boundary |
|---|---|---|
| Standby | Server pollAfterMs, fast/balanced/saving minimum 1.8/4/12s; 60s heartbeat; bounded error backoff; disabled idle video track and 1fps adapter without restarting MediaProjection | No physical battery comparison; 20% reduction is a target, not a measured result. The live projection must stay open for consent-preserving automatic reconnect. |
| Command results | Protocol v1, UUID, session sequence, received/accepted/completed/failed, browser timeout, duplicate/stale rejection, gesture callback completion | Android completion does not prove the intended in-app button effect. |
| Clipboard | Explicit 64KiB UTF-8 text send; foreground app/default IME send to PC; review before copying on PC; focused input paste | No background read workaround or automatic sync. Android/OEM restrictions need real-device testing. |
| Audio | AudioPlaybackCapture of permitted media/game playback; 48kHz mono PCM16, separate unreliable WebRTC channel, bounded playback queue and gain control; microphone is not opened | This is a PCM fallback, not an Opus/RTP audio track. Precise audio/video synchronization, latency and protected-app behavior are unverified. RECORD_AUDIO consent is required in the phone app. |
| Capture/record | Original received-frame PNG; MediaRecorder format selection; audio included when enabled before recording; stop and retain on disconnect; streamed saving through the browser file picker with bounded writer backpressure; 128MiB segment fallback on other browsers | Browser download/MediaRecorder and long recordings need browser/device testing. Download is local to the PC. |
| Files | Separate reliable channel; explicit approval; SAF destination; SHA-256; 16KiB chunks; 256KiB send buffer threshold; 100MiB/file; up to 20 queued files; cancellation and temporary file cleanup | Resume is unsupported: restart interrupted transfers. Actual phone, mobile-network and TURN transfer are unverified. Android receives into private temporary storage before verified copying to the chosen destination. A provider may refuse deletion of an empty/partial destination on failure. |
| Diagnostics | Web 500-event memory ring and Android 200-event private ring, 24h expiry; JSON exports; states, result codes, stats, standby requests, battery and UID traffic counters, with PC export remaining available after disconnection | UID bytes are aggregate Android counters, not a per-session measurement. Logs exclude payloads, tokens, filenames, IP/ICE addresses and credential strings. Android native tombstone detail is not in this export. |

Extension channels open only after the phone explicitly advertises their capabilities. Older apps continue to receive the original control messages; no extension hello is sent to an unadvertised legacy peer. Native channel lifecycle closes file/audio resources with the peer. A device-authenticated live-session check closes revoked/replaced sessions and fails closed after 45 seconds without a successful check. This uses the existing D1 session state without changing schema.

## Source map

Web: `lib/remote/{protocol,client,files,media,diagnostics}.ts`, `app/components/remote-tools.tsx`, `app/remote-console.tsx`, `app/globals.css`, `app/api/device/lease/route.ts`.

Android: `RemoteCommandProcessor.kt`, `RemoteFileTransfer.kt`, `PlaybackAudioCapture.kt`, `RemoteDiagnostics.kt`; integration in `WebRtcSession.kt`, `RemoteControlService.kt`, `ConnectionListenerService.kt`, `MainActivity.kt`, `RemoteKeyboardService.kt`, `RemoteAccessibilityService.kt`, `RemotePreferences.kt`, `ApiClient.kt`, application crash handler, manifest, layout and build version.

## Checks

- Production Worker build and Sites artifact validation passed.
- `npx wrangler types worker-configuration.d.ts --config dist/server/wrangler.json`, then `npx tsc --noEmit`: passed.
- `npm run lint`: passed.
- `node --test tests/*.test.mjs`: 24 passed, including original geometry/detached-window regressions, authorization rendering, chunk encoding, corrupt/out-of-order/oversized transfer rejection, byte-identical approved transfers, queue progression, timeouts, legacy-channel negotiation and diagnostic filtering.
- Android CI successfully compiled Debug and unsigned Release packages. The first emulator run failed before instrumentation because its disposable runner had insufficient disk for Android 16 userdata; unused preinstalled build tools are now removed before boot and APK artifacts upload before emulator testing. Its initial run failed before compilation because setup-android requested the retired `tools` package; the workflow now requests actual platform/build-tools packages.
- Final Android CI run https://github.com/pashkite/phone-remote/actions/runs/38399740143 succeeded. Kotlin/Debug/unsigned Release/AAB builds passed; Android 16 emulator ran two instrumentation tests (screen projection/WebRTC loopback and duplicate/stale command handling), both passed. Debug and unsigned Release APKs are in the `galaxy-remote-apk-build` artifact, available until 2026-10-14 12:49 UTC. These are not a signed in-place update.
- Physical Galaxy S26 Ultra, battery A/B comparison, TURN, real clipboard policies, playback audio, rotation under live control, provider failures and long recordings are NOT verified in this workspace.
- Managed browser QA is unavailable in this environment. No actual browser WebRTC session is claimed.

## Signing and deployment

Web publication succeeded as Site version 37, deployment `appgdep_6ace275eb8c08191bb6a5ee6c7b8698c`, https://galaxy-remote-control.ashkite.chatgpt.site . A subsequent diagnostic-only update will receive its own saved version.

The existing release key is not accessible in this workspace. Keep the existing v0.4.5 download in place. Do not install a debug/new-key build over the existing app or uninstall the existing app to try it. To produce a compatible update, sign the compiled Release APK with the original release key and verify its certificate fingerprint against the installed/previous APK, then test in-place upgrade with registration and preferences retained. Only after that should the APK download link change.

Preserved v0.4.5 APK SHA-256: `9f72a3ac3e6be2ee70d0e004387f6150850c34057c5e0e190107934c5ffce721`.

## Rollback

Site source baseline: `fa55666013398a3adeaa5f776b8be899bd58f191` (saved version 36). Verified prior live publication: version 35, `appgprj_6a589c9a8e588191830cce459783c685~appgver_6e42dbb8e0fc81919c9fc3733862ba2c`. Redeploy that saved version to roll the web back without editing/deleting D1 registrations. Current Android APKs are retained. Android downgrades with a smaller versionCode may be rejected by Android; do not promise an in-place native downgrade, and do not remove app data to force it.

## Required follow-up verification

Use the original signing key; install the update over v0.4.5; check retained registration; exercise each permission refusal, gesture cancellation, input target loss, app reboot, rotation, lock, Wi-Fi/mobile transition, TURN transfer (empty and 100MiB files), queue/cancel/hash mismatch, disconnection during capture/recording/transfer, registration revocation and session replacement. Measure old/new standby drain under equal brightness, network, charging and automatic-connect settings. Do not label these passed until they are observed.

Primary references: https://developer.android.com/media/grow/media-projection ; https://developer.android.com/media/platform/av-capture ; https://developer.android.com/about/versions/10/privacy/changes#clipboard-data ; installed WebRTC 144.7559.09 API inspected in the existing APK and compiled Android source.
