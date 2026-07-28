/**
 * Авторизация: argon2id, сессии, ограничение попыток входа (§3.1, §3.4, §15).
 */
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { userAccounts } from '@/db/schema';
import { changeAccountPasswordAction } from '@/actions/accounts';
import { MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from '@/auth/password';
import { clearLoginLock, login, setAccountPassword } from '@/auth/login';
import { createSession, revokeSession, validateSessionToken } from '@/auth/session';
import { getItem } from '@/domain/items';
import {
  addItemToOperation,
  listActiveOperations,
  listOperationLines,
  startOperation,
} from '@/domain/operations';
import { getOperation } from '@/domain/operations';
import { FIXTURES, makeItem, nextClientEventId, setupTestDb, type TestContext } from './helpers';

const PASSWORD = 'correct-horse-battery';

async function withRealPasswords(ctx: TestContext) {
  const hash = await hashPassword(PASSWORD);
  ctx.db.update(userAccounts).set({ passwordHash: hash }).run();
}

describe('Пароли (§3.1, §15)', () => {
  it('хранится только argon2id-хеш, пароль в открытом виде отсутствует', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain(PASSWORD);
    expect(await verifyPassword(hash, PASSWORD)).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });

  it('повреждённый хеш даёт отказ, а не исключение', async () => {
    expect(await verifyPassword('not-a-hash', PASSWORD)).toBe(false);
  });
});

describe('Вход и ограничение попыток (§3.1, Q-36)', () => {
  it('верные учётные данные создают сессию и определяют роль', async () => {
    const ctx = setupTestDb();
    await withRealPasswords(ctx);

    const result = await login(ctx.db, { username: 'admin', password: PASSWORD, ip: '10.0.0.1' });
    expect(result.account.role).toBe('Admin');

    const context = validateSessionToken(ctx.db, result.session.token);
    expect(context?.actor.role).toBe('Admin');
    expect(context?.account.username).toBe('admin');
  });

  it('неверный пароль даёт нейтральное сообщение, не раскрывающее существование username', async () => {
    const ctx = setupTestDb();
    await withRealPasswords(ctx);

    await expect(
      login(ctx.db, { username: 'admin', password: 'wrong', ip: '10.0.0.1' }),
    ).rejects.toThrowError('Incorrect username or password');

    await expect(
      login(ctx.db, { username: 'nobody', password: 'wrong', ip: '10.0.0.1' }),
    ).rejects.toThrowError('Incorrect username or password');
  });

  it('после 5 неудач с одного IP дальнейшие попытки блокируются', async () => {
    const ctx = setupTestDb();
    await withRealPasswords(ctx);

    for (let i = 0; i < 5; i += 1) {
      await expect(
        login(ctx.db, { username: 'staff', password: 'wrong', ip: '10.0.0.7' }),
      ).rejects.toThrow();
    }

    // Даже верный пароль отклоняется, пока действует блокировка.
    await expect(
      login(ctx.db, { username: 'staff', password: PASSWORD, ip: '10.0.0.7' }),
    ).rejects.toThrowError(/Too many failed attempts/);
  });

  it('блокировка не распространяется на другой IP — операционная не встаёт', async () => {
    const ctx = setupTestDb();
    await withRealPasswords(ctx);

    for (let i = 0; i < 6; i += 1) {
      await expect(
        login(ctx.db, { username: 'staff', password: 'wrong', ip: '10.0.0.7' }),
      ).rejects.toThrow();
    }

    // Тот же общий аккаунт с планшета в операционной работает.
    const ok = await login(ctx.db, { username: 'staff', password: PASSWORD, ip: '10.0.0.99' });
    expect(ok.account.role).toBe('Staff');
  });

  it('успешный вход сбрасывает счётчик, Admin может снять блокировку вручную', async () => {
    const ctx = setupTestDb();
    await withRealPasswords(ctx);

    for (let i = 0; i < 5; i += 1) {
      await expect(
        login(ctx.db, { username: 'staff', password: 'wrong', ip: '10.0.0.7' }),
      ).rejects.toThrow();
    }
    clearLoginLock(ctx.db, 'staff');

    const ok = await login(ctx.db, { username: 'staff', password: PASSWORD, ip: '10.0.0.7' });
    expect(ok.account.username).toBe('staff');
  });
});

