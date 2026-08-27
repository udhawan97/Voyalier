# Voyalier desktop shell

Tauri 2 wraps the same React application and exposes `AppService` through direct
IPC. It does not start Axum or bind a TCP port in release mode. The adapter is
intentionally thin: product behavior belongs in `voyalier-core` or
`voyalier-app`, never in a Tauri command.

```bash
pnpm --filter @voyalier/desktop desktop:dev
pnpm --filter @voyalier/desktop desktop:build
```

Release builds use the platform data directory for the local SQLite workspace,
the OS keychain for vault and BYOK secrets, and the same versioned gateway
contract as the browser-source adapter. Backup and restore use native file
pickers; updater downloads must pass Voyalier's signature check before install.

Published desktop packages currently target Apple Silicon on macOS 13 or newer
and x64 Windows. They include updater signatures, checksums, and GitHub artifact
attestations, but they do not yet have paid platform publisher identity: macOS
is not notarized, and Windows may show SmartScreen. See the
[release checklist](../../docs/release/RELEASE_CHECKLIST.md) and
[update-key runbook](../../docs/security/UPDATE_KEY_RUNBOOK.md) before changing
packaging or release behavior.
