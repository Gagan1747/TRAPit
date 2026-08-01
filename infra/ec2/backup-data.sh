#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${TRAPIT_DATA_DIR:-/var/lib/trapit}"
DATA_FILE="${TRAPIT_DATA_FILE:-${DATA_DIR}/testing-workspace.json}"
BACKUP_DIR="${TRAPIT_BACKUP_DIR:-/var/backups/trapit}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QUARANTINE_DIR="${BACKUP_DIR}/quarantine"

mkdir -p "${BACKUP_DIR}"

if [ ! -f "${DATA_FILE}" ]; then
  echo "No live data file found at ${DATA_FILE}. Nothing was backed up."
  exit 0
fi

if ! "${SCRIPT_DIR}/validate-testing-data.sh" "${DATA_FILE}"; then
  mkdir -p "${QUARANTINE_DIR}"
  QUARANTINE_FILE="${QUARANTINE_DIR}/testing-workspace-invalid-${TIMESTAMP}.json"
  cp "${DATA_FILE}" "${QUARANTINE_FILE}"
  echo "Live data validation failed. Copied suspect file to ${QUARANTINE_FILE} and refused to create a normal backup." >&2
  exit 1
fi

BACKUP_FILE="${BACKUP_DIR}/testing-workspace-${TIMESTAMP}.json"
cp "${DATA_FILE}" "${BACKUP_FILE}"
echo "Backed up ${DATA_FILE} to ${BACKUP_FILE}."

if [ -n "${TRAPIT_BACKUP_S3_URI:-}" ]; then
  aws s3 cp "${BACKUP_FILE}" "${TRAPIT_BACKUP_S3_URI%/}/$(basename "${BACKUP_FILE}")"
  echo "Uploaded backup to ${TRAPIT_BACKUP_S3_URI%/}/$(basename "${BACKUP_FILE}")."
fi