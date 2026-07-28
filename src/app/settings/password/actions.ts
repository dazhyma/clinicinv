'use server';

/**
 * Серверная обёртка смены пароля (§3.3, FR-12).
 *
 * Здесь только плумбинг Next: сессия, разбор FormData, cookie и revalidate.
 * Проверка роли, проверка текущего пароля, правила пароля и отзыв сессий —
 * в `src/actions/accounts.ts` (D-16), где это покрывается тестами без HTTP.
 *
 * Значения паролей отсюда никуда не уходят: они не пишутся в лог, не
 * возвращаются в `FormState` и не попадают в URL — форма отправляется POST'ом
 * server action, а не GET-запросом.
 */
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { changeAccountPasswordAction } from '@/actions/accounts';
import { toFailure } from '@/actions/result';
import { requireActor } from '@/auth/guards';
import { createSession, SESSION_COOKIE_NAME, sessionCookieOptions } from '@/auth/session';
import { getDb } from '@/db/client';
import type { FormState } from '../../inventory/actions';

export async function changePasswordFormAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  let actor;
  try {
    actor = await requireActor();
  } catch (error) {
    return { ok: false, error: toFailure(error).error };
  }

  const db = getDb();
  const result = await changeAccountPasswordAction(db, actor, {
    accountId: String(formData.get('accountId') ?? ''),
    currentPassword: String(formData.get('currentPassword') ?? ''),
    newPassword: String(formData.get('newPassword') ?? ''),
    confirmPassword: String(formData.get('confirmPassword') ?? ''),
  });

  if (!result.ok) {
    return { ok: false, error: result.error, fieldErrors: result.fieldErrors };
  }

  // Admin сменил пароль СЕБЕ: его собственная сессия только что отозвана вместе
  // с остальными. Вместо «повисшего» состояния — сразу новая сессия и новая
  // cookie, поэтому текущая вкладка продолжает работать, а все прочие
  // устройства с этим аккаунтом разлогинены (§3.3, §15).
  if (result.data.selfChanged) {
    const session = createSession(db, actor.accountId);
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, session.token, sessionCookieOptions(session.expiresAt));
  }

  revalidatePath('/settings/password');

  const otherSessions = result.data.selfChanged
    ? result.data.revokedSessions - 1
    : result.data.revokedSessions;

  return {
    ok: true,
    message:
      `Password changed for ${result.data.username}. ` +
      (otherSessions > 0
        ? `${otherSessions} signed-in ${otherSessions === 1 ? 'session was' : 'sessions were'} logged out.`
        : 'No other signed-in sessions were affected.'),
  };
}
