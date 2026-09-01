'use server';

/**
 * Тонкие серверные обёртки над слоем действий инвентаризации
 * (`src/actions/inventory-count.ts`).
 *
 * Здесь только плумбинг Next: сессия, revalidate, redirect. Проверка роли,
 * валидация и формулировки ошибок — в слое действий, корректировка остатка
 * движением `count_correction` — в `src/domain/inventory-count.ts`.
 *
 * Сессия и узкое право Inventory Count проверяются на сервере в КАЖДОМ
 * действии (§15, §18.22). Оно доступно Admin и Staff, не открывая Staff
 * остальные административные корректировки.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  applyInventoryCountAction,
  cancelInventoryCountAction,
  recordCountLineAction,
  scanForCountAction,
  searchItemsForCountAction,
  selectItemForCountAction,
  startInventoryCountAction,
  type ApplyCountResultView,
  type CountScanTargetView,
  type CountSearchResultView,
  type RecordCountLineResult,
} from '@/actions/inventory-count';
import { deleteInventoryCountAction } from '@/actions/inventory-history';
import { toFailure, type ActionFailure, type ActionResult } from '@/actions/result';
import { requireActor } from '@/auth/guards';
import { getDb } from '@/db/client';
import { isAdmin, type Actor } from '@/domain/actor';
import { errors } from '@/domain/errors';

async function actorOrFailure(): Promise<{ actor: Actor } | { failure: ActionFailure }> {
  try {
    return { actor: await requireActor() };
  } catch (error) {
    return { failure: toFailure(error) };
  }
}

/** §5.10, шаг 1: Admin или Staff начинает/продолжает общий черновик. */
export async function startInventoryCountFormAction(): Promise<void> {
  const auth = await actorOrFailure();
  if ('failure' in auth) redirect('/login');

  const result = startInventoryCountAction(getDb(), auth.actor);
  if (!result.ok) redirect(`/inventory/count?error=${encodeURIComponent(result.error)}`);

  revalidatePath('/inventory/count');
  redirect('/inventory/count/active');
}

export async function scanForCountServerAction(input: {
  countId: number;
  barcode: string;
}): Promise<ActionResult<CountScanTargetView>> {
  const auth = await actorOrFailure();
  if ('failure' in auth) return auth.failure;
  return scanForCountAction(getDb(), auth.actor, input);
}

export async function searchItemsForCountServerAction(input: {
  countId: number;
  query: string;
}): Promise<ActionResult<CountSearchResultView[]>> {
  const auth = await actorOrFailure();
  if ('failure' in auth) return auth.failure;
  return searchItemsForCountAction(getDb(), auth.actor, input);
}

export async function selectItemForCountServerAction(input: {
  countId: number;
  itemId: number;
}): Promise<ActionResult<CountScanTargetView>> {
  const auth = await actorOrFailure();
  if ('failure' in auth) return auth.failure;
  return selectItemForCountAction(getDb(), auth.actor, input);
}

export async function recordCountLineServerAction(input: {
  countId: number;
  itemId: number;
  countedQuantity: number;
  countedUnopenedVials?: number;
  countedOpenVialMl?: string;
}): Promise<ActionResult<RecordCountLineResult>> {
  const auth = await actorOrFailure();
  if ('failure' in auth) return auth.failure;

  const result = recordCountLineAction(getDb(), auth.actor, input);
  if (result.ok) revalidatePath('/inventory/count');
  return result;
}

/** §5.10, шаг 6: после подтверждения система корректирует остаток. */
export async function applyInventoryCountServerAction(
  countId: number,
): Promise<ActionResult<ApplyCountResultView>> {
  const auth = await actorOrFailure();
  if ('failure' in auth) return auth.failure;

  const result = applyInventoryCountAction(getDb(), auth.actor, countId);
  if (result.ok) {
    revalidatePath('/inventory');
    revalidatePath('/inventory/count');
    revalidatePath('/inventory/count/history');
  }
  return result;
}

export async function cancelInventoryCountServerAction(
  countId: number,
): Promise<ActionResult<{ countId: number }>> {
  const auth = await actorOrFailure();
  if ('failure' in auth) return auth.failure;

  const result = cancelInventoryCountAction(getDb(), auth.actor, countId);
  if (result.ok) revalidatePath('/inventory/count');
  return result;
}

export async function deleteInventoryCountFormAction(
  _previous: { ok?: boolean; error?: string },
  formData: FormData,
): Promise<{ ok?: boolean; error?: string }> {
  const actor = await requireActor();
  if (!isAdmin(actor)) {
    return { ok: false, error: errors.forbidden('delete inventory count').message };
  }

  const countId = Number(formData.get('countId'));
  const result = deleteInventoryCountAction(getDb(), actor, countId);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/inventory/count/history');
  revalidatePath(`/inventory/count/history/${countId}`);
  redirect(`/inventory/count/history?deleted=${encodeURIComponent(result.data.internalCode)}`);
}
