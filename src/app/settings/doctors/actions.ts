'use server';

/**
 * Серверные обёртки справочника врачей.
 *
 * Роль проверяется здесь, в слое действий и ещё раз в домене (D-10): §3.2
 * запрещает Staff административные разделы, а прямой POST из-под Staff обязан
 * получать отказ (§18.22).
 */
import { revalidatePath } from 'next/cache';
import {
  createDoctorAction,
  deleteDoctorAction,
  updateDoctorAction,
} from '@/actions/doctors';
import { toFailure } from '@/actions/result';
import { requireActor } from '@/auth/guards';
import { getDb } from '@/db/client';
import type { FormState } from '../../inventory/actions';

async function actorOrState(): Promise<
  { actor: Awaited<ReturnType<typeof requireActor>> } | { state: FormState }
> {
  try {
    return { actor: await requireActor() };
  } catch (error) {
    return { state: { ok: false, error: toFailure(error).error } };
  }
}

function revalidate(): void {
  revalidatePath('/settings/doctors');
  // Список врачей отдаётся вместе со страницей операций и карточкой операции.
  revalidatePath('/operations');
}

export async function createDoctorFormAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await actorOrState();
  if ('state' in auth) return auth.state;

  const result = createDoctorAction(getDb(), auth.actor, {
    lastName: String(formData.get('lastName') ?? ''),
    fullName: String(formData.get('fullName') ?? ''),
    code: String(formData.get('code') ?? ''),
  });
  if (!result.ok) return { ok: false, error: result.error, fieldErrors: result.fieldErrors };

  revalidate();
  return { ok: true, message: `${result.data.lastName} added with code ${result.data.code}.` };
}

export async function updateDoctorFormAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await actorOrState();
  if ('state' in auth) return auth.state;

  const result = updateDoctorAction(getDb(), auth.actor, {
    doctorId: String(formData.get('doctorId') ?? ''),
    lastName: String(formData.get('lastName') ?? ''),
    fullName: String(formData.get('fullName') ?? ''),
    code: String(formData.get('code') ?? ''),
  });
  if (!result.ok) return { ok: false, error: result.error, fieldErrors: result.fieldErrors };

  revalidate();
  return { ok: true, message: `${result.data.lastName} saved.` };
}

export async function deleteDoctorFormAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await actorOrState();
  if ('state' in auth) return auth.state;

  const result = deleteDoctorAction(getDb(), auth.actor, String(formData.get('doctorId') ?? ''));
  if (!result.ok) return { ok: false, error: result.error, fieldErrors: result.fieldErrors };

  revalidate();
  // Формулировка разная не для красоты: архивирование и удаление — разные
  // исходы, и администратор обязан видеть, какой из них произошёл.
  return {
    ok: true,
    message:
      result.data.disposition === 'deleted'
        ? `${result.data.lastName} deleted.`
        : `${result.data.lastName} archived — ${result.data.operationCount} operation(s) keep their codes.`,
  };
}
