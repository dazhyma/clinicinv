/**
 * Серверные guard'ы (§3.2, §3.3, §15, §21.6).
 *
 * Каждый серверный обработчик и каждая серверная страница обязаны вызвать
 * requireActor() или requireAdmin(). Скрытие кнопки в UI защитой не считается:
 * Admin-действие, вызванное из-под Staff напрямую по API, должно возвращать
 * отказ (AC-6.2, шаг 11). Вторая линия защиты — assertAdmin() внутри доменных
 * сервисов.
 */
import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import { errors } from '@/domain/errors';
import type { Actor } from '@/domain/actor';
import { SESSION_COOKIE_NAME, validateSessionToken, type SessionContext } from './session';

export async function getSessionContext(): Promise<SessionContext | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return validateSessionToken(getDb(), token);
}

/** Для серверных компонентов: без сессии — редирект на страницу входа. */
export async function requirePage(): Promise<SessionContext> {
  const context = await getSessionContext();
  if (!context) redirect('/login');
  return context;
}

export async function requirePageAdmin(): Promise<SessionContext> {
  const context = await requirePage();
  if (context.actor.role !== 'Admin') redirect('/');
  return context;
}

/** Для route handlers и server actions: без сессии — доменная ошибка, не редирект. */
export async function requireActor(): Promise<Actor> {
  return (await requireSessionContext()).actor;
}

/** Server Action, которому кроме роли нужен id текущей подтверждённой сессии. */
export async function requireSessionContext(): Promise<SessionContext> {
  const context = await getSessionContext();
  if (!context) throw errors.notAuthenticated();
  return context;
}

export async function requireAdmin(action: string): Promise<Actor> {
  const actor = await requireActor();
  if (actor.role !== 'Admin') throw errors.forbidden(action);
  return actor;
}

/** IP клиента для ограничения попыток входа. */
export async function getClientIp(): Promise<string> {
  const headerStore = await headers();
  const forwarded = headerStore.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headerStore.get('x-real-ip')?.trim() || 'unknown';
}
