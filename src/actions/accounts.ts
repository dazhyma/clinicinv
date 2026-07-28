/**
 * Действия над учётными записями (§3.3, FR-12, Q-38).
 *
 * В системе ровно два общих аккаунта (§2.3), и менять их пароли может только
 * Admin (§3.3; Staff свой пароль не меняет — Q-38, C-5). Роль проверяется здесь
 * первой строкой, повторно в `setAccountPassword()` и не зависит от того, есть
 * ли в интерфейсе соответствующая кнопка (§18.22, D-10).
 *
 * Пароли не логируются, не попадают в сообщения об ошибках, не пишутся в журнал
 * аудита и не возвращаются наружу ни в каком виде (§15, NFR-12). Наружу уходит
 * только имя затронутого аккаунта.
 */
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '@/db/client';
import { userAccounts, type UserRole } from '@/db/schema';
import { isAdmin, type Actor } from '@/domain/actor';
import { setAccountPassword } from '@/auth/login';
import { DUMMY_PASSWORD_HASH, MIN_PASSWORD_LENGTH, verifyPassword } from '@/auth/password';
import { revokeAllSessionsForAccount, revokeOtherSessionsForAccount } from '@/auth/session';
import { FieldValidator, type RawFormValue } from './parse';
import { fail, failFields, forbidden, runAsyncAction, type ActionResult } from './result';

export interface AccountOptionView {
  accountId: number;
  username: string;
  role: UserRole;
}

/** Список аккаунтов для экрана смены пароля. Хешей здесь нет и быть не может. */
export function listAccountsForPasswordChange(db: AppDatabase, actor: Actor): AccountOptionView[] {
  if (!isAdmin(actor)) throw new Error('listAccountsForPasswordChange requires an Admin actor');

  return db
    .select({
      accountId: userAccounts.id,
      username: userAccounts.username,
      role: userAccounts.role,
    })
    .from(userAccounts)
    .orderBy(userAccounts.id)
    .all();
}

export interface ChangePasswordInput {
  /** Какому аккаунту меняем пароль: любой из двух (§3.3). */
  accountId?: RawFormValue;
  /** Текущий пароль САМОГО Admin — подтверждение личности, а не пароль цели. */
  currentPassword?: RawFormValue;
  newPassword?: RawFormValue;
  confirmPassword?: RawFormValue;
}

export interface ChangedPassword {
  accountId: number;
  username: string;
  role: UserRole;
  /** Admin сменил пароль собственному аккаунту. */
  selfChanged: boolean;
  /** Сколько других сессий затронутого аккаунта отозвано. */
  revokedSessions: number;
}

/**
 * Пароль читается как есть: ни trim, ни обрезки по длине.
 * Пробел в начале или в конце — часть пароля, а «исправленный» ввод молча
 * разошёлся бы с тем, что пользователь набрал при следующем входе.
 */
function rawPassword(value: RawFormValue): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Смена пароля одного из двух аккаунтов (§3.3, FR-12).
 *
 * Три проверки, каждая со своим конкретным сообщением (§14.4):
 * неверный текущий пароль, пароли не совпадают, пароль слишком короткий.
 *
 * Текущий пароль спрашивается у Admin намеренно: без него любой, кто подошёл к
 * незалоченному планшету с открытой сессией Admin, менял бы пароли обоих
 * аккаунтов клиники.
 *
 * После смены отзываются все сессии затронутого аккаунта (§15). Исключение —
 * текущая сессия Admin при смене собственного пароля: личность уже повторно
 * подтверждена старым паролем, поэтому текущая вкладка остаётся рабочей, а все
 * остальные устройства немедленно теряют доступ.
 */
export async function changeAccountPasswordAction(
  db: AppDatabase,
  actor: Actor,
  input: ChangePasswordInput,
  options: { currentSessionId?: number } = {},
): Promise<ActionResult<ChangedPassword>> {
  // §18.22: роль проверяется до всего остального — Staff не должен даже узнать,
  // какие поля формы приняты и какие аккаунты существуют.
  if (!isAdmin(actor)) return forbidden('change account password');

  const v = new FieldValidator();
  const accountId = v.requiredInteger('accountId', input.accountId, 'Account', { min: 1 });

  const currentPassword = rawPassword(input.currentPassword);
  const newPassword = rawPassword(input.newPassword);
  const confirmPassword = rawPassword(input.confirmPassword);

  if (!currentPassword) v.add('currentPassword', 'Enter your current password');

  if (!newPassword) {
    v.add('newPassword', 'Enter the new password');
  } else if (newPassword.length < MIN_PASSWORD_LENGTH) {
    v.add('newPassword', `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
  }

  if (!confirmPassword) {
    v.add('confirmPassword', 'Repeat the new password');
  } else if (newPassword && confirmPassword !== newPassword) {
    v.add('confirmPassword', 'Passwords do not match');
  }

  if (v.hasErrors) return failFields(v.errors);

  const target = db.select().from(userAccounts).where(eq(userAccounts.id, accountId)).get();
  if (!target) {
    return fail('Account not found', 'VALIDATION_FAILED', { accountId: 'Account not found' });
  }

  const self = db.select().from(userAccounts).where(eq(userAccounts.id, actor.accountId)).get();
  // Проверка выполняется даже без найденного аккаунта — по тем же соображениям,
  // что и в login(): время ответа не должно ничего подсказывать.
  const currentOk = await verifyPassword(self?.passwordHash ?? DUMMY_PASSWORD_HASH, currentPassword);
  if (!self || !currentOk) {
    return failFields(
      {
        currentPassword:
          'Current Admin password is incorrect. Enter the password for the account you are signed in with.',
      },
      'Current Admin password is incorrect',
    );
  }

  return runAsyncAction(async () => {
    await setAccountPassword(db, target.id, newPassword, actor);
    const revokedSessions =
      target.id === actor.accountId && options.currentSessionId
        ? revokeOtherSessionsForAccount(db, target.id, options.currentSessionId)
        : revokeAllSessionsForAccount(db, target.id);

    return {
      accountId: target.id,
      username: target.username,
      role: target.role,
      selfChanged: target.id === actor.accountId,
      revokedSessions,
    };
  });
}
