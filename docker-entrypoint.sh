#!/bin/sh
# Точка входа контейнера.
#
# Порядок жёсткий: миграции применяются ДО старта сервера и только полностью.
# Если миграция упала — контейнер не поднимается (set -e): приложение, которое
# пишет остатки и деньги в схему, отличающуюся от ожидаемой, хуже недоступного
# приложения (§16, §18).
#
# Сид аккаунтов здесь НЕ выполняется намеренно. Пароли берутся из окружения,
# и автоматический сид на каждом рестарте — это молчаливое пересоздание двух
# общих учётных записей клиники (§2.3, §3.3). Запускается отдельно и осознанно:
#   docker compose -f docker-compose.prod.yml run --rm clinic-app npm run db:seed
set -eu

DB_FILE="${DATABASE_FILE:-/app/data/clinic.db}"
mkdir -p "$(dirname "$DB_FILE")"

echo "[entrypoint] applying migrations to $DB_FILE"
node_modules/.bin/tsx scripts/migrate.ts

echo "[entrypoint] starting: $*"
exec "$@"
