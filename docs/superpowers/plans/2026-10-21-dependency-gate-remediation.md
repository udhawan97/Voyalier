# Additional dependency gate scope — user selected

The seven selected application fixes are complete in PR139. Required hosted dependencies-and-secrets fails because the unchanged Vite8.3.0 resolution is covered by GHSA-587h-7wmj-h5pm. This is a toolchain advisory, not demonstrated Voyalier exploitation. The user explicitly approved fixing the gate and merging.

Bounded proposal: add exact workspace override vite8.3.3; preserve the existing compatible web range, Astro/Starlight, existing overrides, Node requirements and release-age policy. Regenerate Vite and required Rolldown1.2.11 cohort/binding entries only; stop on unrelated upgrades. Use trusted registry metadata with publication timestamps and integrity-checked artifacts; package scripts stay disabled during offline installation. No keychain/provider/native user-data work.

User selection is recorded; this plan is committed before implementation. Production specialist owns dependency files, architecture is distinct peer, senior integrates. Run frozen install, canonical web and integration stages; inspect all lock drift and native binding alignment. Refresh Graphify and review the candidate locally, then push the isolated branch to the same PR for hosted verification. This candidate push is verification only. Obtain final exact-tree receipts and complete both council rounds on the final report before protected squash merge, after every fresh exact-head hosted job succeeds. Verify synchronized clean main and post-merge CI. No gate weakening or audit exceptions.

Rollback: revert override+lock together and restore isolated cached dependencies. This reinstates the known failed security gate, so it cannot authorize merge.

Package-manager execution remains in the existing externally denied runtime. A task-owned CONNECT proxy permits only registry.npmjs.org:443 for trusted package metadata/artifacts. Use sanitized configuration, ignore pnpmfile and lifecycle scripts, retain timestamps and integrity checks, and deny all other proxy destinations. No local advisory upload or private registry access is included.
