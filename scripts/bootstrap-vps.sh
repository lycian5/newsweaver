#!/usr/bin/env bash
set -euo pipefail

cat >&2 <<'EOF'
This legacy bootstrap path is disabled because it exposed n8n port 5678.

Use the canonical Windows deployment instead:
  cd C:\Users\user\orca\projects\newsweaver\deploy\n8n
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1

The canonical deployment binds n8n to 127.0.0.1 and exposes it only through Caddy.
EOF
exit 1