describe('Смена пароля (§3.3, Q-38)', () => {
  it('доступна Admin и отклоняется для Staff', async () => {
    const ctx = setupTestDb();
    await withRealPasswords(ctx);

    const staffAccount = ctx.db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.username, 'staff'))
      .get()!;

    await expect(
      setAccountPassword(ctx.db, staffAccount.id, 'new-strong-password', ctx.staff),
    ).rejects.toThrow(/permission/i);

    await setAccountPassword(ctx.db, staffAccount.id, 'new-strong-password', ctx.admin);

    await expect(
      login(ctx.db, { username: 'staff', password: PASSWORD, ip: '10.1.0.1' }),
    ).rejects.toThrow();
    const ok = await login(ctx.db, {
      username: 'staff',
      password: 'new-strong-password',
      ip: '10.1.0.2',
    });
    expect(ok.account.username).toBe('staff');
  });

  it('слишком короткий пароль отклоняется', async () => {
    const ctx = setupTestDb();
    await expect(setAccountPassword(ctx.db, ctx.staff.accountId, 'short', ctx.admin)).rejects.toThrow(
      /at least 10 characters/i,
    );
  });

  it('несуществующий аккаунт — ошибка, а не пустой UPDATE с записью в журнал', async () => {
    const ctx = setupTestDb();
    await expect(
      setAccountPassword(ctx.db, 9999, 'new-strong-password', ctx.admin),
    ).rejects.toThrow(/Account not found/i);

    const audit = ctx.sqlite
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'account.password_changed'")
      .get() as { n: number };
    expect(audit.n).toBe(0);
  });
});

/**
 * Экран смены пароля (§3.3, FR-12): слой действий вызывается напрямую, минуя
 * HTTP и разметку. Именно так выглядит и попытка Staff выполнить
 * Admin-действие в обход интерфейса (§18.22, AC-6.2 шаг 11).
 */
