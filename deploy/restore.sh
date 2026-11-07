#!/usr/bin/env bash
# Restore a backup folder made by backup.sh into the running production stack.
#
#   ./deploy/restore.sh backups/2026-11-08_0200
#
# Replaces the whole database and all uploaded files. Run from the repo root on the server.
# ENV_FILE=path overrides the settings file (default .env.production).
set -euo pipefail

DIR="${1:?usage: deploy/restore.sh <backup folder>}"
ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE="docker compose -f docker-compose.prod.yml --env-file ${ENV_FILE}"
[ -f "${DIR}/db.sql.gz" ] || { echo "No db.sql.gz in ${DIR}" >&2; exit 1; }
gzip -t "${DIR}/db.sql.gz" || { echo "${DIR}/db.sql.gz is damaged" >&2; exit 1; }
[ ! -f "${DIR}/uploads.tar.gz" ] || gzip -t "${DIR}/uploads.tar.gz" || { echo "${DIR}/uploads.tar.gz is damaged" >&2; exit 1; }

read -r -p "This REPLACES the database and uploads with ${DIR}. Type 'restore' to continue: " ok
[ "${ok}" = "restore" ] || { echo "Cancelled."; exit 1; }

# Whatever happens below, bring the app back up.
trap 'echo "Starting the app…"; ${COMPOSE} up -d backend frontend >/dev/null' EXIT

echo "Stopping the app…"
${COMPOSE} stop backend frontend

echo "Restoring database…"
gunzip -c "${DIR}/db.sql.gz" | ${COMPOSE} exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -u root school_db'

if [ -f "${DIR}/uploads.tar.gz" ]; then
  echo "Restoring uploads…"
  # The archive is streamed in (no bind mount), unpacked to a temp folder first, and only
  # swapped in once it unpacked completely — a bad archive leaves the current files alone.
  ${COMPOSE} run --rm -T --no-deps --entrypoint sh backend -c '
    set -e
    rm -rf /tmp/restore && mkdir -p /tmp/restore
    tar -xzf - -C /tmp/restore
    find /app/uploads -mindepth 1 -delete
    cp -a /tmp/restore/. /app/uploads/
    echo "  $(find /app/uploads -type f | wc -l) file(s) restored"
  ' < "${DIR}/uploads.tar.gz"
fi

echo "Restore finished."
