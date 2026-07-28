/**
 * Разбор и валидация значений формы для слоя действий.
 *
 * Действия принимают «сырой» ввод (строки, как их отдаёт форма) и валидируют
 * его сами. Это осознанно: только так проверка обязательных полей покрывается
 * тестами без поднятия HTTP-запроса, а сообщения об ошибках привязываются к
 * конкретным полям (§14.4, требование доступности форм).
 */
import { parseDollarsToCents } from '@/domain/money';
import { isDomainError } from '@/domain/errors';
import type { FieldErrors } from './result';

/** Сырые значения формы: то, что реально приходит из FormData. */
export type RawFormValue = string | number | null | undefined;

/** Накопитель ошибок по полям: форма показывает их все сразу, а не по одной. */
export class FieldValidator {
  readonly errors: FieldErrors = {};

  get hasErrors(): boolean {
    return Object.keys(this.errors).length > 0;
  }

  add(field: string, message: string): void {
    if (!this.errors[field]) this.errors[field] = message;
  }

  text(value: RawFormValue): string {
    return value == null ? '' : String(value).trim();
  }

  /** Необязательное текстовое поле: пустая строка превращается в null. */
  optionalText(field: string, value: RawFormValue, maxLength = 500): string | null {
    const text = this.text(value);
    if (!text) return null;
    if (text.length > maxLength) {
      this.add(field, `${humanize(field)} must be ${maxLength} characters or fewer`);
      return null;
    }
    return text;
  }

  requiredText(field: string, value: RawFormValue, label: string, maxLength = 200): string {
    const text = this.text(value);
    if (!text) {
      this.add(field, `${label} is required`);
      return '';
    }
    if (text.length > maxLength) {
      this.add(field, `${label} must be ${maxLength} characters or fewer`);
      return text.slice(0, maxLength);
    }
    return text;
  }

  /** Денежная величина в центах. Дробные центы отвергаются, а не округляются. */
  requiredCents(field: string, value: RawFormValue, label: string): number {
    const text = this.text(value);
    if (!text) {
      this.add(field, `${label} is required`);
      return 0;
    }
    try {
      const cents = parseDollarsToCents(text);
      if (cents < 0) {
        this.add(field, `${label} cannot be negative`);
        return 0;
      }
      return cents;
    } catch (error) {
      this.add(field, isDomainError(error) ? error.message : `${label} is not a valid amount`);
      return 0;
    }
  }

  /**
   * Целое число. Пустое поле и «0» различаются намеренно: §5.4 делает
   * Initial Quantity обязательным полем, но 0 — допустимое значение, и пустое
   * поле не должно молча превращаться в ноль.
   */
  requiredInteger(
    field: string,
    value: RawFormValue,
    label: string,
    options: { min?: number; max?: number } = {},
  ): number {
    const text = this.text(value);
    if (!text) {
      this.add(field, `${label} is required`);
      return 0;
    }
    const parsed = Number(text);
    if (!Number.isSafeInteger(parsed)) {
      this.add(field, `${label} must be a whole number`);
      return 0;
    }
    const min = options.min;
    if (min !== undefined && parsed < min) {
      this.add(
        field,
        min === 0
          ? `${label} cannot be negative`
          : `${label} must be ${min} or more`,
      );
      return 0;
    }
    if (options.max !== undefined && parsed > options.max) {
      this.add(field, `${label} must be ${options.max} or less`);
      return 0;
    }
    return parsed;
  }

  optionalInteger(
    field: string,
    value: RawFormValue,
    label: string,
    options: { min?: number } = {},
  ): number | null {
    const text = this.text(value);
    if (!text) return null;
    return this.requiredInteger(field, text, label, options);
  }

  /** Значение из закрытого списка. Свободный ввод в такие поля не допускается. */
  oneOf<T extends string>(
    field: string,
    value: RawFormValue,
    allowed: readonly T[],
    label: string,
  ): T {
    const text = this.text(value);
    if (!text) {
      this.add(field, `${label} is required`);
      return allowed[0] as T;
    }
    if (!allowed.includes(text as T)) {
      this.add(field, `${label} must be one of: ${allowed.join(', ')}`);
      return allowed[0] as T;
    }
    return text as T;
  }
}

function humanize(field: string): string {
  const spaced = field.replace(/([A-Z])/g, ' $1').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
