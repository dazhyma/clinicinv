/**
 * Действия инвентаризации (§5.10).
 *
 * Границы слоя те же, что в `items.ts`, `packs.ts` и `operations.ts`: роль →
 * валидация ввода → вызов домена → конкретное сообщение (§14.4). Ни одного
 * движения остатка и ни одной транзакции здесь нет: черновик, снимок ожидаемого
 * количества, корректировка движением `count_correction` и её идемпотентность
 * живут в `src/domain/inventory-count.ts`.
 *
 * Роль проверяется ПЕРВОЙ строкой каждого действия и повторно в домене (D-10).
 * Inventory Count — узкое исключение: доступен Admin и Staff, тогда как обычная
 * ручная корректировка остатка остаётся только у Admin.
 */
import type { AppDatabase } from '@/db/client';
import type { InventoryCountLineRow, InventoryCountStatus, ItemRow } from '@/db/schema';
import { isInventoryWorker, type Actor } from '@/domain/actor';
import { errors } from '@/domain/errors';
import {
  applyInventoryCount,
  cancelInventoryCount,
  findDraftInventoryCount,
  getInventoryCount,
  listCountLines,
  startInventoryCount,
  upsertCountLine,
} from '@/domain/inventory-count';
import { getItem } from '@/domain/items';
import { formatCentiml, parseNonNegativeMlToCentiml } from '@/domain/liquid';
import { resolveScannedBarcode } from '@/domain/operations';
import { listItemsForActor } from './items';
import { FieldValidator, type RawFormValue } from './parse';
import { failFields, forbidden, runAction, type ActionResult } from './result';

// --- Представление ----------------------------------------------------------

/**
 * Строка инвентаризации (§5.10, шаги 3–5).
 *
 * `expectedQuantity` — снимок на момент ввода строки, а не текущий остаток:
 * параллельно идущая операция иначе исказила бы уже показанную пользователю
 * разницу. Пересчитывать разницу на экране запрещено — её считает домен.
 */
export interface CountLineView {
  id: number;
  itemId: number;
  name: string;
  internalCode: string;
  unitOfMeasurement: string;
  expectedQuantity: number;
  countedQuantity: number;
  difference: number;
  applied: boolean;
  trackingMethod: 'standard' | 'liquid';
  expectedUnopenedVials: number | null;
  countedUnopenedVials: number | null;
  expectedOpenVialMl: string | null;
  countedOpenVialMl: string | null;
}

export interface InventoryCountStateView {
  id: number;
  internalCode: string;
  status: InventoryCountStatus;
  createdAtMs: number;
  updatedAtMs: number;
  appliedAtMs: number | null;
  lines: CountLineView[];
  /** Сколько предметов уже посчитано. */
  countedItems: number;
  /** Сколько строк расходятся с ожидаемым: только они породят движения. */
  differenceCount: number;
}

/** Предмет, найденный сканером: что показать до ввода фактического количества. */
export interface CountScanTargetView {
  itemId: number;
  name: string;
  internalCode: string;
  referenceNumber: string | null;
  unitOfMeasurement: string;
  /** §5.10, шаг 4: система показывает ожидаемое количество. */
  expectedQuantity: number;
  /** Уже введённое в этой инвентаризации значение, если предмет сканируют повторно. */
  countedQuantity: number | null;
  trackingMethod: 'standard' | 'liquid';
  expectedUnopenedVials: number;
  expectedOpenVialMl: string;
  countedUnopenedVials: number | null;
  countedOpenVialMl: string | null;
  liquidVolumePerVialMl: string | null;
}

export interface CountSearchResultView {
  itemId: number;
  name: string;
  internalCode: string;
  referenceNumber: string | null;
  currentQuantity: number;
  unitOfMeasurement: string;
}

function toLineView(line: InventoryCountLineRow, item: ItemRow | undefined): CountLineView {
  return {
    id: line.id,
    itemId: line.itemId,
    name: line.itemNameSnapshot ?? item?.name ?? `Item #${line.itemId}`,
    internalCode: line.internalCodeSnapshot ?? item?.internalCode ?? '',
    unitOfMeasurement: line.unitOfMeasurementSnapshot ?? item?.unitOfMeasurement ?? '',
    expectedQuantity: line.expectedQuantity,
    countedQuantity: line.countedQuantity,
    difference: line.difference,
    applied: line.applied,
    trackingMethod: line.trackingMethodSnapshot,
    expectedUnopenedVials: line.expectedUnopenedVials,
    countedUnopenedVials: line.countedUnopenedVials,
    expectedOpenVialMl: line.expectedOpenVialCentiml == null ? null : formatCentiml(line.expectedOpenVialCentiml),
    countedOpenVialMl: line.countedOpenVialCentiml == null ? null : formatCentiml(line.countedOpenVialCentiml),
  };
}

