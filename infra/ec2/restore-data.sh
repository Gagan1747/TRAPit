#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /absolute/path/to/testing-workspace-backup.json" >&2
  exit 1
fi

SOURCE_FILE="$1"
DATA_DIR="${TRAPIT_DATA_DIR:-/var/lib/trapit}"
DATA_FILE="${TRAPIT_DATA_FILE:-${DATA_DIR}/testing-workspace.json}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "${SOURCE_FILE}" ]; then
  echo "Backup file not found: ${SOURCE_FILE}" >&2
  exit 1
fi

mkdir -p "${DATA_DIR}"
"${SCRIPT_DIR}/backup-data.sh"
cp "${SOURCE_FILE}" "${DATA_FILE}"

echo "Restored ${SOURCE_FILE} to ${DATA_FILE}."