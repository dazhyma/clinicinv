/**
 * Действия над предметами инвентаря (§5.2–§5.4, §5.7–§5.9, §5.11).
 *
 * Здесь НЕТ логики остатков: движения, идемпотентность, снимки стоимости и
 * транзакции живут в `src/domain/*`. Слой действий делает ровно четыре вещи:
 *   1) проверяет роль (§3.2, §18.22) — до любого обращения к данным;
 *   2) валидирует ввод формы и привязывает ошибки к полям;
 *   3) вызывает доменную функцию;
 *   4) превращает доменную ошибку в конкретное сообщение (§14.4).
 *
 * Себестоимость для Staff (§3.2, Q-1) вырезается ЗДЕСЬ, на сервере: при
 * выключенной настройке `staff_can_see_cost` поля стоимости отсутствуют в
 * возвращаемом объекте, а не прячутся в CSS.
 */
import type { AppDatabase, DbLike } from '@/db/client';
import {
  ADJUSTMENT_REASONS,
  ENTITY_STATUSES,
  type AdjustmentReason,
  type EntityStatus,
  type ItemRow,
} from '@/db/schema';
import { isAdmin, type Actor } from '@/domain/actor';
import {
  AVAILABILITY_FILTERS,
  adjustStock,
  createItem,
  getItem,
  isLowStock,
  listCategories,
  listItems,
  listStorageLocations,
  listUnitsOfMeasurement,
  receiveStock,
  updateItem,
  type AvailabilityFilter,
} from '@/domain/items';
import { formatCents } from '@/domain/money';
import { staffCanSeeCost } from '@/domain/settings';
import { errors } from '@/domain/errors';
import { FieldValidator, type RawFormValue } from './parse';
import { failFields, forbidden, ok, runAction, type ActionResult } from './result';

// --- Видимость стоимости ----------------------------------------------------

/**
 * §3.2 / Q-1: Admin видит стоимость всегда, Staff — только если Admin включил
 * настройку. Значение по умолчанию — не показывать.
 */
export function canSeeCost(tx: DbLike, actor: Actor): boolean {
  return isAdmin(actor) || staffCanSeeCost(tx);
}

// --- Представление предмета -------------------------------------------------

/**
 * Карточка предмета для списка (§5.2).
 *
 * Поля `unitCostCents` / `unitCostFormatted` ОТСУТСТВУЮТ в объекте, когда
 * стоимость показывать нельзя. Это проверяемое свойство: `'unitCostCents' in
 * view === false`, а не пустая строка и не скрытый элемент.
 */
export interface ItemView {
  id: number;
  internalCode: string;
  barcodeValue: string;
  name: string;
  photoUrl: string | null;
  sku: string | null;
  referenceNumber: string | null;
  unitOfMeasurement: string;
  currentQuantity: number;
  lowStockThreshold: number | null;
  isLowStock: boolean;
  category: string | null;
  storageLocation: string | null;
  notes: string | null;
  status: EntityStatus;
  unitCostCents?: number;
  unitCostFormatted?: string;
}

export function toItemView(item: ItemRow, options: { showCost: boolean }): ItemView {
  const view: ItemView = {
    id: item.id,
    internalCode: item.internalCode,
    barcodeValue: item.barcodeValue,
    name: item.name,
    photoUrl: item.photoUrl,
    sku: item.sku,
    referenceNumber: item.referenceNumber,
    unitOfMeasurement: item.unitOfMeasurement,
    currentQuantity: item.currentQuantity,
    lowStockThreshold: item.lowStockThreshold,
    isLowStock: isLowStock(item),
    category: item.category,
    storageLocation: item.storageLocation,
    notes: item.notes,
    status: item.status,
  };

  if (!options.showCost) return view;

  return {
    ...view,
    unitCostCents: item.currentUnitCostCents,
    unitCostFormatted: formatCents(item.currentUnitCostCents),
  };
}

// --- Чтение списка ----------------------------------------------------------

export interface ItemListQuery {
  q?: string;
  category?: string;
  location?: string;
  availability?: string;
  lowStock?: boolean;
  includeInactive?: boolean;
  limit?: number;
}

export interface ItemListResult {
  items: ItemView[];
  showCost: boolean;
  categories: string[];
  storageLocations: string[];
  lowStockCount: number;
}

function normalizeAvailability(value: string | undefined): AvailabilityFilter {
  return AVAILABILITY_FILTERS.includes(value as AvailabilityFilter)
    ? (value as AvailabilityFilter)
    : 'all';
}

/**
 * Список предметов для конкретного актора (§5.2, §5.3, §5.11).
 *
 * Staff видит список и остатки (§3.2), поэтому чтение доступно обеим ролям;
 * режется только стоимость.
 */