function toStateView(db: AppDatabase, countId: number): InventoryCountStateView {
  const count = getInventoryCount(db, countId);
  if (!count) throw errors.countNotFound();

  const lines = listCountLines(db, countId).map((line) => toLineView(line, getItem(db, line.itemId)));

  return {
    id: count.id,
    internalCode: count.internalCode ?? `INV-${String(count.id).padStart(6, '0')}`,
    status: count.status,
    createdAtMs: count.createdAt.getTime(),
    updatedAtMs: count.updatedAt.getTime(),
    appliedAtMs: count.appliedAt?.getTime() ?? null,
    lines,
    countedItems: lines.length,
    differenceCount: lines.filter((line) => line.difference !== 0).length,
  };
}

// --- Чтение состояния (§5.10: черновик переживает refresh) ------------------

/**
 * Незавершённая инвентаризация, которую предлагается продолжить.
 *
 * Состояние читается из БД при каждом заходе на страницу, как у активной
 * операции (§8.2): всё введённое хранится на сервере, поэтому refresh, закрытие
 * вкладки и перезапуск сервера ничего не теряют. `undefined` — черновика нет
 * либо запрашивает не Inventory worker.
 */
export function findDraftCountForActor(
  db: AppDatabase,
  actor: Actor,
): InventoryCountStateView | undefined {
  if (!isInventoryWorker(actor)) return undefined;
  const draft = findDraftInventoryCount(db);
  return draft ? toStateView(db, draft.id) : undefined;
}

export function getCountStateForActor(
  db: AppDatabase,
  actor: Actor,
  countId: number,
): InventoryCountStateView | undefined {
  if (!isInventoryWorker(actor)) return undefined;
  const count = getInventoryCount(db, countId);
  return count ? toStateView(db, count.id) : undefined;
}

// --- Начало инвентаризации (§5.10, шаг 1) -----------------------------------

export function startInventoryCountAction(
  db: AppDatabase,
  actor: Actor,
): ActionResult<InventoryCountStateView> {
  if (!isInventoryWorker(actor)) return forbidden('start inventory count');

  return runAction(() => {
    // §5.10 не предусматривает двух одновременных инвентаризаций: незакрытый
    // черновик продолжается, а не вытесняется новым. Иначе уже посчитанные
    // позиции остались бы в невидимом черновике и молча пропали.
    const existing = findDraftInventoryCount(db);
    if (existing) return toStateView(db, existing.id);
    try {
      return toStateView(db, startInventoryCount(db, actor).id);
    } catch (error) {
      // Два почти одновременных нажатия могут оба пройти первое чтение.
      // Частичный UNIQUE оставляет один черновик; проигравший запрос открывает
      // уже созданный общий count вместо неясной ошибки ограничения БД.
      const concurrent = findDraftInventoryCount(db);
      if (concurrent) return toStateView(db, concurrent.id);
      throw error;
    }
  });
}

// --- Скан предмета (§5.10, шаги 2 и 4) --------------------------------------

export interface CountScanInput {
  countId: RawFormValue;
  barcode?: RawFormValue;
}

function openCountItem(
  db: AppDatabase,
  countId: number,
  itemId: number,
): CountScanTargetView {
  const count = getInventoryCount(db, countId);
  if (!count) throw errors.countNotFound();
  if (count.status !== 'draft') throw errors.countNotDraft(count.status);

  const item = getItem(db, itemId);
  if (!item) throw errors.itemNotFound(itemId);
  if (item.status !== 'active') throw errors.itemInactive(item.name);

  const existing = listCountLines(db, countId).find((line) => line.itemId === item.id);

  return {
    itemId: item.id,
    name: item.name,
    internalCode: item.internalCode,
    referenceNumber: item.referenceNumber,
    unitOfMeasurement: item.unitOfMeasurement,
    expectedQuantity: item.currentQuantity,
    countedQuantity: existing?.countedQuantity ?? null,
    trackingMethod: item.trackingMethod,
    expectedUnopenedVials: item.liquidUnopenedVials,
    expectedOpenVialMl: formatCentiml(item.liquidOpenVialCentiml),
    countedUnopenedVials: existing?.countedUnopenedVials ?? null,
    countedOpenVialMl: existing?.countedOpenVialCentiml == null ? null : formatCentiml(existing.countedOpenVialCentiml),
    liquidVolumePerVialMl:
      item.liquidVolumePerVialCentiml == null
        ? null
        : formatCentiml(item.liquidVolumePerVialCentiml),
  };
}

