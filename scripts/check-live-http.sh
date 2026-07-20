#!/usr/bin/env bash
# Exercise the TypeScript HTTP gateway against the real loopback Axum server.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
integration_tmp=$(mktemp -d "${TMPDIR:-/tmp}/voyalier-live-http.XXXXXX")
server_log="$integration_tmp/server.log"
server_pid=""

cleanup() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$integration_tmp"
}
trap cleanup EXIT INT TERM

cd "$repo_root"

if curl -fsS --max-time 1 http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
  echo "live HTTP check needs 127.0.0.1:8787, but a server is already listening there" >&2
  exit 1
fi

# Finish a cold CI build before starting the bounded server-readiness clock.
cargo build --locked -p voyalier-server

VOYALIER_BIND=127.0.0.1:8787 \
VOYALIER_DATA_DIR="$integration_tmp/data" \
VOYALIER_INTEGRATION_TEST=1 \
VOYALIER_LOG=warn \
  cargo run --locked -p voyalier-server >"$server_log" 2>&1 &
server_pid=$!

ready=false
for _ in {1..120}; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "voyalier-server exited before the live HTTP check" >&2
    sed -n '1,240p' "$server_log" >&2
    exit 1
  fi
  if curl -fsS --max-time 1 http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 0.25
done

if [[ "$ready" != true ]]; then
  echo "voyalier-server did not become healthy within 30 seconds" >&2
  sed -n '1,240p' "$server_log" >&2
  exit 1
fi

VITE_LIVE_API=1 \
VITE_LIVE_API_URL=http://127.0.0.1:8787 \
  pnpm --filter @voyalier/web test --run gateway.live
