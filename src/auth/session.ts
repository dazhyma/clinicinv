/**
 * Сессии (§3.4, §15, NFR-13).
 *
 * Сессия живёт в БД, cookie содержит только случайный токен. В базе хранится
 * SHA-256 от токена: утечка дампа БД не даёт войти в систему.
 *
 * КЛЮЧЕВОЕ ПРАВИЛО: ни один переход сессии не влияет на статус операции.
 * Logout, истечение срока и перезапуск сервера не завершают активную операцию,
 * не возвращают предметы на склад и ничего не удаляют (§3.4, §8.2, §18.12).
 * Поэтому здесь нет и не должно быть никакой логики «очистить операции».
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { BASE_PATH } from '@/base-path';
import type { AppDatabase } from '@/db/client';
import { sessions, userAccounts, type UserAccountRow } from '@/db/schema';
import { env } from '@/env';
import type { Actor } from '@/domain/actor';

export { SESSION_COOKIE_NAME } from './session-cookie';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
  sessionId: number;
}

export function createSession(db: AppDatabase, accountId: number): CreatedSession {
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.sessionTtlMs);

  const row = db
    .insert(sessions)
    .values({
      tokenHash: hashToken(token),
      accountId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
    })
    .returning({ id: sessions.id })
    .get();

  return { token, expiresAt, sessionId: row.id };
}

export interface SessionContext {
  account: UserAccountRow;
  actor: Actor;
  sessionId: number;
  expiresAt: Date;
}

/**
 * Проверка токена. Возвращает null для отсутствующего, отозванного, истёкшего
 * токена и для деактивированного аккаунта — во всех случаях доступа нет.
 *
 * Срок действия продлевается («скользящая» сессия): §3.4 говорит об истечении
 * сессии по бездействию, а не по абсолютному времени.
 */
export function validateSessionToken(
  db: AppDatabase,
  token: string | undefined | null,
): SessionContext | null {
  if (!token) return null;

  const tokenHash = hashToken(token);
  const row = db
    .select({ session: sessions, account: userAccounts })
    .from(sessions)
    .innerJoin(userAccounts, eq(userAccounts.id, sessions.accountId))
    .where(eq(sessions.tokenHash, tokenHash))
    .get();

  if (!row) return null;
  if (row.session.revokedAt) return null;
  if (row.session.expiresAt.getTime() <= Date.now()) return null;
  if (!row.account.active) return null;

  // Сравнение хешей постоянным временем — на случай, если поиск по индексу
  // когда-нибудь заменят на перебор.
  const stored = Buffer.from(row.session.tokenHash, 'utf8');
  const provided = Buffer.from(tokenHash, 'utf8');
  if (stored.length !== provided.length || !timingSafeEqual(stored, provided)) return null;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.sessionTtlMs);
  db.update(sessions)
    .set({ lastSeenAt: now, expiresAt })
    .where(eq(sessions.id, row.session.id))
    .run();

  return {
    account: row.account,
    actor: { accountId: row.account.id, role: row.account.role },
    sessionId: row.session.id,
    expiresAt,
  };
}

/** Logout. Активную операцию не трогает — это прямое требование §3.4. */
export function revokeSession(db: AppDatabase, token: string | undefined | null): void {
  if (!token) return;
  db.update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)))
    .run();
}

/**
 * Отзыв всех действующих сессий аккаунта. Возвращает их число.
 *
 * Вызывается после смены пароля (§3.3, §15): иначе устройство, на котором
 * аккаунт остался залогинен, продолжало бы работать со старой сессией, и смена
 * пароля не давала бы того, ради чего её делают.
 */
export function revokeAllSessionsForAccount(db: AppDatabase, accountId: number): number {
  const result = db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.accountId, accountId), isNull(sessions.revokedAt)))
    .run();
  return result.changes;
}

/** Уборка старых строк. Вызывается по расписанию или при входе. */
export function purgeExpiredSessions(db: AppDatabase): number {
  const cutoff = new Date(Date.now() - env.sessionTtlMs);
  const result = db
    .delete(sessions)
    .where(or(lt(sessions.expiresAt, cutoff), and(lt(sessions.revokedAt, cutoff), gt(sessions.id, 0))))
    .run();
  return result.changes;
}

/**
 * Параметры cookie сессии (§15, NFR-13).
 *
 * `path` — префикс развёртывания (D-51), а не `/`: на домене живут соседние
 * приложения, и cookie с `path=/` уходила бы в каждый их запрос. Это и утечка
 * токена сессии клиники за пределы клиники, и риск конфликта имён cookie.
 */
export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.cookieSecure,
    path: BASE_PATH || '/',
    expires: expiresAt,
  };
}
