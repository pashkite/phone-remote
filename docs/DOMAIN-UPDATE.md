# Galaxy Remote domain and Android follow-up — 2026-10-14

Existing Site: `appgprj_6a589c9a8e588191830cce459783c685`.
Target: https://remote.ashkite.kro.kr . Existing publication remains available at
https://galaxy-remote-control.ashkite.chatgpt.site . The target is registered in
Sites as `appgdom_6acf036990b4819188e84a061870acdc`, but DNS/TLS validation is pending.

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

Blockers: original matching private key is still unavailable; this environment
has no physical Galaxy or Android SDK. No compatible signed update, in-place
installation, physical battery measurement, actual audio/TURN file-transfer test,
or active custom-domain connection is claimed.
