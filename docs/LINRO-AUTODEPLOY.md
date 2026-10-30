# LINRO Sites automatic deployment operating contract
Repository: pashkite/phone-remote. Source branch: main.
Existing project: appgprj_6a589c9a8e588191830cce459783c685.
Production: https://remote.ashkite.kro.kr. Preserve audience public, domain, D1 DB binding, secrets, accounts, and all user data.

This branch (automation/linro-sites-state) is operational state, never merge it into main.
Read .openai/linro-deploy-state.json here on every run. scripts/linro-sites-sync.py here is the source synchronization helper.
Use the Sites skill and official native Sites tools; no invented deployment endpoints, GitHub Actions tokens, or long-lived Sites credentials.
The supported GitHub automation event is PR merge; ordinary pushes have no webhook in the discovered schema. The linked hourly Sites task covers both direct pushes and merges. A PR-merge task accelerates merged changes. Both must share the single state lock.

## Lock and idempotency
1. Fetch the state file from this branch using the GitHub connector, retaining its content blob SHA.
2. If lock is non-null, do not acquire, synchronize, push, save or deploy. Report an abandoned/long-lived lock once; never expire or steal it automatically.
3. Otherwise assign a unique run owner, UTC acquired_at, and write the updated complete state using github.update_file with the fetched blob SHA. Proceed only after success. A conflict means exit. Re-read and verify this run owns the lock.
4. Hold this lock through the entire publish, health checks, and any rollback. Every subsequent state update uses the fresh returned content_sha. Stop on a conflict; never overwrite another run's lock.
5. Read GitHub main head anew after acquisition; pin the entire run to that SHA. Compare last_successful_github_sha and last_checked_github_sha. An already successful or Android-only checked SHA requires no deployment.
6. Compare against last successful GitHub commit (not last checked Android-only commit), using a complete local git diff or all paginated connector results. No truncated comparisons. Web scope is exactly the sync helper's ROOTS and CONFIG; exclude APK/AAB and public/downloads. Android-only/non-web changes set last_checked_github_sha and release lock, never advance successful deployment SHA.
7. A crash or uncertain deployment leaves lock and pending metadata intact. Recovery requires checking native Sites deployments and source before a human explicitly clears or adopts the lock. Do not assume elapsed time means a run died.

## Inspect and prepare
Read get_site and existing live version/deployment; reconcile them against the state. If production or Sites source changed independently, stop and report rather than overwrite.
Verify owner/editor authorization, same project ID, audience, domain, runtime environment revision, storage bindings. Do not print tokens/secret values.
Open existing Sites source using create_source_repository_write_credential (do not opt into publish-on-push) and the Sites source helper in an empty directory; retain its returned source result.
Get the pinned GitHub main code in a separate clean checkout. Never rely on scratch contents surviving runs.
Obtain this branch's sync helper via authorized GitHub fetch or ordinary Git.
Run: python3 linro-sites-sync.py inspect <github-checkout> <sites-checkout>.
It rejects any hosting manifest, DB schema, or migration changes. Never run db:generate, DB reset, Wrangler remote migration, or unapproved schema operations.
Review the web diff for authentication weakening, exposed secrets, unbounded deletion, destructive installation hooks, and credential logging. Stop on risks. Reject symlink/path escapes.
Run sync only after review. It preserves existing APK assets, copies web source, and records the pinned GitHub SHA plus web content digest in .openai/linro-deployment.json.
Android source may be synchronized only for existing source-based tests; never build or release APK/AAB.
Use installed dependencies only when package.json/package-lock match; otherwise use the Sites installer. Node >=22.13.0 is required. No dependency version changes without separate need.

