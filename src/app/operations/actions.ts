'use server';

/**
 * Тонкие серверные обёртки слоя действий операций (`src/actions/operations.ts`).
 *
 * Здесь только плумбинг Next: сессия, разбор FormData, revalidate, redirect.
 * Бизнес-правила, движения остатков и идемпотентность — в `src/domain/*`,
 * валидация и формулировки ошибок — в `src/actions/*`.
 *
 * Сессия проверяется в КАЖДОМ действии (§15, §18.22). Экран сканирования вызывает
 * эти функции напрямую из клиентского компонента, поэтому «кнопка скрыта в UI»
 * защитой не является ни для одного из них: Void из-под Staff получает отказ на
 * сервере, даже если запрос отправлен вручную.
 *
 * Отсутствие сессии — не сбой, а ожидаемый сценарий (§3.4: сессия истекла во
 * время операции). Пользователь получает конкретное сообщение, действие не
 * теряется молча (§14.4), а операция остаётся Active со всеми данными (§8.2).
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  addItemToOperationAction,
  changeLineQuantityAction,
  changeOperationDoctorAction,
  deleteVoidedOperationAction,
  finishOperationAction,
  scanIntoOperationAction,
  searchPastSurgeriesByPatientIdAction,
  searchItemsForOperationAction,
  startOperationAction,
  undoLastScanAction,
  voidOperationAction,
  type FinishedOperation,
  type DeletedOperation,
  type ItemSearchResultView,
  type OperationMutationResult,
  type OperationStateView,
  type OperationListResult,
  type VoidedOperation,
} from '@/actions/operations';
import { toFailure, type ActionFailure, type ActionResult } from '@/actions/result';
import { requireActor } from '@/auth/guards';
import { getDb } from '@/db/client';
import type { Actor } from '@/domain/actor';

async function actorOrFailure(): Promise<{ actor: Actor } | { failure: ActionFailure }> {
  try {
    return { actor: await requireActor() };
  } catch (error) {
    return { failure: toFailure(error) };
  }
}

// --- Start New Operation (§7.3) ---------------------------------------------

/**
 * Создаёт операцию и открывает экран сканирования (§7.3, шаги 4–5).
 * Существующие активные операции не затрагиваются (§8.5, §18.24).
 */
export interface StartSurgeryFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

export async function startOperationFormAction(
  _state: StartSurgeryFormState,
  formData: FormData,
): Promise<StartSurgeryFormState> {
  const auth = await actorOrFailure();
  if ('failure' in auth) redirect('/login');

  const result = startOperationAction(getDb(), auth.actor, {
    doctorId: String(formData.get('doctorId') ?? ''),
    patientId: String(formData.get('patientId') ?? ''),
  });
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };

  revalidatePath('/operations');
  redirect(`/operations/${result.data.operationId}`);
}

export interface PatientSurgerySearchState {
  searched?: boolean;
  result?: OperationListResult;
  error?: string;
  fieldErrors?: Record<string, string>;
}

/** POST-only: Patient ID never appears in the URL or browser history. */
export async function searchPastSurgeriesFormAction(
  _state: PatientSurgerySearchState,
  formData: FormData,
): Promise<PatientSurgerySearchState> {
  const auth = await actorOrFailure();
  if ('failure' in auth) return { searched: true, error: auth.failure.error };

  const result = searchPastSurgeriesByPatientIdAction(getDb(), auth.actor, {
    patientId: String(formData.get('patientId') ?? ''),
    q: String(formData.get('q') ?? ''),
    status: String(formData.get('status') ?? ''),
    doctorId: String(formData.get('doctorId') ?? ''),
    dateFrom: String(formData.get('dateFrom') ?? ''),
    dateTo: String(formData.get('dateTo') ?? ''),
  });
  if (!result.ok) {
    return {
      searched: true,
      error: result.error,
      fieldErrors: result.fieldErrors,
    };
  }
  return { searched: true, result: result.data };
}

// --- Смена врача у активной операции (только Admin) -------------------------

