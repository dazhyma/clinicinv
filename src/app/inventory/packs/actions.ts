'use server';

/**
 * Тонкие серверные обёртки над слоем действий для паков (§6.3, §6.7).
 *
 * Плумбинг Next и ничего больше: сессия, разбор FormData, загрузка фотографии,
 * revalidate, redirect. Роль, валидация и формулировки ошибок — в
 * `src/actions/packs.ts`, работа с составом — в `src/domain/packs.ts` (D-16).
 *
 * Роль проверяется на сервере в КАЖДОМ действии (§15, §18.22): прямой POST
 * из-под Staff отклоняется, даже если кнопку в браузере восстановили вручную.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createPackAction,
  updatePackAction,
  type PackComponentFormInput,
  type PackFormInput,
} from '@/actions/packs';
import { toFailure } from '@/actions/result';
import { requireActor } from '@/auth/guards';
import { getDb } from '@/db/client';
import type { Actor } from '@/domain/actor';
import { errors } from '@/domain/errors';
import { deletePhotoByUrl, storeItemPhoto } from '@/photos/storage';
import type { FormState } from '../actions';

async function actorOrState(): Promise<{ actor: Actor } | { state: FormState }> {
  try {
    return { actor: await requireActor() };
  } catch (error) {
    const failure = toFailure(error);
    return { state: { ok: false, error: failure.error, fieldErrors: failure.fieldErrors } };
  }
}

function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === 'string' ? value : undefined;
}

/**
 * Строки состава приходят двумя параллельными списками полей одного имени.
 * Порядок `getAll()` совпадает с порядком полей в разметке, поэтому индексы
 * строк не разъезжаются: каждая строка формы всегда рисует оба поля.
 */
function componentsFromForm(formData: FormData): PackComponentFormInput[] {
  const itemIds = formData.getAll('componentItemId');
  const quantities = formData.getAll('componentQuantity');
  const length = Math.max(itemIds.length, quantities.length);

  return Array.from({ length }, (_, index) => ({
    itemId: typeof itemIds[index] === 'string' ? (itemIds[index] as string) : undefined,
    quantity: typeof quantities[index] === 'string' ? (quantities[index] as string) : undefined,
  }));
}

async function readPhoto(formData: FormData): Promise<string | null | undefined> {
  if (text(formData, 'removePhoto') === 'on') return null;

  const file = formData.get('photo');
  if (!(file instanceof File) || file.size === 0) return undefined;
  return storeItemPhoto(file);
}

function packFormInput(formData: FormData): PackFormInput {
  return {
    name: text(formData, 'name'),
    notes: text(formData, 'notes'),
    status: text(formData, 'status'),
    components: componentsFromForm(formData),
  };
}

// --- Add New Pack (§6.3) ----------------------------------------------------

export async function createPackFormAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await actorOrState();
  if ('state' in auth) return auth.state;
  if (auth.actor.role !== 'Admin') {
    const failure = toFailure(errors.forbidden('create pack'));
    return { ok: false, error: failure.error, fieldErrors: failure.fieldErrors };
  }

  let photoUrl: string | null | undefined;
  try {
    photoUrl = await readPhoto(formData);
  } catch (error) {
    const failure = toFailure(error);
    return { ok: false, error: failure.error, fieldErrors: failure.fieldErrors };
  }

  const result = createPackAction(getDb(), auth.actor, {
    ...packFormInput(formData),
    photoUrl: photoUrl ?? null,
  });

  if (!result.ok) {
    // Файл уже сохранён, а пак — нет: осиротевший файл убираем сразу.
    await deletePhotoByUrl(photoUrl);
    return { ok: false, error: result.error, fieldErrors: result.fieldErrors };
  }

  revalidatePath('/inventory/packs');
  redirect(`/inventory/packs?created=${encodeURIComponent(result.data.internalCode)}`);
}

// --- Редактирование пака и состава (§6.7) -----------------------------------

export async function updatePackFormAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await actorOrState();
  if ('state' in auth) return auth.state;
  if (auth.actor.role !== 'Admin') {
    const failure = toFailure(errors.forbidden('edit pack'));
    return { ok: false, error: failure.error, fieldErrors: failure.fieldErrors };
  }

  const packId = Number(text(formData, 'packId'));
  if (!Number.isSafeInteger(packId) || packId <= 0) {
    return { ok: false, error: 'Pack not found' };
  }

  let photoUrl: string | null | undefined;
  try {
    photoUrl = await readPhoto(formData);
  } catch (error) {
    const failure = toFailure(error);
    return { ok: false, error: failure.error, fieldErrors: failure.fieldErrors };
  }

  const result = updatePackAction(getDb(), auth.actor, packId, {
    ...packFormInput(formData),
    ...(photoUrl !== undefined ? { photoUrl } : {}),
  });

  if (!result.ok) {
    await deletePhotoByUrl(photoUrl);
    return { ok: false, error: result.error, fieldErrors: result.fieldErrors };
  }

  await deletePhotoByUrl(result.data.replacedPhotoUrl);

  revalidatePath('/inventory/packs');
  revalidatePath(`/inventory/packs/${packId}/edit`);
  redirect(`/inventory/packs?updated=${encodeURIComponent(result.data.internalCode)}`);
}
