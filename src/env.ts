/**
 * Конфигурация из переменных окружения (§15: секреты только в env, не в коде).
 *
 * Next.js подхватывает `.env` сам; CLI-скрипты (`npm run db:migrate`, `db:seed`)
 * вызывают `loadDotEnv()` явно.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

let dotEnvLoaded = false;

/** Загружает `.env` из корня проекта. Идемпотентно, ошибок не бросает. */
export function loadDotEnv(): void {
  if (dotEnvLoaded) return;
  dotEnvLoaded = true;
  const file = path.resolve(process.cwd(), '.env');
  if (!existsSync(file)) return;
  // Node >= 20.12
  process.loadEnvFile(file);
}

function str(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

export const env = {
  get databaseFile(): string {
    return path.resolve(process.cwd(), str('DATABASE_FILE', './data/clinic.db'));
  },
  /**
   * Каталог загруженных фотографий (§13).
   *
   * Он НАМЕРЕННО находится вне `public/`: §15 и NFR-17 запрещают публичные URL,
   * отдающие данные системы без авторизации. Файлы отдаёт только route handler
   * `/api/photos/[token]`, проверяющий сессию на каждом запросе.
   */
  get uploadsDir(): string {
    return path.resolve(process.cwd(), str('UPLOADS_DIR', './data/uploads'));
  },
  /** Q-40: верхний предел размера загружаемого файла, МБ. */
  get photoMaxBytes(): number {
    return int('PHOTO_MAX_MB', 10) * 1024 * 1024;
  },
  /** Q-40: максимальная сторона хранимого изображения, px. */
  get photoMaxEdgePx(): number {
    return int('PHOTO_MAX_EDGE_PX', 1024);
  },
  get sessionTtlMs(): number {
    return int('SESSION_TTL_HOURS', 12) * 60 * 60 * 1000;
  },
  get cookieSecure(): boolean {
    return bool('COOKIE_SECURE', process.env.NODE_ENV === 'production');
  },
  get loginMaxFailedAttempts(): number {
    return int('LOGIN_MAX_FAILED_ATTEMPTS', 5);
  },
  get loginLockoutMs(): number {
    return int('LOGIN_LOCKOUT_MINUTES', 15) * 60 * 1000;
  },
  get seedAccounts(): {
    admin: { username: string; password: string | undefined };
    staff: { username: string; password: string | undefined };
  } {
    return {
      admin: {
        username: str('SEED_ADMIN_USERNAME', 'admin'),
        password: process.env.SEED_ADMIN_PASSWORD,
      },
      staff: {
        username: str('SEED_STAFF_USERNAME', 'staff'),
        password: process.env.SEED_STAFF_PASSWORD,
      },
    };
  },
};