/**
 * Скан в режиме инвентаризации: показать предмет и ожидаемое количество.
 *
 * Остаток здесь НЕ меняется и строка не создаётся: §5.10 разделяет «сканирует
 * предмет» и «вводит физически найденное количество». Пак отклоняется отдельным
 * сообщением: у пака нет собственного физического остатка (§18.10), считать его
 * нечего, а «Barcode not found» здесь было бы неправдой (§14.4).
 */
export function scanForCountAction(
  db: AppDatabase,
  actor: Actor,
  input: CountScanInput,
): ActionResult<CountScanTargetView> {
  if (!isInventoryWorker(actor)) return forbidden('record inventory count');

  const v = new FieldValidator();
  const countId = v.requiredInteger('countId', input.countId, 'Inventory count', { min: 1 });
  const barcode = v.requiredText('barcode', input.barcode, 'Barcode', 120);
  if (v.hasErrors) return failFields(v.errors);

  return runAction(() => {
    const target = resolveScannedBarcode(db, barcode);
    if (target.kind === 'pack') {
      throw errors.validationFailed(
        `${target.pack.name} is a pack — scan the item barcodes instead`,
        { field: 'barcode' },
      );
    }

    return openCountItem(db, countId, target.item.id);
  });
}

export interface SelectCountItemInput {
  countId: RawFormValue;
  itemId: RawFormValue;
}

/** Ручной выбор проходит ту же проверку черновика, что и сканирование. */
export function selectItemForCountAction(
  db: AppDatabase,
  actor: Actor,
  input: SelectCountItemInput,
): ActionResult<CountScanTargetView> {
  if (!isInventoryWorker(actor)) return forbidden('record inventory count');

  const v = new FieldValidator();
  const countId = v.requiredInteger('countId', input.countId, 'Inventory count', { min: 1 });
  const itemId = v.requiredInteger('itemId', input.itemId, 'Item', { min: 1 });
  if (v.hasErrors) return failFields(v.errors);

  return runAction(() => openCountItem(db, countId, itemId));
}

export interface SearchCountItemsInput {
  countId: RawFormValue;
  query?: RawFormValue;
}

/** Поиск по названию, системному Item Code и reference number. */
export function searchItemsForCountAction(
  db: AppDatabase,
  actor: Actor,
  input: SearchCountItemsInput,
): ActionResult<CountSearchResultView[]> {
  if (!isInventoryWorker(actor)) return forbidden('record inventory count');

  const v = new FieldValidator();
  const countId = v.requiredInteger('countId', input.countId, 'Inventory count', { min: 1 });
  const query = v.optionalText('query', input.query, 120) ?? '';
  if (v.hasErrors) return failFields(v.errors);

  return runAction(() => {
    const count = getInventoryCount(db, countId);
    if (!count) throw errors.countNotFound();
    if (count.status !== 'draft') throw errors.countNotDraft(count.status);

    return listItemsForActor(db, actor, { q: query, limit: 25 }).items.map((item) => ({
      itemId: item.id,
      name: item.name,
      internalCode: item.internalCode,
      referenceNumber: item.referenceNumber,
      currentQuantity: item.currentQuantity,
      unitOfMeasurement: item.unitOfMeasurement,
    }));
  });
}

// --- Ввод фактического количества (§5.10, шаги 3 и 5) -----------------------

export interface RecordCountLineInput {
  countId: RawFormValue;
  itemId: RawFormValue;
  countedQuantity: RawFormValue;
  countedUnopenedVials?: RawFormValue;
  countedOpenVialMl?: RawFormValue;
}

export interface RecordCountLineResult {
  state: InventoryCountStateView;
  line: CountLineView;
  /** «Gauze 4x4: expected 100, counted 97, difference −3». */
  message: string;
}

/**
 * Записывает физически найденное количество и возвращает разницу (§5.10, шаг 5).
 *
 * Строка сохраняется на сервере немедленно, а не копится на странице: §5.10
 * требует, чтобы незавершённая инвентаризация пережила обновление страницы.
 * Остаток на этом шаге ещё не меняется — он изменится только после
 * подтверждения, шагом 6.
 */