describe('Слой действий смены пароля (§3.3, FR-12)', () => {
  const NEW_PASSWORD = 'new-strong-password';

  function accountByName(ctx: TestContext, username: string) {
    return ctx.db.select().from(userAccounts).where(eq(userAccounts.username, username)).get()!;
  }

  it('Staff получает отказ, даже вызвав действие напрямую', async () => {
    const ctx = setupTestDb();
    await withRealPasswords(ctx);

    const result = await changeAccountPasswordAction(ctx.db, ctx.staff, {
      accountId: String(accountByName(ctx, 'staff').id),
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('FORBIDDEN');

    // Пароль не тронут: вход со старым по-прежнему проходит.
    const login1 = await login(ctx.db, { username: 'staff', password: PASSWORD, ip: '10.2.0.1' });
    expect(login1.account.username).toBe('staff');
  });

  it('неверный текущий пароль Admin отклоняется с конкретным сообщением', async () => {
    const ctx = setupTestDb();
    await withRealPasswords(ctx);

    const result = await changeAccountPasswordAction(ctx.db, ctx.admin, {
      accountId: String(accountByName(ctx, 'staff').id),
      currentPassword: 'not-my-password',
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toBe('Current Admin password is incorrect');
    expect(result.fieldErrors?.currentPassword).toContain('Current Admin password is incorrect');
  });

  it('несовпадение и короткий пароль дают ошибки на своих полях', async () => {
    const ctx = setupTestDb();
    await withRealPasswords(ctx);
    const staffId = String(accountByName(ctx, 'staff').id);

    const mismatch = await changeAccountPasswordAction(ctx.db, ctx.admin, {
      accountId: staffId,
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: 'new-strong-passwerd',
    });
    expect(mismatch.ok).toBe(false);
    if (mismatch.ok) throw new Error('unreachable');
    expect(mismatch.fieldErrors?.confirmPassword).toBe('Passwords do not match');

    const short = await changeAccountPasswordAction(ctx.db, ctx.admin, {
      accountId: staffId,
      currentPassword: PASSWORD,
      newPassword: 'short',
      confirmPassword: 'short',
    });
    expect(short.ok).toBe(false);
    if (short.ok) throw new Error('unreachable');
    expect(short.fieldErrors?.newPassword).toBe(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`,
    );

    // Ни одна из отклонённых попыток пароль не изменила.
    const ok = await login(ctx.db, { username: 'staff', password: PASSWORD, ip: '10.2.0.2' });
    expect(ok.account.username).toBe('staff');
  });

  it('рассинхронизация id и username цели отклоняется без смены пароля', async () => {
    const ctx = setupTestDb();
    await withRealPasswords(ctx);
    const adminAccount = accountByName(ctx, 'admin');

    const result = await changeAccountPasswordAction(ctx.db, ctx.admin, {
      accountId: String(adminAccount.id),
      targetUsername: 'staff',
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.fieldErrors?.accountId).toBe('Select the account again');

    const adminLogin = await login(ctx.db, {
      username: 'admin',
      password: PASSWORD,
      ip: '10.2.0.20',
    });
    expect(adminLogin.account.username).toBe('admin');
  });

  it('Admin меняет пароль Staff: старый не работает, сессии Staff отозваны, сессия Admin жива', async () => {
    const ctx = setupTestDb();
    await withRealPasswords(ctx);
    const staffAccount = accountByName(ctx, 'staff');

    const staffSession = createSession(ctx.db, staffAccount.id);
    const adminSession = createSession(ctx.db, ctx.admin.accountId);

    const result = await changeAccountPasswordAction(ctx.db, ctx.admin, {
      accountId: String(staffAccount.id),
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.username).toBe('staff');
    expect(result.data.selfChanged).toBe(false);
    expect(result.data.revokedSessions).toBe(1);

    // §15: устройство уволившегося сотрудника доступ теряет.
    expect(validateSessionToken(ctx.db, staffSession.token)).toBeNull();
    // Сессия Admin не затронута — он остаётся на странице настроек.
    expect(validateSessionToken(ctx.db, adminSession.token)).not.toBeNull();

    await expect(
      login(ctx.db, { username: 'staff', password: PASSWORD, ip: '10.2.0.3' }),
    ).rejects.toThrowError('Incorrect username or password');
    const ok = await login(ctx.db, {
      username: 'staff',
      password: NEW_PASSWORD,
      ip: '10.2.0.4',
    });
    expect(ok.account.username).toBe('staff');
  });

  it('Admin меняет пароль себе: текущая сессия сохраняется, остальные отзываются', async () => {
    const ctx = setupTestDb();
    await withRealPasswords(ctx);

    const own = createSession(ctx.db, ctx.admin.accountId);
    const otherDevice = createSession(ctx.db, ctx.admin.accountId);

    const result = await changeAccountPasswordAction(
      ctx.db,
      ctx.admin,
      {
        accountId: String(ctx.admin.accountId),
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      },
      { currentSessionId: own.sessionId },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.selfChanged).toBe(true);
    expect(result.data.revokedSessions).toBe(1);
    expect(validateSessionToken(ctx.db, own.token)).not.toBeNull();
    expect(validateSessionToken(ctx.db, otherDevice.token)).toBeNull();
  });

  it('в журнал попадает только факт смены и затронутый аккаунт, без значений пароля', async () => {
    const ctx = setupTestDb();
    await withRealPasswords(ctx);
    const staffAccount = accountByName(ctx, 'staff');

    const result = await changeAccountPasswordAction(ctx.db, ctx.admin, {
      accountId: String(staffAccount.id),
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    expect(result.ok).toBe(true);

    const rows = ctx.sqlite
      .prepare("SELECT * FROM audit_log WHERE action = 'account.password_changed'")
      .all() as Record<string, unknown>[];

    expect(rows).toHaveLength(1);
    expect(rows[0]!.entity_id).toBe(staffAccount.id);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(NEW_PASSWORD);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain('$argon2id$');
  });
});

describe('Сессии (§3.4, §8.2, §18.12)', () => {
  it('отозванный и несуществующий токен не дают доступа', () => {
    const ctx = setupTestDb();
    const session = createSession(ctx.db, ctx.admin.accountId);

    expect(validateSessionToken(ctx.db, session.token)).not.toBeNull();
    revokeSession(ctx.db, session.token);
    expect(validateSessionToken(ctx.db, session.token)).toBeNull();
    expect(validateSessionToken(ctx.db, 'made-up-token')).toBeNull();
    expect(validateSessionToken(ctx.db, undefined)).toBeNull();
  });

  it('logout НЕ завершает активную операцию и ничего не возвращает на склад', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);

    const session = createSession(ctx.db, ctx.staff.accountId);
    const operation = startOperation(ctx.db, ctx.staff);
    addItemToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      itemId: gauze.id,
      quantity: 3,
      clientEventId: nextClientEventId('scan'),
    });

    const stockBefore = getItem(ctx.db, gauze.id)!.currentQuantity;
    expect(stockBefore).toBe(7);

    revokeSession(ctx.db, session.token);

    const after = getOperation(ctx.db, operation.id)!;
    expect(after.status).toBe('Active');
    expect(after.finishedAt).toBeNull();
    expect(after.voidedAt).toBeNull();
    expect(listOperationLines(ctx.db, operation.id)[0]!.quantity).toBe(3);
    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(7);
    // Операция принадлежит системе, а не сессии: после нового входа она видна.
    expect(listActiveOperations(ctx.db).map((o) => o.id)).toContain(operation.id);
  });

  it('деактивированный аккаунт теряет доступ по существующей сессии', () => {
    const ctx = setupTestDb();
    const session = createSession(ctx.db, ctx.staff.accountId);
    expect(validateSessionToken(ctx.db, session.token)).not.toBeNull();

    ctx.db
      .update(userAccounts)
      .set({ active: false })
      .where(eq(userAccounts.id, ctx.staff.accountId))
      .run();

    expect(validateSessionToken(ctx.db, session.token)).toBeNull();
  });

  it('токен в БД хранится хешем, а не открытым текстом', () => {
    const ctx = setupTestDb();
    const session = createSession(ctx.db, ctx.admin.accountId);
    const stored = ctx.sqlite.prepare('SELECT token_hash FROM sessions').all() as {
      token_hash: string;
    }[];

    expect(stored).toHaveLength(1);
    expect(stored[0]!.token_hash).not.toBe(session.token);
    expect(stored[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
