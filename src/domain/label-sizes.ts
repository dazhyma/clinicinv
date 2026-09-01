/**
 * Размеры этикеток (§5.6: «настройка или выбор размера этикетки»).
 *
 * Модуль намеренно пустой от зависимостей: его импортирует клиентский
 * компонент страницы печати, а `src/domain/barcode.ts` тянет `bwip-js/node`,
 * который в браузерный бандл попасть не должен. Тот же приём, что и разделение
 * Разделение не даёт серверному генератору barcode попасть в клиентский bundle.
 *
 * Фактические размеры этикеток клиники не утверждены (§22.5, Q-5). Набор
 * пресетов взят из допущения аналитика: 50×25, 57×32, 70×37 мм. Отдельного
 * режима «обычный лист A4» не требуется — этикетки любого размера раскладываются
 * потоком по листу, поэтому печать на обычной бумаге работает всегда (§5.6).
 *
 * Список меняется правкой одной константы и не влияет ни на данные, ни на сам
 * штрихкод: графика векторная и масштабируется без потери резкости.
 */

export interface LabelSize {
  id: string;
  /** Подпись в селекторе. */
  label: string;
  widthMm: number;
  heightMm: number;
}

export const LABEL_SIZES = [
  { id: 'small', label: 'Small — 50 × 25 mm', widthMm: 50, heightMm: 25 },
  { id: 'medium', label: 'Medium — 57 × 32 mm', widthMm: 57, heightMm: 32 },
  { id: 'large', label: 'Large — 70 × 37 mm', widthMm: 70, heightMm: 37 },
] as const satisfies readonly LabelSize[];

export type LabelSizeId = (typeof LABEL_SIZES)[number]['id'];

export const DEFAULT_LABEL_SIZE_ID: LabelSizeId = 'medium';

export function labelSizeById(id: string | undefined): LabelSize {
  return LABEL_SIZES.find((size) => size.id === id) ?? getDefaultLabelSize();
}

export function getDefaultLabelSize(): LabelSize {
  return LABEL_SIZES.find((size) => size.id === DEFAULT_LABEL_SIZE_ID) ?? LABEL_SIZES[0];
}

/** §5.6: печать нескольких одинаковых этикеток. Верхняя граница — защита от опечатки. */
export const MAX_LABEL_COPIES = 100;

export function clampCopies(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_LABEL_COPIES, Math.max(1, Math.trunc(value)));
}
