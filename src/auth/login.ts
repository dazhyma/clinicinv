/**
 * Вход в систему и ограничение попыток (§3.1, §15, Q-36).
 *
 * Блокировка ведётся по паре (username, IP), а НЕ по username целиком.
 * В системе всего два общих аккаунта на всю клинику (§2.3): блокировка учётной
 * записи `staff` остановила бы работу операционной — это прямая угроза
 * сценарию §23. Подбор с одного адреса при этом останавливается.
 */
import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '@/db/client';
import { loginAttempts, userAccounts, type UserAccountRow } from '@/db/schema';
import { env } from '@/env';
import { AUDIT_ACTIONS, writeAudit } from '@/domain/audit';
import { errors } from '@/domain/errors';
import {
  DUMMY_PASSWORD_HASH,
  MIN_PASSWORD_LENGTH,
  hashPassword,
  verifyPassword,
} from './password';
import { createSession, type CreatedSession } from './session';

export interface LoginInput {
  username: string;
  password: string;
  /** IP клиента. Неизвестный адрес трактуется как отдельный «unknown». */
  ip: string;
}

export interface LoginResult {
  account: UserAccountRow;
  session: CreatedSession;
}

function attemptKey(username: string, ip: string) {
  return { username: username.trim().toLowerCase(), ip: ip || 'unknown' };
}

function loadAttempts(db: AppDatabase, username: string, ip: string) {
  return db
    .select()
    .from(loginAttempts)
    .where(and(eq(loginAttempts.username, username), eq(loginAttempts.ip, ip)))
    .get();
}

function registerFailure(db: AppDatabase, username: string, ip: string): void {
  const now = new Date();
  const existing = loadAttempts(db, username, ip);
  const failedCount = (existing?.failedCount ?? 0) + 1;
  const locked = failedCount >= env.loginMaxFailedAttempts;
  const lockedUntil = locked ? new Date(now.getTime() + env.loginLockoutMs) : null;

  if (existing) {
    db.update(loginAttempts)
      .set({
        failedCount,
        lastFailedAt: now,
        lockedUntil,
        updatedAt: now,
      })
      .where(eq(loginAttempts.id, existing.id))
      .run();
  } else {
    db.insert(loginAttempts)
      .values({
        username,
        ip,
        failedCount,
        firstFailedAt: now,
        lastFailedAt: now,
        lockedUntil,
        updatedAt: now,
      })
      .run();
  }

  writeAudit(db, {
    action: locked ? AUDIT_ACTIONS.loginLocked : AUDIT_ACTIONS.loginFailed,
    summary: `${username} from ${ip} (attempt ${failedCount})`,
  });
}

function clearFailures(db: AppDatabase, username: string, ip: string): void {
  db.delete(loginAttempts)
    .where(and(eq(loginAttempts.username, username), eq(loginAttempts.ip, ip)))
    .run();
}

/**
 * Аутентификация. Бросает DomainError с конкретным сообщением (§14.4):
 * ACCOUNT_LOCKED либо INVALID_CREDENTIALS. Из сообщения нельзя понять,
 * существует ли такой username.
 */
export async function login(db: AppDatabase, input: LoginInput): Promise<LoginResult> {
  const { username, ip } = attemptKey(input.username, input.ip);

  const attempts = loadAttempts(db, username, ip);
  if (attempts?.lockedUntil && attempts.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.max(1, Math.ceil((attempts.lockedUntil.getTime() - Date.now()) / 60000));
    throw errors.accountLocked(minutes);
  }

  const account = db
    .select()
    .from(userAccounts)
    .where(eq(userAccounts.username, username))
    .get();

  // Проверка выполняется всегда, даже когда аккаунта нет: иначе время ответа
  // подсказывало бы, какой username существует.
  const passwordOk = await verifyPassword(
    account?.passwordHash ?? DUMMY_PASSWORD_HASH,
    input.password,
  );

  if (!account || !account.active || !passwordOk) {
    registerFailure(db, username, ip);
    throw errors.invalidCredentials();
  }

  clearFailures(db, username, ip);
  db.update(userAccounts)
    .set({ lastLoginAt: new Date() })
    .where(eq(userAccounts.id, account.id))
    .run();

  writeAudit(db, {
    action: AUDIT_ACTIONS.loginSucceeded,
    actorAccountId: account.id,
    actorRole: account.role,
    entityType: 'account',
    entityId: account.id,
    summary: `${username} from ${ip}`,
  });

  return { account, session: createSession(db, account.id) };
}

/** Ручное снятие блокировки Admin (Q-36: способ разблокировать обязателен). */
export function clearLoginLock(db: AppDatabase, username: string, ip?: string): void {
  const normalized = username.trim().toLowerCase();
  if (ip) {
    clearFailures(db, normalized, ip);
    return;
  }
  db.delete(loginAttempts).where(eq(loginAttempts.username, normalized)).run();
}

/**
 * Смена пароля. §3.3: доступно только Admin, для обоих аккаунтов (Q-38, C-5).
 *
 * Роль проверяется здесь, а не только вызывающим слоем (D-10): прямой вызов
 * из-под Staff в обход интерфейса обязан получать отказ.
 *
 * Несуществующий аккаунт — ошибка, а не пустой UPDATE: иначе действие писало бы
 * в журнал «пароль изменён», не изменив ни одной строки (§14.4 запрещает тихий
 * успех). Ни пароль, ни его длина, ни хеш в журнал не попадают — только факт
 * смены и затронутый аккаунт (§15).
 */
export async function setAccountPassword(
  db: AppDatabase,
  accountId: number,
  newPassword: string,
  actor: { accountId: number; role: 'Staff' | 'Admin' },
): Promise<void> {
  if (actor.role !== 'Admin') throw errors.forbidden('change password');

  const account = db.select().from(userAccounts).where(eq(userAccounts.id, accountId)).get();
  if (!account) throw errors.validationFailed('Account not found');

  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw errors.validationFailed(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`,
    );
  }

  const passwordHash = await hashPassword(newPassword);
  db.update(userAccounts)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(userAccounts.id, accountId))
    .run();

  writeAudit(db, {
    action: AUDIT_ACTIONS.passwordChanged,
    actorAccountId: actor.accountId,
    actorRole: actor.role,
    entityType: 'account',
    entityId: accountId,
    summary: `password changed for ${account.username}`,
  });
}
