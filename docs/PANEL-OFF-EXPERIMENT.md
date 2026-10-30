# Galaxy Remote 2.0: physical panel OFF experiment

Baseline: `cb9666b42d1bc3a2cc241097e7014d228f35c4d5`.
Status: **CONDITIONAL GO for device experiments only. Hardware behavior UNVERIFIED.**
No production deployment, paid relay, root backend, overlay or brightness trick.

## Build and installation

Use JDK 17, Gradle 8.11.1, Android SDK platform 35 and build-tools 35.0.0:

```sh
cd android-client
gradle :app:testPanelTestUnitTest :app:assemblePanelTest --max-workers=3
```

`app/build/outputs/apk/panelTest/app-panelTest.apk` is a debug-signed **arm64-v8a**
APK with application ID `com.galaxyremote.app.paneltest`. It installs alongside
the original app. Do NOT uninstall the original app, clear its storage or replace
its signing key. Pair the test app separately using the existing Sites console.
The test app has separate credentials/Keystore; original registrations are not
copied. Both retain the same server login/pairing protocol. The experimental
entry exists only in panelTest; ordinary debug/release keep it disabled.

Original release signing key is not supplied in this workspace. Update-signature
compatibility with installed 0.5.3 is UNVERIFIED; this APK is not an update for it.
Production signing must later use the original key and verify certificate identity
against the actual installed release with scripts/sign-update-apk.py. Do not
generate a replacement production key or claim debug-signature equivalence.
CI now builds panelTest and includes its APK in the existing APK artifact; it
does not deploy. CI-generated debug keys may differ from this workspace's test
key, so do not assume one test APK can update another signed elsewhere.

## Architecture and safety boundaries

MediaProjection, VP8/WebRTC, Sites authentication and D1 pairing are retained.
No browser shell endpoint or extra server is introduced. On the phone, the
experimental button opens a local-only, non-exported Activity. Shizuku must be
started with ADB/wireless debugging as UID 2000; a root backend is rejected.
Shizuku user approval is required before binding the UserService.

The AIDL interface accepts no executable, arbitrary command, path or display ID.
It supports fixed display **0 only**, inspect, recovery preflight, one-shot arm,
bounded OFF, restore and service destruction. Unsupported firmware fails closed.
The app displays DisplayManager state separately from Keyguard state; neither
the shell exit status nor logical display state proves physical panel OFF.
The actual display-to-panel mapping must be verified by the local operator;
foldables/DeX/multi-display configurations are outside this first prototype.

OFF requires an active WebRTC connection, successful recovery-command preflight,
and explicit local attestation that external recovery and panel mapping were
verified on this device/firmware. The app cannot independently prove that
attestation. Do not check it just because a command succeeded while already ON.
Every trial consumes consent; run preflight and approve again for another trial.
No proof is persisted across process death, firmware changes or reboot.

Before OFF, the service starts a separate fixed shell timed-restoration process
and schedules its own restore. App Binder death and app heartbeat loss (eight
seconds) trigger restoration in the shell service. Normal disconnect, projection
stop, shutdown and service destruction request restore.
The app monitors permission/binder/connection loss, holds a bounded partial
wakelock during the trial, and releases the existing single held accessibility
pointer when restoring. It does not implement new multi-touch or a gaming UI.

The independent shell child is intentionally not cancelled by normal restore.
It may reset power again at the original deadline. Wait until that deadline
before another trial. Surviving UserService/Shizuku/process-group termination
and actual panel restoration are **UNVERIFIED on One UI**. No software-only
watchdog can guarantee recovery when all shell processes are killed or firmware
rejects commands. Keep a separately verified physical/ADB recovery path.

## Device preflight — no OFF until recovery is verified

1. Use a spare unlocked Galaxy, stable power and a trusted LAN. Record model,
   Android version, One UI version, security patch and build fingerprint.
2. First validation may use a PC with **Android platform-tools/ADB**. This is
   setup/diagnostics tooling, not the ongoing PC remote-play client. Do not expose
   wireless ADB to the Internet. Never disable lockscreen security protections.
