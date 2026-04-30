#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${TRAPIT_REPO_DIR:-/var/www/trapit}"
APP_NAME="${TRAPIT_PM2_APP_NAME:-trapit-web}"
HEALTHCHECK_URL="${TRAPIT_HEALTHCHECK_URL:-http://127.0.0.1:3000}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ECOSYSTEM_FILE="${TRAPIT_ECOSYSTEM_FILE:-${REPO_DIR}/infra/ec2/ecosystem.config.cjs}"

"${SCRIPT_DIR}/prepare-persistent-data.sh"
"${SCRIPT_DIR}/backup-data.sh"

cd "${REPO_DIR}"
git pull --ff-only
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @trapit/web build

if pm2 describe "${APP_NAME}" >/dev/null 2>&1; then
  pm2 restart "${APP_NAME}" --update-env
else
  pm2 start "${ECOSYSTEM_FILE}" --only "${APP_NAME}"
fi

pm2 save
curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 "${HEALTHCHECK_URL}" >/dev/null

echo "Deployment completed successfully."