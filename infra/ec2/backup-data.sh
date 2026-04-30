#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${TRAPIT_DATA_DIR:-/var/lib/trapit}"
DATA_FILE="${TRAPIT_DATA_FILE:-${DATA_DIR}/testing-workspace.json}"
BACKUP_DIR="${TRAPIT_BACKUP_DIR:-/var/backups/trapit}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "${BACKUP_DIR}"

if [ ! -f "${DATA_FILE}" ]; then
  echo "No live data file found at ${DATA_FILE}. Nothing was backed up."
  exit 0
fi

BACKUP_FILE="${BACKUP_DIR}/testing-workspace-${TIMESTAMP}.json"
cp "${DATA_FILE}" "${BACKUP_FILE}"
echo "Backed up ${DATA_FILE} to ${BACKUP_FILE}."