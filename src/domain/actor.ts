/**
 * Кто выполняет действие (§3.2, §3.3, §15, §18.22).
 *
 * Проверка роли живёт в домене, а не только в HTTP-слое. Это защита в глубину:
 * если маршрут забудет вызвать guard, Admin-действие всё равно будет отклонено.
 * Скрытие кнопки в UI защитой не считается (§15, §21.6, AC-6.2 шаг 11).
 */
import type { UserRole } from '@/db/schema';
import { errors } from './errors';

export interface Actor {
  accountId: number;
  role: UserRole;
}

export function assertAdmin(actor: Actor | null | undefined, action: string): Actor {
  if (!actor) throw errors.notAuthenticated();
  if (actor.role !== 'Admin') throw errors.forbidden(action);
  return actor;
}

export function assertAuthenticated(actor: Actor | null | undefined): Actor {
  if (!actor) throw errors.notAuthenticated();
  return actor;
}

/**
 * Receive Stock и Inventory Count доступны обеим рабочим ролям. Выделенный
 * guard не даёт случайно расширить остальные Admin-действия вместе с ними.
 */
export function assertInventoryWorker(
  actor: Actor | null | undefined,
  action: string,
): Actor {
  if (!actor) throw errors.notAuthenticated();
  if (actor.role !== 'Admin' && actor.role !== 'Staff') throw errors.forbidden(action);
  return actor;
}

export function isAdmin(actor: Actor | null | undefined): boolean {
  return actor?.role === 'Admin';
}

export function isInventoryWorker(actor: Actor | null | undefined): boolean {
  return actor?.role === 'Admin' || actor?.role === 'Staff';
}
