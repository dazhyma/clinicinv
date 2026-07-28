/**
 * Слой действий: общий результат и преобразование доменных ошибок в сообщения UI.
 *
 * Разделение ответственности:
 *   `src/domain/*`   — бизнес-правила, остатки, движения, снимки стоимости;
 *   `src/actions/*`  — проверка роли, валидация ввода формы, вызов домена,
 *                      конкретное сообщение об ошибке для экрана;
 *   `src/app/**\/actions.ts` — тонкие `'use server'`-обёртки: сессия, FormData,
 *                      revalidate, redirect.
 *
 * Слой действий вынесен из `src/app`, чтобы его можно было вызывать в тестах
 * напрямую: `'use server'`-модули тянут `next/headers` и `next/cache`, которые
 * вне запроса не работают. Никакой бизнес-логики остатков здесь нет.
 *
 * §14.4: сообщение об ошибке всегда конкретное. «Something went wrong» и
 * «Error 500» запрещены, молчаливое исчезновение действия — тоже.
 */
import { errors, isDomainError, type DomainErrorCode } from '@/domain/errors';

export type FieldErrors = Record<string, string>;

export interface ActionSuccess<T> {
  ok: true;
  data: T;
  /** Короткое подтверждение для пользователя. */
  message?: string;
}

export interface ActionFailure {
  ok: false;
  error: string;
  code: DomainErrorCode | 'UNEXPECTED';
  /** Ошибки, привязанные к конкретным полям формы. */
  fieldErrors?: FieldErrors;
}

export type ActionResult<T = null> = ActionSuccess<T> | ActionFailure;

export function ok<T>(data: T, message?: string): ActionSuccess<T> {
  return { ok: true, data, message };
}

export function fail(
  error: string,
  code: DomainErrorCode | 'UNEXPECTED' = 'VALIDATION_FAILED',
  fieldErrors?: FieldErrors,
): ActionFailure {
  return { ok: false, error, code, ...(fieldErrors ? { fieldErrors } : {}) };
}

/**
 * Отказ по роли (§3.2, §18.22).
 *
 * Формулировка берётся из той же доменной ошибки, что и `assertAdmin()`, чтобы
 * сообщение и код не зависели от того, где именно сработала проверка —
 * в действии или уже в домене.
 */
export function forbidden(action: string): ActionFailure {
  const error = errors.forbidden(action);
  return fail(error.message, error.code);
}

/** Отказ из-за незаполненных или некорректных полей формы. */
export function failFields(
  fieldErrors: FieldErrors,
  error = 'Please correct the highlighted fields',
): ActionFailure {
  return { ok: false, error, code: 'VALIDATION_FAILED', fieldErrors };
}

/**
 * Выполняет действие и превращает исключение в результат.
 *
 * Доменная ошибка уже несёт конкретную формулировку из §14.4 — она передаётся
 * пользователю дословно. Если ошибка привязана к полю (`details.field`),
 * подпись появляется под этим полем.
 *
 * Недоменное исключение — это дефект, а не ожидаемый сценарий. Оно пишется в
 * серверный лог целиком и превращается в сообщение о том, ЧТО произошло с
 * данными («изменение не сохранено»), а не в «Something went wrong»:
 * пользователь должен точно знать, что повторить действие безопасно.
 */
export function runAction<T>(fn: () => T): ActionResult<T> {
  try {
    return ok(fn());
  } catch (error) {
    return toFailure(error);
  }
}

export async function runAsyncAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return ok(await fn());
  } catch (error) {
    return toFailure(error);
  }
}

export function toFailure(error: unknown): ActionFailure {
  if (isDomainError(error)) {
    const field = typeof error.details.field === 'string' ? error.details.field : undefined;
    return fail(error.message, error.code, field ? { [field]: error.message } : undefined);
  }

  console.error('[action] unexpected error', error);
  return fail(
    'The change was not saved. Please try again; if it happens again, contact the administrator.',
    'UNEXPECTED',
  );
}
