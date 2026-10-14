# Galaxy Remote domain and Android follow-up — 2026-10-14

Existing Site: `appgprj_6a589c9a8e588191830cce459783c685`.
Target: https://remote.ashkite.kro.kr . Existing publication remains available at
https://galaxy-remote-control.ashkite.chatgpt.site . The target is registered in
Sites as `appgdom_6acf036990b4819188e84a061870acdc`. Native domain status and
TLS status were both confirmed active on 2026-10-14.

Configure these records in the domain's DNS account:

| Type | Full name | Value |
|---|---|---|
| CNAME | remote.ashkite.kro.kr | custom-domains.chatgpt.site. |
| TXT | _openai-site-verification.remote.ashkite.kro.kr | openai-site-verification=An44pY9OP2bWPIriP3ShRH4cbae5itSCh886nmd7WP0 |
| TXT | _cf-custom-hostname.remote.ashkite.kro.kr | b43e8738-b3e8-495c-a497-c632ed1b5704 |

After the native domain status is active, check HTTPS, ChatGPT sign-in, pairing
and existing-device control at the new origin. Do not redirect the old API origin
or erase stored device credentials: existing apps use it for authenticated requests.
Browser-local preferences belong to each origin and may need to be set again.
Both domains must route to this same Site and D1 registrations.

The Android bootstrap URL is now selectable through the `signalingBaseUrl`
Gradle property, restricted to the two known HTTPS origins. The working default
remains unchanged until the target is active. See android-client/README.md.

`scripts/sign-update-apk.py` prepares ZIP alignment for 16KiB pages, signs with
an externally supplied original key, verifies the previous APK and checks equal
certificate fingerprints before issuing a new output. Passwords use environment
references; no new key is generated and the published download is not replaced.

The original matching key and password were recovered from the user's Google
Drive. The existing backup folder was moved into `ChatGPT/개발/Galaxy Remote 서명 백업`
without changing sharing. Its certificate SHA-256 is
`148c6e2701937b6e3f319569bb31b36311bfd44ed05898c6ba802ec8389d1941`, matching the
published v0.4.5 APK. No private key or password is committed.

The signed ARM64 v0.5.2 APK is `public/downloads/GalaxyRemote-0.5.2-release.apk`.
SHA-256: `ad10086a726f203472bbaa2c5a6d158420daaddf6a7296dec1e11acc44d42253`.
Its signature was verified with apksigner and compared with v0.4.5. The CI
zipalign binary needs libc++.so, which is absent here; Gradle's already aligned
APK was signed directly after independently checking every stored ZIP entry's
data offset (16KiB for native .so libraries, 4 bytes for other stored entries).
The signed APK's offsets passed the same check. The signing helper now also
recognizes the current apksigner `V3.0 Signer` certificate output.

Remaining verification limits: no physical Galaxy, in-place installation,
physical battery measurement, or actual audio/TURN transfer test in this workspace.
The UI labels the update as awaiting real-phone installation verification and
retains the previous v0.4.5 download. The APK's working bootstrap is the existing
Site origin; both origins route to the same Site. New domain browser sign-in and
actual remote control remain unverified.
