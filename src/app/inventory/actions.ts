'use server';

/**
 * Тонкие серверные обёртки над слоем действий (`src/actions/*`).
 *
 * Здесь только плумбинг Next: сессия и роль, разбор FormData, загрузка файла,
 * revalidate и redirect. Валидация, вызов домена и формулировки ошибок живут в
 * `src/actions/items.ts`; логика остатков — в `src/domain/*`.
 *
 * Роль проверяется на сервере в КАЖДОМ действии (§15, §18.22, AC-6.2 шаг 11).
 * Прямой POST из-под Staff получает отказ, даже если кнопку в браузере
 * восстановили вручную.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  adjustStockAction,
  createItemAction,
  updateItemAction,
  receiveStockAction,
  type ItemFormInput,
} from '@/actions/items';
import { toFailure, type FieldErrors } from '@/actions/result';
import { requireActor } from '@/auth/guards';
import { getDb } from '@/db/client';
import type { Actor } from '@/domain/actor';
import { deletePhotoByUrl, storeItemPhoto } from '@/photos/storage';

/** Состояние формы для `useActionState`. Сериализуемое. */
export interface FormState {
  ok?: boolean;
  error?: string;
  fieldErrors?: FieldErrors;
  message?: string;
}

/**
 * Сессия для server action. Отсутствие сессии — не исключение приложения, а
 * ожидаемый сценарий (истёкшая сессия): пользователь должен увидеть конкретное
 * сообщение, а не пустой экран (§14.4).
 */
async function actorOrState(): Promise<{ actor: Actor } | { state: FormState }> {
  try {
    return { actor: await requireActor() };
  } catch (error) {
    return { state: toStateFailure(error) };
  }
}

function toStateFailure(error: unknown): FormState {
  const failure = toFailure(error);
  return { ok: false, error: failure.error, fieldErrors: failure.fieldErrors };
}

function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === 'string' ? value : undefined;
}

/**
 * Загружает фотографию, если файл выбран (§13).
 * Возвращает `undefined`, когда поле не трогали — тогда текущее фото остаётся.
 */
async function readPhoto(formData: FormData): Promise<string | null | undefined> {
  if (text(formData, 'removePhoto') === 'on') return null;

  const file = formData.get('photo');
  if (!(file instanceof File) || file.size === 0) return undefined;
  return storeItemPhoto(file);
}

function itemFormInput(formData: FormData): ItemFormInput {
  return {
    name: text(formData, 'name'),
    costPerUnit: text(formData, 'costPerUnit'),
    unitOfMeasurement: text(formData, 'unitOfMeasurement'),
    initialQuantity: text(formData, 'initialQuantity'),
    sku: text(formData, 'sku'),
    referenceNumber: text(formData, 'referenceNumber'),
    category: text(formData, 'category'),
    storageLocation: text(formData, 'storageLocation'),
    lowStockThreshold: text(formData, 'lowStockThreshold'),
    notes: text(formData, 'notes'),
    status: text(formData, 'status'),
  };
}

// --- Add New Item (§5.4) ----------------------------------------------------

export async function createItemFormAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await actorOrState();
  if ('state' in auth) return auth.state;

  let photoUrl: string | null | undefined;
  try {
    photoUrl = await readPhoto(formData);
  } catch (error) {
    return toStateFailure(error);
  }

  const result = createItemAction(getDb(), auth.actor, {
    ...itemFormInput(formData),
    photoUrl: photoUrl ?? null,
  });

  if (!result.ok) {
    // Файл уже сохранён, а предмет — нет: осиротевший файл убираем сразу.
    await deletePhotoByUrl(photoUrl);
    return { ok: false, error: result.error, fieldErrors: result.fieldErrors };
  }

  revalidatePath('/inventory');
  redirect(`/inventory?created=${encodeURIComponent(result.data.internalCode)}`);
}

// --- Edit (§5.7) ------------------------------------------------------------

export async function updateItemFormAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await actorOrState();
  if ('state' in auth) return auth.state;

  const itemId = Number(text(formData, 'itemId'));
  if (!Number.isSafeInteger(itemId) || itemId <= 0) {
    return { ok: false, error: 'Item not found' };
  }

  let photoUrl: string | null | undefined;
  try {
    photoUrl = await readPhoto(formData);
  } catch (error) {
    return toStateFailure(error);
  }

  const result = updateItemAction(getDb(), auth.actor, itemId, {
    ...itemFormInput(formData),
    ...(photoUrl !== undefined ? { photoUrl } : {}),
  });

  if (!result.ok) {
    await deletePhotoByUrl(photoUrl);
    return { ok: false, error: result.error, fieldErrors: result.fieldErrors };
  }

  // Файл заменённой фотографии больше не нужен ни одной записи.
  await deletePhotoByUrl(result.data.replacedPhotoUrl);

  revalidatePath('/inventory');
  revalidatePath(`/inventory/items/${itemId}/edit`);
  redirect(`/inventory?updated=${encodeURIComponent(result.data.internalCode)}`);
}

// --- Receive Stock (§5.8) ---------------------------------------------------

export async function receiveStockFormAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await actorOrState();
  if ('state' in auth) return auth.state;

  const result = receiveStockAction(getDb(), auth.actor, {
    itemId: text(formData, 'itemId'),
    quantity: text(formData, 'quantity'),
    newCostPerUnit: text(formData, 'newCostPerUnit'),
    reason: text(formData, 'reason'),
    clientEventId: text(formData, 'clientEventId'),
  });

  if (!result.ok) return { ok: false, error: result.error, fieldErrors: result.fieldErrors };

  revalidatePath('/inventory');
  revalidatePath(`/inventory/items/${result.data.itemId}/stock`);

  return {
    ok: true,
    message: result.data.applied
      ? `Stock received. In stock: ${result.data.quantityAfter}`
      : // §10.4: повтор того же события — успех, а не ошибка и не второе начисление.
        `This receipt was already recorded. In stock: ${result.data.quantityAfter}`,
  };
}

// --- Ручная корректировка (§5.9) --------------------------------------------

export async function adjustStockFormAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await actorOrState();
  if ('state' in auth) return auth.state;

  const result = adjustStockAction(getDb(), auth.actor, {
    itemId: text(formData, 'itemId'),
    mode: text(formData, 'mode'),
    amount: text(formData, 'amount'),
    reason: text(formData, 'reason'),
    notes: text(formData, 'notes'),
    clientEventId: text(formData, 'clientEventId'),
  });

  if (!result.ok) return { ok: false, error: result.error, fieldErrors: result.fieldErrors };

  revalidatePath('/inventory');
  revalidatePath(`/inventory/items/${result.data.itemId}/stock`);

  return {
    ok: true,
    message: result.data.applied
      ? `Adjustment saved. In stock: ${result.data.quantityAfter}`
      : `No change was needed. In stock: ${result.data.quantityAfter}`,
  };
}
