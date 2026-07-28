/**
 * Количества.
 *
 * ДОПУЩЕНИЕ (docs/decisions.md D-2, вопрос Q-12 аналитика):
 * количества хранятся ЦЕЛЫМИ числами. В ТЗ все примеры целочисленные
 * (10, 147, 2, 20, 6), скан по природе даёт «+1», а список единиц измерения
 * (§5.4) содержит `mL` и `bottle` — то есть теоретически возможен дробный ввод.
 *
 * Целые выбраны сознательно: точное целое исключает ошибки округления в
 * инварианте current_quantity == SUM(quantity_delta), который проверяется
 * на равенство. Дробное количество мл учитывается как «1 bottle 10 mL»,
 * то есть выбором единицы измерения.
 *
 * ЕСЛИ ЗАКАЗЧИК ПОТРЕБУЕТ ДРОБНЫЕ КОЛИЧЕСТВА: менять придётся тип столбцов
 * quantity/quantity_delta/current_quantity/expected/counted во всех таблицах
 * плюс сравнение инварианта. Вопрос вынесен заказчику (см. финальный отчёт).
 */
import { errors } from './errors';

export function isValidQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** Количество, которое можно добавить/списать: целое строго больше нуля. */
export function assertPositiveQuantity(value: number, field = 'Quantity'): number {
  if (!isValidQuantity(value) || value <= 0) {
    throw errors.invalidQuantity(`${field} must be a whole number greater than zero`);
  }
  return value;
}

/** Количество, допускающее 0 (Initial Quantity по §5.4, результат пересчёта). */
export function assertNonNegativeQuantity(value: number, field = 'Quantity'): number {
  if (!isValidQuantity(value) || value < 0) {
    throw errors.invalidQuantity(`${field} must be a whole number and cannot be negative`);
  }
  return value;
}

/** Дельта движения: целое, отличное от нуля (инвариант I-3). */
export function assertNonZeroDelta(value: number): number {
  if (!isValidQuantity(value) || value === 0) {
    throw errors.invalidQuantity('Quantity change must be a whole number other than zero');
  }
  return value;
}
