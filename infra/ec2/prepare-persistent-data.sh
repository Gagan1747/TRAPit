#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${TRAPIT_REPO_DIR:-/var/www/trapit}"
DATA_DIR="${TRAPIT_DATA_DIR:-/var/lib/trapit}"
DATA_FILE="${TRAPIT_DATA_FILE:-${DATA_DIR}/testing-workspace.json}"
LEGACY_DATA_FILE="${REPO_DIR}/apps/web/data/testing-workspace.json"

mkdir -p "${DATA_DIR}"

if [ -f "${DATA_FILE}" ]; then
  echo "Persistent data file already exists at ${DATA_FILE}."
  exit 0
fi

if [ -f "${LEGACY_DATA_FILE}" ]; then
  cp "${LEGACY_DATA_FILE}" "${DATA_FILE}"
  echo "Migrated repo-scoped data file to ${DATA_FILE}."
  exit 0
fi

echo "No existing data file found. ${DATA_FILE} will be created by the app on first write."