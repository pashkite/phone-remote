# Galaxy Remote v0.5.3 — continued touch input

The new app advertises `liveTouch`. A supporting web client streams one touch ID with down/move/up/cancel, sampling the newest pointer position every 40ms. Stationary samples keep a hold alive. Old apps retain release-time tap/longPress/swipe behavior.

Android serializes 24ms Accessibility `StrokeDescription.continueStroke` segments. Moves waiting behind a running segment are coalesced; down and up are preserved. Input validates IDs, coordinates, phases and display size. A 1500ms heartbeat timeout, disconnect, blur, hidden document, pointer cancellation or lost capture releases the held touch. Device rotation terminates the gesture. Global navigation cancels the current web pointer first; wheel events cannot interrupt a held drag.

No new permissions or anonymous access were added. Input runs only during an authorized active remote session. Streaming touch samples use the existing ordered authenticated control channel without per-frame command acknowledgements. Accessibility acceptance does not guarantee an app's response; network and video latency still apply.

Validation: Node sender/legacy pointer tests and TypeScript; Android build and Android 16 instrumentation test verify down and movement before up, release and missing-heartbeat cleanup. Actual Galaxy update installation and subjective feel require device verification. Signed APK uses the existing release certificate and versionCode 17, preserving registrations in an in-place update.
