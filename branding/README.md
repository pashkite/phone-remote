# LINRO asset handoff (Codex)

**Approved**: LINRO (린로), from `Link Road`, with the user's **first** hand-touching icon concept.

## Files in this branch
- [LINRO brand decision](./LINRO-BRAND-CODEX.md)
- `linro-icon-preview-256.webp.b64`: **256px visual preview**, not the full-resolution canonical asset. To decode:
  ```bash
  base64 -d branding/linro-icon-preview-256.webp.b64 > branding/linro-icon-preview-256.webp
  ```
  On Windows PowerShell:
  ```powershell
  [IO.File]::WriteAllBytes("branding/linro-icon-preview-256.webp", [Convert]::FromBase64String((Get-Content branding/linro-icon-preview-256.webp.b64 -Raw)))
  ```

## Canonical source (not yet committed to GitHub)
The original **1024px PNG**, favicon ICO, resized PNG files, design board, and archive are preserved in the user's ChatGPT Library at `/Projects/LINRO/`. The preview is faithful but compressed and must not be confused with the full-resolution source. If Codex cannot access the Library asset, ask for the ZIP/PNG to be attached to the Codex task before final production icon export.

## Safety
This branch is an asset/reference branch only. The website and Android APK have **not** been renamed or deployed. Future integration must preserve the Android app ID/signing certificate and current connection/pairing behavior, and avoid writing to `main` or production without approval.
