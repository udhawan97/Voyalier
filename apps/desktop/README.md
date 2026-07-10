# Voyalier desktop shell

Tauri 2 wraps the same React application and starts the local Axum API in-process. It is intentionally thin: product behavior belongs in `voyalier-core`.

```bash
pnpm --filter @voyalier/desktop desktop:dev
pnpm --filter @voyalier/desktop desktop:build
```

The foundation build uses a fixed loopback port. Random authenticated session ports, vault integration, signing, notarization, and update artifacts are release gates before public beta.
