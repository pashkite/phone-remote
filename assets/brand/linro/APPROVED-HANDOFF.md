# LINRO / 린로 — Approved branding handoff for Codex

Brand decision, approved 2026-10-30:
- **Name is fixed:** LINRO (린로). Meaning: **Link Road**, a path connecting devices.
- **Approved main icon:** FIRST icon concept, dark navy rounded square, one white/pale-blue index finger from the bottom-left reaching toward a deep-blue index finger from the upper-right; small bright two-stroke connection spark near their fingertips. No embedded lettering.
- Palette: primary navy `#0B1B3D`, blue `#3B82F6`, off-white `#F8FAFF`; modest gradients, premium and minimal. These hex codes are proposed tokens rather than measurements from the raster.
- The user's selected image is preserved in ChatGPT Library folder `/Projects/LINRO/`: `linro-icon-1024.png` (canonical 1024px PNG), `LINRO_icon_assets.zip` (resized PNG and ICO exports), and `LINRO-first-concept-board.png`.
- This branch additionally contains a small WebP visual reference. When possible, use the 1024px PNG as source of truth. Reproduce visually; avoid unrelated logos, icons, or design styles.

Repo implementation notes for future Codex run:
1. Web `app/layout.tsx` currently contains `Galaxy Remote` and routes favicon to `/favicon.svg`.
2. Android label and icon are in `android-client/app/src/main/AndroidManifest.xml`: `@string/app_name`, `@drawable/ic_launcher`; strings in `android-client/app/src/main/res/values/strings.xml`.
3. Prepare real Android adaptive icon foreground/background and monochrome variants; simply dropping the square raster in foreground can cause bad clipping.
4. On explicit implementation request, update visible UI naming, icons, favicon, manifest, setup copy, documentation. **Preserve package identifier, APK signing, pairing/credentials, API contracts, WebRTC, and user data**.
5. Do not modify `main`, active feature branches, or production until user explicitly asks. Perform the branding implementation in its own branch and verify build/test results.
6. App icon must remain recognizable at 16–32px. Use a reduced-detail favicon if necessary; no text in favicon.

Suggested Codex prompt:
> Please implement the approved LINRO rebrand in pashkite/phone-remote, using assets in `assets/linro-brand-reference` and the canonical source PNG from ChatGPT Library `/Projects/LINRO/linro-icon-1024.png` if accessible. Rename only user-facing brand labels; build complete web favicon/PWA + Android adaptive-icon assets, preserve package IDs/signatures and pairing, do not modify main or production, and run tests.
