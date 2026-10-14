# Finish the review integration gates

Complete the already selected dev-review remediation and the user's instruction to finish, merge, and push.

1. Correct the Windows source build's unused inactive dialog constructor through precise platform configuration, without relaxing lint or tests. For a pre-harness Windows loader failure, inspect the test manifest and compare a byte-identical disposable test executable with only the existing Common Controls v6 dependency added. Adopt a source-test-only activation fix only if that comparison succeeds; preserve packaged app resources and rerun every existing desktop check. The hosted copy comparison proved missing v6 activation, but Cargo rebuilt the prepared artifact before launch. Bind the same guarded correction to actual test launch with a transient Windows Cargo target runner; forward harness arguments and native exit status unchanged. Do not infer the unrecorded Cargo fingerprint invalidation cause.
2. Update only the three dependency families blocking the production audit: http-cache-semantics 4.3.0, source-map-js 1.2.2, and sharp 0.35.5 with matching optional binaries. Preserve parent version constraints and reject unrelated lockfile drift.
3. Independently review the bounded changes, replay affected checks and the protected exact-head CI, refresh the code graph, and complete the private implementation report and two-round council.
4. Merge only when all required source checks pass, then align the clean primary checkout with remote main. Preserve unrelated worktrees. No release or installed-app acceptance is inferred.

Stop if a proposed dependency is incompatible, the audit still fails, or the platform correction changes runtime behavior. Record concrete evidence and retain the existing branch instead of bypassing a gate.

## Selected Windows IPC fixture correction — 2026-10-13

The user selected DR-ea305767-015 after the full Windows desktop harness started and six IPC tests rejected the fixture origin. The shared fixture still supplies `tauri://localhost`, while Windows uses the local protocol workaround URL.

1. Change only the shared test `InvokeRequest` URL to the actual mock webview URL. Preserve production ACLs, capabilities, command envelopes, assertions, test filters, working directory, native runner arguments and exit status.
2. Independently review the one-line correction and replay local desktop/wire checks, all 18 Windows debug tests, and the optimized source-updater check. Treat any remaining failure as evidence; do not disable checks or infer installed-app acceptance.
3. Refresh the source graph, private report, ledger and final council gate. Merge PR126 only after the full source gates pass, then align the clean primary main with the protected remote merge. Existing merge/push authority persists; user worktrees and installed data remain preserved.