export function listItemsForActor(
  db: AppDatabase,
  actor: Actor,
  query: ItemListQuery = {},
): ItemListResult {
  const showCost = canSeeCost(db, actor);
  // Неактивные предметы — административный срез: Staff их не запрашивает.
  const includeInactive = Boolean(query.includeInactive) && isAdmin(actor);

  const rows = listItems(db, {
    query: query.q,
    category: query.category || null,
    storageLocation: query.location || null,
    availability: normalizeAvailability(query.availability),
    lowStockOnly: Boolean(query.lowStock),
    includeInactive,
    limit: query.limit,
  });

  const lowStockCount = listItems(db, { lowStockOnly: true, includeInactive }).length;

  return {
    items: rows.map((row) => toItemView(row, { showCost })),
    showCost,
    categories: listCategories(db),
    storageLocations: listStorageLocations(db),
    lowStockCount,
  };
}

export function getItemForActor(
  db: AppDatabase,
  actor: Actor,
  itemId: number,
): ItemView | undefined {
  const row = getItem(db, itemId);
  if (!row) return undefined;
  return toItemView(row, { showCost: canSeeCost(db, actor) });
}

export function itemFormOptions(db: AppDatabase): {
  units: string[];
  categories: string[];
  storageLocations: string[];
} {
  return {
    units: listUnitsOfMeasurement(db),
    categories: listCategories(db),
    storageLocations: listStorageLocations(db),
  };
}

// --- Add New Item (§5.4) ----------------------------------------------------

/** Сырые значения формы Add New Item / Edit Item. */
export interface ItemFormInput {
  name?: RawFormValue;
  costPerUnit?: RawFormValue;
  unitOfMeasurement?: RawFormValue;
  /** §5.4: обязательное поле, значение 0 допустимо. Только при создании. */
  initialQuantity?: RawFormValue;
  sku?: RawFormValue;
  referenceNumber?: RawFormValue;
  category?: RawFormValue;
  storageLocation?: RawFormValue;
  lowStockThreshold?: RawFormValue;
  notes?: RawFormValue;
  status?: RawFormValue;
  /** URL уже сохранённого файла; загрузку выполняет `'use server'`-обёртка. */
  photoUrl?: string | null;
}

interface ValidatedItemFields {
  name: string;
  currentUnitCostCents: number;
  unitOfMeasurement: string;
  sku: string | null;
  referenceNumber: string | null;
  category: string | null;
  storageLocation: string | null;
  lowStockThreshold: number | null;
  notes: string | null;
}

function validateItemFields(
  input: ItemFormInput,
  v: FieldValidator,
): ValidatedItemFields {
  return {
    name: v.requiredText('name', input.name, 'Item Name'),
    currentUnitCostCents: v.requiredCents('costPerUnit', input.costPerUnit, 'Cost per Unit'),
    unitOfMeasurement: v.requiredText(
      'unitOfMeasurement',
      input.unitOfMeasurement,
      'Unit of Measurement',
      32,
    ),
    sku: v.optionalText('sku', input.sku, 100),
    referenceNumber: v.optionalText('referenceNumber', input.referenceNumber, 100),
    category: v.optionalText('category', input.category, 100),
    storageLocation: v.optionalText('storageLocation', input.storageLocation, 100),
    lowStockThreshold: v.optionalInteger(
      'lowStockThreshold',
      input.lowStockThreshold,
      'Low Stock Threshold',
      { min: 0 },
    ),
    notes: v.optionalText('notes', input.notes, 2000),
  };
}

export interface CreatedItem {
  itemId: number;
  internalCode: string;
  name: string;
}

export function createItemAction(
  db: AppDatabase,
  actor: Actor,
  input: ItemFormInput,
): ActionResult<CreatedItem> {
  // Роль проверяется до валидации: Staff не должен даже узнавать, какие поля
  // формы приняты (§3.2, §18.22). Домен проверит роль повторно (D-10).
  if (!isAdmin(actor)) return forbidden('create item');

  const v = new FieldValidator();
  const fields = validateItemFields(input, v);
  const initialQuantity = v.requiredInteger('initialQuantity', input.initialQuantity, 'Initial Quantity', {
    min: 0,
  });
  if (v.hasErrors) return failFields(v.errors);

  return runAction(() => {
    const created = createItem(db, actor, {
      ...fields,
      initialQuantity,
      photoUrl: input.photoUrl ?? null,
    });
    return { itemId: created.id, internalCode: created.internalCode, name: created.name };
  });
}

// --- Edit (§5.7) ------------------------------------------------------------

export interface UpdatedItem {
  itemId: number;
  internalCode: string;
  name: string;
  /** URL прежней фотографии, если она была заменена: файл можно удалить. */
  replacedPhotoUrl: string | null;
}

/**
 * Редактирование предмета (§5.7).
 *
 * Внутренний код и штрихкод здесь недостижимы в принципе: их нет в
 * `ItemFormInput`, и доменный `updateItem()` отвергает попытку их передать
 * (§18.7). Изменение стоимости влияет только на будущие добавления — ни одна
 * строка операции отсюда не переписывается (§11.3, §11.4, §18.15, §18.16).
 */