## Sequential validation (build must finish before tests)
Generate ignored worker-configuration.d.ts with Wrangler types using a local-only placeholder D1 config, as existing scripts/test-web-streaming.sh does. Run TypeScript noEmit.
Build with the Sites build-site.mjs helper, wait for success, then validate the ESM Worker artifact with the existing validate-artifact.sh. scripts/build-verified.sh already bounds the build and calls validation.
Run node --test tests/*.test.mjs only AFTER the build has completed; rendered-html.test imports dist. The API integration test uses isolated local Miniflare D1 and synthetic auth, never production mutations.
Core tests include owner/guest access, foreign-owner rejection, pairing concurrency/rate limits, consent, SDP/ICE, expiration, revocation, and build-info.
Physical Galaxy, physical screen OFF, Android APK builds are not web-deployment prerequisites. Do not bypass failed core tests.
Run python3 linro-sites-sync.py verify <github-checkout> <sites-checkout>.
Check the same environment revision and unchanged hosting/DB/migrations; verify existing APK assets' hashes unchanged.
If source inputs change, rebuild/retest affected inputs. Do not run tests while a build mutates dist.

## Package and publish
Immediately before packaging and again before deploying, re-read GitHub main. If its head differs from pinned SHA, abandon the candidate, release the lock and let the next run handle latest main. Never mix revisions or publish an obsolete pinned candidate knowingly.
Use the Sites source helper with the complete opening result, credential via hidden stdin, an archive outside the checkout, and only remaining ordered build/test commands. Do not include secrets in command arguments or files.
Normal Git push must reject concurrent Sites source updates. Never force push.
Read the native saved/published version to avoid duplicate saves/deploys if the previous operation was uncertain.
Save using save_site_version with EXACT helper-returned project_id, source commit_sha, archive.
Persist pending={github_sha,sites_sha,version_id,previous_version_id,phase} in state before deploy.
Deploy that saved version with deploy_site_version (public audience); preserve tunnel bindings by omitting that argument.
Persist deployment ID and poll get_deployment_status only while pending/building/publishing.
A terminal failure must not advance successful SHA; retain old success IDs. Use native status and live checks; never report success from a saved candidate alone.

## Health and recovery
After native success, check the existing production domain: GET / -> 200 with LINRO login UI; unauthenticated protected GET /api/devices, /api/ice, /api/build-info -> 401; unauthenticated device POST /api/device/session with empty JSON -> 401.
Also send a fabricated oai-authenticated-user-email header (the configured owner email, if safely available) without a real login; it must not bypass the gateway.
Check that a referenced hashed JS asset loads. Never create or delete production devices/sessions/pairing codes merely for smoke tests.
Owner-login/browser flow and actual Android/WebRTC end-to-end remain unverified unless explicitly exercised in an authorized signed-in session.
If post-publish checks fail and the previously healthy saved version is available with unchanged DB/env, the official deploy_site_version supports selecting it again. Restore only that known version using native tools, poll, verify health, report actual recovery. Never invent a rollback API. If uncertain, keep the lock/pending IDs and report.
After success, record last_successful_github_sha, last_successful_sites_sha, version ID, deployment ID, checked SHA, UTC completion, web digest, environment revision and health result; clear pending and lock using a CAS state update. Failed/aborted attempts release lock only after confirming no deployment is in flight.
No new site, infrastructure migration, domain/access/secret changes, DB writes, main force pushes, Android release, or messages to others.
No changes -> no repeated notification. On deploy/failure/recovery report the actual SHA, version, tests, and unverified items in Korean.

## Initial setup
2026-10-31 KST: main contained staged LINRO 2-7.5. Original live version 47 / Sites SHA 95f245704f0346037707924fe6bf69adfe216fb3.
DB, migrations, hosting manifest and ChatGPT authentication module matched. New server device auth additionally rejects a device owned by an unconfigured owner.
Four existing shell entrypoints had missing executable bits; corrected on main with normal fast-forward updates. No source content or dependency versions changed in these fixes.
The state-file CAS was exercised: a stale blob SHA write was rejected with HTTP 409.

## Validated saved-candidate handoff
A pending candidate with phase "validated_saved_candidate" and lock null is an intentional handoff, not an abandoned deployment. Acquire the normal CAS lock. Verify native get_site_version.source.commit_sha equals pending.sites_sha, GitHub main equals pending.github_sha, current live deployment remains pending.previous_deployment_id, environment revision equals pending.validation.environment_revision, no newer deployment is in flight, and the saved validation passed. No source rebuild is necessary when these match: deploy exactly pending.version_id through the native Sites tool, persist deployment ID, poll, run the health checks and finalize state. Do not push/create another candidate for the same SHA. Reject any missing/mismatching provenance or validation. If a saved version already has a deployment ID, inspect and continue it instead of starting another.\n