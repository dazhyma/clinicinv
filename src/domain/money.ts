/**
 * Деньги.
 *
 * ЖЁСТКОЕ ПРАВИЛО: во всей системе денежная величина — целое число центов.
 * Ни одного float, ни одного REAL-столбца для сумм. Это учётная система:
 * 0.1 + 0.2 !== 0.3 здесь недопустимо.
 *
 * Форматирование в доллары — только на слое представления, через formatCents().
 *
 * Округления при расчёте строки не возникает вовсе: line_total_cents =
 * quantity (целое) × unit_cost_snapshot_cents (целое) — точное целое (§11.2).
 * Это сильнее, чем требование Q-23 «округлять half-up на уровне строки».
 */
import { errors } from './errors';

export const CENTS_IN_DOLLAR = 100;

export function isValidCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function assertNonNegativeCents(value: number, field = 'cost'): number {
  if (!isValidCents(value) || value < 0) {
    throw errors.invalidCost(`${field} must be a whole number of cents and cannot be negative`);
  }
  return value;
}

/**
 * Разбор пользовательского ввода в центы: «3.25» → 325, «3» → 300, «$4.25» → 425.
 * Дробные центы отвергаются, а не округляются молча.
 */
export function parseDollarsToCents(input: string | number): number {
  const raw = typeof input === 'number' ? input.toString() : input.trim().replace(/[$\s,]/g, '');
  if (raw === '') throw errors.invalidCost('Cost is required');

  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) throw errors.invalidCost(`"${input}" is not a valid amount`);

  const [, sign, whole, fraction = ''] = match;
  const cents =
    Number.parseInt(whole ?? '0', 10) * CENTS_IN_DOLLAR +
    Number.parseInt(fraction.padEnd(2, '0') || '0', 10);
  return sign === '-' ? -cents : cents;
}

/** Форматирование для отображения. Только слой представления. */
export function formatCents(cents: number, currencySymbol = '$'): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / CENTS_IN_DOLLAR);
  const fraction = (absolute % CENTS_IN_DOLLAR).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${currencySymbol}${whole}.${fraction}`;
}

/** §11.2: line total = quantity × unit cost snapshot. */
export function lineTotalCents(quantity: number, unitCostCents: number): number {
  return quantity * unitCostCents;
}
