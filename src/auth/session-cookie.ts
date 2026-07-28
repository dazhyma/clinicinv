/**
 * Имя cookie сессии, вынесенное отдельно и БЕЗ зависимостей от Node API.
 *
 * middleware.ts исполняется в Edge-рантайме, где нет node:fs и node:path.
 * Импорт целого модуля сессий туда затянул бы better-sqlite3 и сборка бы упала.
 */
export const SESSION_COOKIE_NAME = 'clinic_session';