export function recordCountLineAction(
  db: AppDatabase,
  actor: Actor,
  input: RecordCountLineInput,
): ActionResult<RecordCountLineResult> {
  if (!isInventoryWorker(actor)) return forbidden('record inventory count');

  const v = new FieldValidator();
  const countId = v.requiredInteger('countId', input.countId, 'Inventory count', { min: 1 });
  const itemId = v.requiredInteger('itemId', input.itemId, 'Item', { min: 1 });
  // Ноль — законный результат пересчёта («на полке пусто»), поэтому пустое поле
  // и «0» различаются: молча превратить пропуск в ноль значило бы списать всё.
  const item = !v.hasErrors ? getItem(db, itemId) : undefined;
  const countedQuantity = item?.trackingMethod === 'liquid' ? 0 : v.requiredInteger(
    'countedQuantity', input.countedQuantity, 'Counted quantity', { min: 0 });
  const countedUnopenedVials = item?.trackingMethod === 'liquid'
    ? v.requiredInteger('countedUnopenedVials', input.countedUnopenedVials, 'Unopened vials', { min: 0 }) : undefined;
  let countedOpenVialCentiml: number | undefined;
  if (item?.trackingMethod === 'liquid') {
    try {
      countedOpenVialCentiml = parseNonNegativeMlToCentiml(
        v.text(input.countedOpenVialMl),
        'Open vial amount',
      );
    } catch (error) {
      v.add(
        'countedOpenVialMl',
        error instanceof Error ? error.message : 'Open vial amount is invalid',
      );
    }
  }
  if (v.hasErrors) return failFields(v.errors);

  return runAction(() => {
    const line = upsertCountLine(db, actor, { countId, itemId, countedQuantity, countedUnopenedVials, countedOpenVialCentiml });
    const item = getItem(db, itemId);
    const view = toLineView(line, item);

    const sign = view.difference > 0 ? '+' : '';
    const message = view.trackingMethod === 'liquid'
      ? view.difference === 0
        ? `${view.name}: matches inventory (${view.expectedUnopenedVials ?? 0} unopened + ${view.expectedOpenVialMl ?? '0.00'} ml open)`
        : `${view.name}: expected ${view.expectedUnopenedVials ?? 0} unopened + ${view.expectedOpenVialMl ?? '0.00'} ml open, counted ${view.countedUnopenedVials ?? 0} unopened + ${view.countedOpenVialMl ?? '0.00'} ml open, difference ${sign}${formatCentiml(view.difference)} ml`
      : view.difference === 0
        ? `${view.name}: matches inventory (${view.expectedQuantity})`
        : `${view.name}: expected ${view.expectedQuantity}, counted ${view.countedQuantity}, difference ${sign}${view.difference}`;

    return { state: toStateView(db, countId), line: view, message };
  });
}

// --- Подтверждение (§5.10, шаг 6) -------------------------------------------

export interface ApplyCountResultView {
  countId: number;
  /** Сколько предметов реально скорректировано движением. */
  correctedItems: number;
  countedItems: number;
  message: string;
}

/**
 * Применяет инвентаризацию: остаток корректируется движением `count_correction`
 * (§5.10 шаг 6, §10.4).
 *
 * Прямой записи остатка нет ни здесь, ни в домене: разница становится движением,
 * и инвариант `current_quantity == SUM(quantity_delta)` сохраняется (D-3).
 * Ключ идемпотентности детерминирован (`count:{countId}:item:{itemId}`), поэтому
 * повторное подтверждение не скорректирует остаток второй раз.
 */
export function applyInventoryCountAction(
  db: AppDatabase,
  actor: Actor,
  countId: number,
): ActionResult<ApplyCountResultView> {
  if (!isInventoryWorker(actor)) return forbidden('apply inventory count');

  return runAction(() => {
    const before = toStateView(db, countId);
    const result = applyInventoryCount(db, actor, countId);
    const corrected = result.corrections.length;

    return {
      countId,
      correctedItems: corrected,
      countedItems: before.countedItems,
      message:
        corrected === 0
          ? `Inventory count closed — all ${before.countedItems} counted items matched`
          : `Inventory count applied — ${corrected} ${corrected === 1 ? 'item' : 'items'} corrected`,
    };
  });
}

export function cancelInventoryCountAction(
  db: AppDatabase,
  actor: Actor,
  countId: number,
): ActionResult<{ countId: number }> {
  if (!isInventoryWorker(actor)) return forbidden('cancel inventory count');

  return runAction(() => {
    cancelInventoryCount(db, actor, countId);
    return { countId };
  });
}
