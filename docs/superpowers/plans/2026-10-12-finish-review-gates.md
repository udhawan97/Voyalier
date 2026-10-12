# Finish the review integration gates

Complete the already selected dev-review remediation and the user's instruction to finish, merge, and push.

1. Correct the Windows source build's unused inactive dialog constructor through precise platform configuration, without relaxing lint or tests.
2. Update only the three dependency families blocking the production audit: http-cache-semantics 4.3.0, source-map-js 1.2.2, and sharp 0.35.5 with matching optional binaries. Preserve parent version constraints and reject unrelated lockfile drift.
3. Independently review the bounded changes, replay affected checks and the protected exact-head CI, refresh the code graph, and complete the private implementation report and two-round council.
4. Merge only when all required source checks pass, then align the clean primary checkout with remote main. Preserve unrelated worktrees. No release or installed-app acceptance is inferred.

Stop if a proposed dependency is incompatible, the audit still fails, or the platform correction changes runtime behavior. Record concrete evidence and retain the existing branch instead of bypassing a gate.
