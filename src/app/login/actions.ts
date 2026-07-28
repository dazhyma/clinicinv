'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { BASE_PATH } from '@/base-path';
import { getDb } from '@/db/client';
import { getClientIp } from '@/auth/guards';
import { login } from '@/auth/login';
import { revokeSession, SESSION_COOKIE_NAME, sessionCookieOptions } from '@/auth/session';
import { isDomainError } from '@/domain/errors';

export interface LoginFormState {
  error?: string;
}

/**
 * §3.1: форма входа без переключателя Staff/Admin — роль определяется
 * введёнными учётными данными.
 */
export async function loginAction(
  _previous: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const username = String(formData.get('username') ?? '');
  const password = String(formData.get('password') ?? '');

  if (!username || !password) {
    return { error: 'Enter your username and password' };
  }

  try {
    const result = await login(getDb(), { username, password, ip: await getClientIp() });
    const cookieStore = await cookies();
    cookieStore.set(
      SESSION_COOKIE_NAME,
      result.session.token,
      sessionCookieOptions(result.session.expiresAt),
    );
  } catch (error) {
    // §14.4: сообщение конкретное. «Something went wrong» недопустимо.
    if (isDomainError(error)) return { error: error.message };
    throw error;
  }

  redirect('/');
}

/**
 * Logout. §3.4/§18.12: не завершает активную операцию, не удаляет её,
 * не возвращает предметы на склад и не меняет статус.
 */
export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  revokeSession(getDb(), token);
  // Удалять cookie нужно ТЕМ ЖЕ path, каким она поставлена (D-51):
  // `delete(name)` без path гасит cookie в корне домена, а сессионная лежит
  // под /clinic — она пережила бы logout, и выход стал бы фикцией.
  cookieStore.delete({ name: SESSION_COOKIE_NAME, path: BASE_PATH || '/' });
  redirect('/login');
}
