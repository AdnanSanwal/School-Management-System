#!/usr/bin/env bash
# Database + uploads backup for the production stack.
#
#   backup.sh once   — take one backup now
#   backup.sh loop   — take one every day at BACKUP_HOUR (used by the backup service)
#
# Writes /backups/YYYY-MM-DD_HHMM/{db.sql.gz,uploads.tar.gz} and deletes
# folders older than BACKUP_KEEP_DAYS.
set -euo pipefail
# Backups hold every school's personal data: readable by the owner only (SECURITY_FINDINGS OPS-1).
umask 077

: "${MYSQL_HOST:=mysql}"
: "${MYSQL_DATABASE:=school_db}"
: "${BACKUP_HOUR:=2}"
: "${BACKUP_KEEP_DAYS:=14}"
# Optional:
#   BACKUP_PASSPHRASE  encrypt each file (AES-256, openssl). Keep the passphrase OFF this server
#                      too (password manager): without it the backup can't be restored.
#   BACKUP_PING_URL    called after every successful backup (e.g. a healthchecks.io check), so a
#                      missed backup raises an alert instead of going unnoticed.

encrypt_in_place() {
  [ -n "${BACKUP_PASSPHRASE:-}" ] || return 0
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -in "$1" -out "$1.enc"
  rm -f "$1"
}

take_backup() {
  local stamp dir
  stamp=$(date +%F_%H%M)
  dir="/backups/${stamp}"
  mkdir -p "${dir}"
  echo "[backup] ${stamp}: dumping ${MYSQL_DATABASE}"
  # --single-transaction gives a consistent InnoDB snapshot without locking the school out.
  MYSQL_PWD="${MYSQL_ROOT_PASSWORD}" mysqldump -h "${MYSQL_HOST}" -u root \
    --single-transaction --routines --triggers --no-tablespaces --set-gtid-purged=OFF \
    "${MYSQL_DATABASE}" | gzip -9 > "${dir}/db.sql.gz.part"
  mv "${dir}/db.sql.gz.part" "${dir}/db.sql.gz"

  echo "[backup] ${stamp}: archiving uploads"
  tar -czf "${dir}/uploads.tar.gz.part" -C /uploads .
  mv "${dir}/uploads.tar.gz.part" "${dir}/uploads.tar.gz"

  encrypt_in_place "${dir}/db.sql.gz"
  encrypt_in_place "${dir}/uploads.tar.gz"

  du -sh "${dir}" | sed 's/^/[backup] size: /'
  if [ -n "${BACKUP_PING_URL:-}" ]; then
    curl -fsS -m 10 --retry 3 "${BACKUP_PING_URL}" >/dev/null || echo "[backup] could not reach BACKUP_PING_URL" >&2
  fi
  find /backups -mindepth 1 -maxdepth 1 -type d -mtime "+${BACKUP_KEEP_DAYS}" -print -exec rm -rf {} + | sed 's/^/[backup] removed old: /' || true
}

seconds_until_next_run() {
  local now target
  now=$(date +%s)
  target=$(date -d "today ${BACKUP_HOUR}:00" +%s)
  if [ "${target}" -le "${now}" ]; then target=$(date -d "tomorrow ${BACKUP_HOUR}:00" +%s); fi
  echo $((target - now))
}

case "${1:-once}" in
  once) take_backup ;;
  loop)
    echo "[backup] daily at ${BACKUP_HOUR}:00 ($(date +%Z)), keeping ${BACKUP_KEEP_DAYS} days"
    while true; do
      sleep "$(seconds_until_next_run)"
      take_backup || echo "[backup] FAILED — will retry tomorrow" >&2
    done
    ;;
  *) echo "usage: backup.sh once|loop" >&2; exit 2 ;;
esac