export async function changeOperationDoctorServerAction(
  input: { operationId: number; doctorId: number },
): Promise<ActionResult<OperationStateView>> {
  const auth = await actorOrFailure();
  if ('failure' in auth) return auth.failure;

  // Роль проверяется в действии и ещё раз в домене (D-10).
  const result = changeOperationDoctorAction(getDb(), auth.actor, input);
  if (result.ok) {
    revalidatePath('/operations');
    revalidatePath(`/operations/${input.operationId}`);
  }
  return result;
}

// --- Скан и ручное добавление (§7.5, §7.8) ----------------------------------

export interface ScanRequest {
  operationId: number;
  barcode: string;
  clientEventId: string;
}

export async function scanBarcodeAction(
  input: ScanRequest,
): Promise<ActionResult<OperationMutationResult>> {
  const auth = await actorOrFailure();
  if ('failure' in auth) return auth.failure;
  return scanIntoOperationAction(getDb(), auth.actor, input);
}

export interface AddItemRequest {
  operationId: number;
  itemId: number;
  quantity?: number;
  clientEventId: string;
}

export async function addItemAction(
  input: AddItemRequest,
): Promise<ActionResult<OperationMutationResult>> {
  const auth = await actorOrFailure();
  if ('failure' in auth) return auth.failure;
  return addItemToOperationAction(getDb(), auth.actor, input);
}

export async function searchItemsAction(
  query: string,
): Promise<ActionResult<ItemSearchResultView[]>> {
  const auth = await actorOrFailure();
  if ('failure' in auth) return auth.failure;
  return searchItemsForOperationAction(getDb(), auth.actor, query);
}

// --- Исправления (§7.9) -----------------------------------------------------

export interface ChangeLineRequest {
  operationId: number;
  lineId: number;
  /** Новое абсолютное количество; 0 удаляет строку и возвращает всё списанное. */
  quantity: number;
  clientEventId: string;
}

export async function changeLineQuantityServerAction(
  input: ChangeLineRequest,
): Promise<ActionResult<OperationMutationResult>> {
  const auth = await actorOrFailure();
  if ('failure' in auth) return auth.failure;
  return changeLineQuantityAction(getDb(), auth.actor, input);
}

export async function undoLastScanServerAction(input: {
  operationId: number;
  clientEventId: string;
}): Promise<ActionResult<OperationMutationResult>> {
  const auth = await actorOrFailure();
  if ('failure' in auth) return auth.failure;
  return undoLastScanAction(getDb(), auth.actor, input);
}

// --- Finish and Lock (§9.2) -------------------------------------------------

export async function finishOperationServerAction(
  operationId: number,
): Promise<ActionResult<FinishedOperation>> {
  const auth = await actorOrFailure();
  if ('failure' in auth) return auth.failure;

  const result = finishOperationAction(getDb(), auth.actor, operationId);
  if (result.ok) {
    revalidatePath('/operations');
    revalidatePath(`/operations/${operationId}`);
  }
  return result;
}

// --- Void (§9.3) ------------------------------------------------------------

export async function voidOperationServerAction(input: {
  operationId: number;
  reason?: string;
}): Promise<ActionResult<VoidedOperation>> {
  const auth = await actorOrFailure();
  if ('failure' in auth) return auth.failure;

  // Роль проверяется внутри действия и ещё раз в домене (D-10).
  const result = voidOperationAction(getDb(), auth.actor, input.operationId, input.reason);
  if (result.ok) {
    revalidatePath('/operations');
    revalidatePath(`/operations/${input.operationId}`);
  }
  return result;
}

export async function deleteVoidedOperationServerAction(
  operationId: number,
): Promise<ActionResult<DeletedOperation>> {
  const auth = await actorOrFailure();
  if ('failure' in auth) return auth.failure;

  const result = deleteVoidedOperationAction(getDb(), auth.actor, operationId);
  if (result.ok) {
    revalidatePath('/operations');
    revalidatePath(`/operations/${operationId}`);
  }
  return result;
}