export function updateItemAction(
  db: AppDatabase,
  actor: Actor,
  itemId: number,
  input: ItemFormInput,
): ActionResult<UpdatedItem> {
  if (!isAdmin(actor)) return forbidden('edit item');

  const v = new FieldValidator();
  const fields = validateItemFields(input, v);
  const status = input.status
    ? v.oneOf('status', input.status, ENTITY_STATUSES, 'Status')
    : undefined;
  if (v.hasErrors) return failFields(v.errors);

  return runAction(() => {
    const existing = getItem(db, itemId);
    if (!existing) throw errors.itemNotFound(itemId);

    const photoChanged = input.photoUrl !== undefined && input.photoUrl !== existing.photoUrl;

    const updated = updateItem(db, actor, itemId, {
      ...fields,
      ...(photoChanged ? { photoUrl: input.photoUrl ?? null } : {}),
      ...(status ? { status } : {}),
    });

    return {
      itemId: updated.id,
      internalCode: updated.internalCode,
      name: updated.name,
      replacedPhotoUrl: photoChanged ? existing.photoUrl : null,
    };
  });
}

// --- Receive Stock (§5.8) ---------------------------------------------------

export interface ReceiveStockFormInput {
  itemId: RawFormValue;
  quantity?: RawFormValue;
  /** §5.8: необязательная новая себестоимость единицы. */
  newCostPerUnit?: RawFormValue;
  /**
   * Ключ идемпотентности, сгенерированный КЛИЕНТОМ (§10.4, Q-8).
   * Двойной клик и ретрай после таймаута приходят с тем же ключом и не
   * начисляют поставку дважды — уникальность держит индекс БД.
   */
  clientEventId?: RawFormValue;
  reason?: RawFormValue;
}

export interface StockChangeResult {
  itemId: number;
  quantityAfter: number;
  /** false — событие с этим ключом уже применялось; остаток не изменён повторно. */
  applied: boolean;
}

export function receiveStockAction(
  db: AppDatabase,
  actor: Actor,
  input: ReceiveStockFormInput,
): ActionResult<StockChangeResult> {
  if (!isAdmin(actor)) return forbidden('receive stock');

  const v = new FieldValidator();
  const itemId = v.requiredInteger('itemId', input.itemId, 'Item', { min: 1 });
  const quantity = v.requiredInteger('quantity', input.quantity, 'Quantity received', { min: 1 });
  const clientEventId = v.requiredText('clientEventId', input.clientEventId, 'Request id', 120);
  const rawCost = v.text(input.newCostPerUnit);
  const newUnitCostCents = rawCost
    ? v.requiredCents('newCostPerUnit', rawCost, 'New cost per unit')
    : null;
  if (v.hasErrors) return failFields(v.errors);

  return runAction(() => {
    const result = receiveStock(db, actor, {
      itemId,
      quantity,
      newUnitCostCents,
      clientEventId,
      reason: v.text(input.reason) || null,
    });
    return { itemId, quantityAfter: result.quantityAfter, applied: result.applied };
  });
}

// --- Ручная корректировка (§5.9) --------------------------------------------

export const ADJUSTMENT_MODES = ['delta', 'set'] as const;
export type AdjustmentMode = (typeof ADJUSTMENT_MODES)[number];

export interface AdjustStockFormInput {
  itemId: RawFormValue;
  /** Q-21: «изменить на» либо «установить в». В журнал всегда пишется дельта. */
  mode?: RawFormValue;
  amount?: RawFormValue;
  /** §5.9: причина обязательна и выбирается из списка. */
  reason?: RawFormValue;
  notes?: RawFormValue;
  clientEventId?: RawFormValue;
}

export function adjustStockAction(
  db: AppDatabase,
  actor: Actor,
  input: AdjustStockFormInput,
): ActionResult<StockChangeResult> {
  if (!isAdmin(actor)) return forbidden('adjust stock');

  const v = new FieldValidator();
  const itemId = v.requiredInteger('itemId', input.itemId, 'Item', { min: 1 });
  const mode = v.oneOf('mode', input.mode ?? 'delta', ADJUSTMENT_MODES, 'Adjustment type');
  const reason: AdjustmentReason = v.oneOf(
    'reason',
    input.reason,
    ADJUSTMENT_REASONS,
    'Reason',
  );
  const notes = v.optionalText('notes', input.notes, 500);
  const clientEventId = v.requiredText('clientEventId', input.clientEventId, 'Request id', 120);

  const amount =
    mode === 'set'
      ? v.requiredInteger('amount', input.amount, 'New quantity', { min: 0 })
      : v.requiredInteger('amount', input.amount, 'Quantity change');

  if (mode === 'delta' && amount === 0 && !v.errors.amount) {
    v.add('amount', 'Quantity change cannot be zero');
  }
  if (v.hasErrors) return failFields(v.errors);

  // §5.9 требует причину из списка; свободный комментарий лишь дополняет её.
  // Пациентские данные в него вносить нельзя (§18.3) — предупреждение в UI.
  const fullReason = notes ? `${reason}: ${notes}` : reason;

  return runAction(() => {
    const result = adjustStock(db, actor, {
      itemId,
      change: mode === 'set' ? { type: 'set', quantity: amount } : { type: 'delta', delta: amount },
      reason: fullReason,
      clientEventId,
    });
    return { itemId, quantityAfter: result.quantityAfter, applied: result.applied };
  });
}

export { ok };