3. Run `adb devices -l`. Select one explicit serial. Collect read-only evidence:

   ```sh
   python3 scripts/panel-preflight.py --serial DEVICE_SERIAL > preflight.json
   ```

   This script never executes OFF, lock, sleep or input. Reports can identify the
   device and should remain local unless intentionally shared.
4. Read `adb -s DEVICE_SERIAL shell cmd display help`. scrcpy documents
   `power-on`, while the inspected AOSP Android 16 branch exposes `power-reset`.
   Use only what this firmware advertises. Unknown command means STOP.
5. Inspect `dumpsys display`, `dumpsys power`, window/keyguard state and panel
   mapping. Restrict the prototype to the verified built-in display 0. Establish
   a working external restore and physical wake path on this specific device.
   A lit-screen command probe can be performed with `--probe-recovery`; it does
   NOT by itself verify recovery from a forced-OFF state.
6. If the operator cannot establish recovery confidently, **stop at read-only
   preflight**. Do not execute OFF merely to discover whether recovery works.
   This repository contains no automatic ADB OFF command for that reason.

## Execution after external recovery approval

1. Install the isolated APK (`adb -s SERIAL install app-panelTest.apk`), pair it
   with the existing Sites website, enable its accessibility service, and approve
   MediaProjection. Start a normal browser connection and verify new frames and
   baseline tap/hold/drag with the screen ON.
2. Start non-root Shizuku, then open **물리 패널 OFF 실험 (미검증)** in the phone app.
   Request permission; after approval bind the service. Query display mapping
   and run the ON-state recovery command preflight. Read the output.
3. Only after independent recovery verification, check the local attestation.
   Choose the 30-second trial. There is a five-second delay to return to a game.
   Going to the game must leave the test Activity alive; destroying it cancels
   a not-yet-started delayed trial. The connection must still be active at OFF.
4. Observe the physical panel and system/HWC power evidence together. An OLED
   black image, screenshot or zero brightness is not proof. Record fresh game
   frames in the browser and compare to device-side capture/frame counters.
5. Test single tap, long press and drag. Use a simple single-touch game first.
   Current input is single-pointer; simultaneous movement and attack are not
   supported. Log whether failures are capture, input, game pause or network.
6. Check timed recovery and normal disconnect recovery. Wait for the original
   timer deadline before a new trial. Repeat preflight/local attestation and use
   the 330-second trial only after the short trial and recovery pass. Verify more
   than five minutes of continuous fresh frames and input.
7. With a verified external rescue path, separately test browser close/network
   loss, app force-stop, UserService death, Shizuku stop/permission revocation and
   projection stop. Record restore time and release of held gestures for each.
   Never substitute a PID or successful shell exit for hardware observations.
8. Reboot: old projection and local arm must not survive; restart non-root Shizuku,
   approve projection and repeat preflight. Wireless-debug pairing may persist,
   but Shizuku must be started again. Phone-only setup is unverified on One UI.

## Required evidence checklist

All boxes below are **UNVERIFIED** until filled from a real device:

- [ ] Display 0 is the actual intended panel; external restore works.
- [ ] Physical panel OFF with device unlocked and game process/rendering alive.
- [ ] Fresh capture frames reach the browser, rather than a frozen last frame.
- [ ] Tap, long press, drag work while OFF; all held input releases on exit.
- [ ] More than five minutes of continuous gameplay; FPS/temperature measured.
- [ ] Normal disconnect restores panel and releases input.
- [ ] Timed fallback, app death, shell-service death and Shizuku loss restore.
- [ ] Reboot/startup/consent procedure reproduced on Android 15 and Android 16.
- [ ] Original app/data remain intact after side-by-side installation.

## Android 16 drag failure and existing build limitations

