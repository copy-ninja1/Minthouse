#!/usr/bin/env bash
# Runs a throwaway PostgreSQL cluster for development and tests, using the
# PostgreSQL server binaries already installed on this machine. Data lives in
# .local-postgres/ (git-ignored). It listens on 127.0.0.1 only.
#
#   scripts/local-postgres.sh start|stop|status|url|destroy
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${ROOT}/.local-postgres/data"
LOG_FILE="${ROOT}/.local-postgres/postgres.log"
PORT="${LOCAL_POSTGRES_PORT:-54329}"
DB_USER="minthouse"
DATABASES=("minthouse" "minthouse_test")

find_bin() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    command -v "$name"
    return
  fi
  local candidate
  candidate="$(ls -d /usr/lib/postgresql/*/bin/"$name" 2>/dev/null | sort -V | tail -1 || true)"
  if [[ -z "$candidate" ]]; then
    echo "PostgreSQL server binary '$name' not found. Install PostgreSQL or use DATABASE_URL to point at an existing server." >&2
    exit 1
  fi
  echo "$candidate"
}

INITDB="$(find_bin initdb)"
PG_CTL="$(find_bin pg_ctl)"
PSQL="$(find_bin psql)"

url() {
  echo "postgresql://${DB_USER}@127.0.0.1:${PORT}/${1:-minthouse}"
}

start() {
  mkdir -p "$(dirname "$DATA_DIR")"
  if [[ ! -f "${DATA_DIR}/PG_VERSION" ]]; then
    "$INITDB" --pgdata="$DATA_DIR" --username="$DB_USER" --auth=trust --encoding=UTF8 --no-locale >/dev/null
    echo "Initialised cluster in ${DATA_DIR}"
  fi
  if "$PG_CTL" --pgdata="$DATA_DIR" status >/dev/null 2>&1; then
    echo "Already running on port ${PORT}"
  else
    "$PG_CTL" --pgdata="$DATA_DIR" --log="$LOG_FILE" --wait \
      --options="-c listen_addresses=127.0.0.1 -c port=${PORT} -c unix_socket_directories=''" start >/dev/null
    echo "Started on 127.0.0.1:${PORT}"
  fi
  for db in "${DATABASES[@]}"; do
    if ! "$PSQL" "$(url postgres)" -tAc "SELECT 1 FROM pg_database WHERE datname='${db}'" | grep -q 1; then
      "$PSQL" "$(url postgres)" -qc "CREATE DATABASE ${db}"
      echo "Created database ${db}"
    fi
  done
  echo "DATABASE_URL=$(url minthouse)"
}

case "${1:-}" in
  start) start ;;
  stop) "$PG_CTL" --pgdata="$DATA_DIR" --wait stop ;;
  status) "$PG_CTL" --pgdata="$DATA_DIR" status ;;
  url) url "${2:-minthouse}" ;;
  destroy)
    "$PG_CTL" --pgdata="$DATA_DIR" --wait stop >/dev/null 2>&1 || true
    rm -rf "${ROOT}/.local-postgres"
    echo "Removed ${ROOT}/.local-postgres"
    ;;
  *)
    echo "usage: $0 start|stop|status|url [db]|destroy" >&2
    exit 2
    ;;
esac
