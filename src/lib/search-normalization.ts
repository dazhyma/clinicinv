/**
 * Нормализация только для сравнения кодов в поиске.
 *
 * Сохранённые значения не меняются: убираются все символы, кроме букв и цифр,
 * а регистр приводится к верхнему. NFKC сводит совместимые формы Unicode, не
 * превращая строковые коды в числа и не теряя начальные нули.
 */
export function normalizeSearchCode(value: string): string {
  return value.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toLocaleUpperCase('en-US');
}
