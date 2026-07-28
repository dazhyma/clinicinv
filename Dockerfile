# syntax=docker/dockerfile:1

################################################################################
# Образ системы учёта инвентаря клиники.
#
# База — bookworm-slim (glibc), а НЕ alpine: три зависимости содержат нативный
# код (better-sqlite3 — .node-биндинг, @node-rs/argon2 — .node-биндинг,
# sharp — libvips). Готовые сборки этих пакетов публикуются под glibc; под musl
# часть из них пришлось бы собирать из исходников, а argon2 из @node-rs под
# musl требует отдельного артефакта. Экономия ~80 МБ не стоит риска молча
# получить неработающее хеширование паролей.
#
# `output: 'standalone'` намеренно НЕ используется: трассировщик Next копирует
# .node-файлы не всегда предсказуемо, а место на сервере есть. В рантайм едет
# обычный node_modules, установленный в этом же базовом образе.
################################################################################

ARG NODE_IMAGE=node:24-bookworm-slim

# --- 1. Зависимости для сборки (полные, включая dev) --------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# Инструменты сборки нужны на случай, если для текущей версии Node готовой
# сборки better-sqlite3 нет и пакет собирается из исходников.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# --- 2. Сборка приложения -----------------------------------------------------
FROM deps AS builder
WORKDIR /app
COPY . .
# basePath задан в next.config.ts (см. src/base-path.ts) и попадает в сборку:
# менять его переменной окружения на запуске нельзя.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- 3. Зависимости рантайма (без dev) ----------------------------------------
# Отдельная установка, а не отбрасывание dev из готового node_modules:
# `npm prune` оставляет мусор в дереве нативных пакетов.
#
# `tsx` и `typescript` числятся в dependencies, а не в devDependencies, и это
# не небрежность: tsx исполняет scripts/migrate.ts при старте контейнера, а
# typescript нужен самому Next, чтобы прочитать next.config.ts (в нём basePath)
# при `next start`. Без них рантайм не поднимется.
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- 4. Рантайм ---------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
# Сам каталог приложения тоже принадлежит непривилегированному пользователю:
# Next при старте создаёт рядом служебные файлы (next-env.d.ts, кеш в .next),
# и от root-owned каталога это дало бы отказ уже после «Ready».
RUN chown node:node /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_FILE=/app/data/clinic.db \
    UPLOADS_DIR=/app/data/uploads \
    BACKUP_DIR=/app/data/backups

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder   --chown=node:node /app/.next        ./.next

# Исходники нужны в рантайме не «на всякий случай»:
# — next.config.ts читается при `next start` (в нём basePath) и импортирует src/base-path;
# — scripts/migrate.ts и src/db/* исполняются при старте контейнера;
# — drizzle/*.sql — сами миграции.
COPY --chown=node:node package.json package-lock.json next.config.ts tsconfig.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Каталог данных — точка монтирования тома: база SQLite (+ WAL) и фотографии
# предметов (§13, §15 — файлы лежат вне public/ и отдаются только маршрутом
# с проверкой сессии). Владелец задан ДО объявления тома: пустой именованный
# том наследует права этого каталога.
RUN mkdir -p /app/data/uploads /app/data/backups && chown -R node:node /app/data
VOLUME ["/app/data"]

USER node
EXPOSE 3000

# Проверка живости без curl/wget (в slim-образе их нет): страница входа —
# единственная, не требующая сессии, и не отдаёт данных инвентаря.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/clinic/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Миграции применяются в entrypoint ДО старта сервера. Сид аккаунтов —
# отдельная команда (npm run db:seed), автоматически он не выполняется: пароли
# приходят из окружения, и молча пересоздавать учётные записи нельзя (§2.3).
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
# Бинарь из node_modules, а не npx: npx при отсутствии пакета уходит в сеть,
# а контейнер приложения в интернет ходить не должен.
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
