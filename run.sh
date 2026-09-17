#!/usr/bin/env bash

# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 DiskLens contributors
# Launch DiskLens, picking a free port if the default is taken.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-8765}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found on PATH." >&2
  exit 1
fi

# Walk forward until we find a port nothing is listening on.
for _ in $(seq 1 40); do
  if ! nc -z 127.0.0.1 "$PORT" 2>/dev/null; then
    break
  fi
  PORT=$((PORT + 1))
done

exec python3 server.py --port "$PORT"