docs/RELEASE-v0.5.3.md records an initial UiAutomation suppression problem, then
an unresolved probe-window fixture issue. LiveTouchTest now sets
FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES. That is not proof of a passing run.
Actions API was blocked (proxy 403) and Actions HTML returned 404 during stage 1;
original run IDs, assertions and logcat have not been independently retrieved.
Do not call this a confirmed Android 16 gesture regression or fixed device test.
Next: correlate fresh JUnit XML with accessibility connection, focused/resumed
TouchProbeActivity, DOWN/MOVE/UP logcat, dispatchGesture callbacks and watchdog.
The existing workflow preserves test exit status and uploads these reports.

The existing debug APK targets x86_64 emulator; panelTest targets arm64 Galaxy.
The checked-in public downloads contain only 0.4.3 APKs despite newer web links.
This experiment does not overwrite downloads, change the website or publish APKs.

## Fallback if MediaProjection stops

Record callback reason and Keyguard state first. Do not bypass lock/secure content.
Consider scrcpy-style shell capture only as a separate implementation: privileged
capture surface/display setup, rotation and resize handling, MediaCodec output,
then a custom WebRTC video source/encoder bridge or conversion to WebRTC frames.
scrcpy's encoded stream is not a browser RTP track. Codec negotiation, timestamps,
keyframes, congestion control and cleanup need design and validation. Avoid
decode/re-encode latency. Virtual-display game execution is another compatibility-
limited experiment, not an automatic solution. No such fallback is implemented.

## Decision

CONDITIONAL GO for the isolated APK/device experiment. Stage 3 gaming/UI work is
blocked until real panel OFF, fresh video/input and normal/abnormal recovery pass.
No device success, One UI compatibility or production-update compatibility is
claimed by compilation or unit tests.

## Current-instance build evidence (2026-10-30)

- JDK 17.0.18, Gradle 8.11.1, SDK 35/build-tools 35.0.0.
- `testPanelTestUnitTest`: 3 tests, 0 failures/errors/skips.
- `assemblePanelTest`, `assembleDebug`, `assembleRelease`,
  `assembleDebugAndroidTest`: passed. Instrumentation APK compilation is not
  execution; no device/emulator was attached (`adb devices -l` empty).
- `python3 -B -m unittest discover -s scripts/tests -v`: 4 safety tests passed.
- `node --test tests/*.test.mjs`: 7 file targets passed.
- Final test APK: arm64-v8a only, package `com.galaxyremote.app.paneltest`,
  debug certificate SHA-256
  `8f568dd3778c9b0f8a316427c1a2e048a2f454f153a9b6d40dd3e4337dd0748f`.
- APK v2 signature and 16KiB ZIP alignment checks passed. This does not prove
  native ELF page-size compatibility or successful installation on a device.
- APK SHA-256:
  `f635c8f7fd70b0220dd7c712b71fd067f67c68f788d177f0a4428108770e78bb`.
- Local copy: `outputs/panel-off/GalaxyRemote-2-paneltest-arm64.apk` (ignored,
  not published or committed as a production download).
- Physical panel OFF, fresh video, input while OFF, five-minute session,
  all restoration paths and reboot procedure: **UNVERIFIED**.

## References

- [scrcpy display power](https://github.com/Genymobile/scrcpy/blob/master/doc/device.md#turn-screen-off)
- [scrcpy virtual display](https://github.com/Genymobile/scrcpy/blob/master/doc/virtual-display.md)
- [scrcpy controller](https://github.com/Genymobile/scrcpy/blob/master/server/src/main/java/com/genymobile/scrcpy/control/Controller.java)
- [scrcpy cleanup](https://github.com/Genymobile/scrcpy/blob/master/server/src/main/java/com/genymobile/scrcpy/CleanUp.java)
- [Android 16 display commands](https://github.com/aosp-mirror/platform_frameworks_base/blob/android16-release/services/core/java/com/android/server/display/DisplayManagerShellCommand.java)
- [Android 16 MediaProjection API documentation](https://github.com/aosp-mirror/platform_frameworks_base/blob/android16-release/media/java/android/media/projection/MediaProjection.java)
- [Shizuku API and UserService](https://github.com/RikkaApps/Shizuku-API)
