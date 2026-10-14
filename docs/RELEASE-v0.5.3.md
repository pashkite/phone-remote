# Galaxy Remote v0.5.3 — continued touch input

The new app advertises `liveTouch`. A supporting web client streams one touch ID with down/move/up/cancel, starting a live drag only after 8 CSS pixels of actual movement, then sampling the newest pointer position every 32ms. Clicks send a single tap without opening a held stroke. Stationary heartbeats are limited to once per 512ms. Old apps retain release-time tap/longPress/swipe behavior.

Android serializes 24ms Accessibility `StrokeDescription.continueStroke` segments. Moves waiting behind a running segment are coalesced; down and up are preserved. Input validates IDs, coordinates, phases and display size. A 1500ms heartbeat timeout, disconnect, blur, hidden document, pointer cancellation or lost capture releases the held touch. Device rotation terminates the gesture. Global navigation cancels the current web pointer first; wheel events cannot interrupt a held drag.

No new permissions or anonymous access were added. Input runs only during an authorized active remote session. Streaming touch samples use the existing ordered authenticated control channel without per-frame command acknowledgements. Accessibility acceptance does not guarantee an app's response; network and video latency still apply.

Validation: Node sender/legacy pointer tests and TypeScript; Android build and Android 16 instrumentation test verify down and movement before up, release and missing-heartbeat cleanup. Actual Galaxy update installation and subjective feel require device verification. Signed APK uses the existing release certificate and versionCode 17, preserving registrations in an in-place update.

## Signed package evidence

- Android package: `com.galaxyremote.app`, versionName `0.5.3`, versionCode `17` (checked from binary APK manifest).
- Certificate matches the published v0.5.2 APK; APK signature and 16KiB ZIP alignment verified.
- APK SHA-256: `6422c6ac900ea8aff4a728341297d7bbe0dbec6c8f70c0d2eb1796bbf5547b1d`.
- Release binary built from commit `f85feff2062a913e0f83e653953d0feb2c7c9426`; subsequent changes only adjust instrumentation and web cleanup.
- Initial Android 16 run failed before touch injection because UiAutomation suppressed accessibility services; rerun enables `FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES`.

## Web response to real-device feedback

The original immediate held-touch stream incorrectly turned ordinary clicks into gesture traffic and sent redundant moves while stationary. The web correction separates click/drag, reduces idle movement traffic, caps touch-channel buffering at 2KiB, and adds a 540p/60fps response-first quality preset. It works with the existing v0.5.3 APK. Tests cover jittered clicks, thresholded streaming, blur cancellation and idle suppression. Android automated touch verification is still blocked by the probe-window fixture; do not describe it as passed. Real end-to-end latency after this correction remains unmeasured.
