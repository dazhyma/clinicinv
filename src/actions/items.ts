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
  TRACKING_METHODS,
  type AdjustmentReason,
  type EntityStatus,
  type ItemRow,
  type TrackingMethod,
} from '@/db/schema';
import { isAdmin, isInventoryWorker, type Actor } from '@/domain/actor';
import {
  AVAILABILITY_FILTERS,
  adjustStock,
  adjustLiquidStock,
  createItem,
  convertItemToLiquid,
  deleteItem,
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
import {
  formatCentiml,
  formatCostPerMeasureMicros,
  liquidTotalCentiml,
  parseMlToCentiml,
  parseNonNegativeMlToCentiml,
  vialCostToPerMlMicros,
} from '@/domain/liquid';
import { listManufacturers } from '@/domain/manufacturers';
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
  trackingMethod: TrackingMethod;
  manufacturerId: number | null;
  manufacturer: string | null;
  referenceNumber: string | null;
  unitOfMeasurement: string;
  currentQuantity: number;
  liquidVolumePerVialCentiml: number | null;
  liquidUnopenedVials: number;
  liquidOpenVialCentiml: number;
  liquidTotalCentiml: number | null;
  liquidTotalFormatted: string | null;
  lowStockThreshold: number | null;
  isLowStock: boolean;
  category: string | null;
  storageLocation: string | null;
  notes: string | null;
  status: EntityStatus;
  archivedAtMs: number | null;
  unitCostCents?: number;
  unitCostFormatted?: string;
  costPerMlMicros?: number;
  costPerMlFormatted?: string;
}

export function toItemView(
  item: ItemRow,
  options: { showCost: boolean; manufacturerName?: string | null },
): ItemView {
  const liquidTotal = item.trackingMethod === 'liquid' && item.liquidVolumePerVialCentiml
    ? liquidTotalCentiml(item.liquidUnopenedVials, item.liquidOpenVialCentiml, item.liquidVolumePerVialCentiml)
    : null;
  const view: ItemView = {
    id: item.id,
    internalCode: item.internalCode,
    barcodeValue: item.barcodeValue,
    name: item.name,
    trackingMethod: item.trackingMethod,
    manufacturerId: item.manufacturerId,
    manufacturer: options.manufacturerName ?? null,
    referenceNumber: item.referenceNumber,
    unitOfMeasurement: item.unitOfMeasurement,
    currentQuantity: item.currentQuantity,
    liquidVolumePerVialCentiml: item.liquidVolumePerVialCentiml,
    liquidUnopenedVials: item.liquidUnopenedVials,
    liquidOpenVialCentiml: item.liquidOpenVialCentiml,
    liquidTotalCentiml: liquidTotal,
    liquidTotalFormatted: liquidTotal == null ? null : formatCentiml(liquidTotal),
    lowStockThreshold: item.lowStockThreshold,
    isLowStock: isLowStock(item),
    category: item.category,
    storageLocation: item.storageLocation,
    notes: item.notes,
    status: item.status,
    archivedAtMs: item.archivedAt?.getTime() ?? null,
  };

  if (!options.showCost) return view;

  const costPerMlMicros = item.trackingMethod === 'liquid' && item.liquidVolumePerVialCentiml
    ? vialCostToPerMlMicros(item.currentUnitCostCents, item.liquidVolumePerVialCentiml)
    : undefined;
  return {
    ...view,
    unitCostCents: item.currentUnitCostCents,
    unitCostFormatted: formatCents(item.currentUnitCostCents),
    ...(costPerMlMicros === undefined ? {} : {
      costPerMlMicros,
      costPerMlFormatted: formatCostPerMeasureMicros(costPerMlMicros),
    }),
  };
}

// --- Чтение списка ----------------------------------------------------------

export interface ItemListQuery {
  q?: string;
  category?: string;
  location?: string;
  manufacturerId?: string | number;
  availability?: string;
  lowStock?: boolean;
  priceMissing?: boolean;
  includeInactive?: boolean;
  limit?: number;
}

export interface ItemListResult {
  items: ItemView[];
  showCost: boolean;
  categories: string[];
  storageLocations: string[];
  manufacturers: { id: number; name: string }[];
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
    manufacturerId: Number(query.manufacturerId) > 0 ? Number(query.manufacturerId) : null,
    availability: normalizeAvailability(query.availability),
    lowStockOnly: Boolean(query.lowStock),
    priceMissing: Boolean(query.priceMissing),
    includeInactive,
    limit: query.limit,
  });

  const lowStockCount = listItems(db, { lowStockOnly: true, includeInactive }).length;

  const manufacturerRows = listManufacturers(db);
  const manufacturerNames = new Map(manufacturerRows.map((row) => [row.id, row.name]));
  return {
    items: rows.map((row) => toItemView(row, {
      showCost,
      manufacturerName: row.manufacturerId ? manufacturerNames.get(row.manufacturerId) ?? null : null,
    })),
    showCost,
    categories: listCategories(db),
    storageLocations: listStorageLocations(db),
    manufacturers: manufacturerRows.map(({ id, name }) => ({ id, name })),
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
  const manufacturerName = row.manufacturerId
    ? listManufacturers(db).find((manufacturer) => manufacturer.id === row.manufacturerId)?.name ?? null
    : null;
  return toItemView(row, { showCost: canSeeCost(db, actor), manufacturerName });
}

export function itemFormOptions(db: AppDatabase): {
  units: string[];
  categories: string[];
  storageLocations: string[];
  manufacturers: { id: number; name: string }[];
} {
  return {
    units: listUnitsOfMeasurement(db),
    categories: listCategories(db),
    storageLocations: listStorageLocations(db),
    manufacturers: listManufacturers(db).map(({ id, name }) => ({ id, name })),
  };
}

// --- Add New Item (§5.4) ----------------------------------------------------

/** Сырые значения формы Add New Item / Edit Item. */
export interface ItemFormInput {
  name?: RawFormValue;
  trackingMethod?: RawFormValue;
  manufacturer?: RawFormValue;
  costPerUnit?: RawFormValue;
  unitOfMeasurement?: RawFormValue;
  /** §5.4: обязательное поле, значение 0 допустимо. Только при создании. */
  initialQuantity?: RawFormValue;
  initialUnopenedVials?: RawFormValue;
  initialOpenVialMl?: RawFormValue;
  volumePerVialMl?: RawFormValue;
  referenceNumber?: RawFormValue;
  category?: RawFormValue;
  storageLocation?: RawFormValue;
  lowStockThreshold?: RawFormValue;
  notes?: RawFormValue;
  status?: RawFormValue;
}

interface ValidatedItemFields {
  name: string;
  trackingMethod: TrackingMethod;
  manufacturer: string | null;
  currentUnitCostCents: number;
  unitOfMeasurement: string;
  referenceNumber: string | null;
  category: string | null;
  storageLocation: string | null;
  lowStockThreshold: number | null;
  notes: string | null;
  liquidVolumePerVialCentiml: number | null;
}

function validateItemFields(
  input: ItemFormInput,
  v: FieldValidator,
): ValidatedItemFields {
  const trackingMethod = v.oneOf(
    'trackingMethod', input.trackingMethod ?? 'standard', TRACKING_METHODS, 'Inventory Tracking Method',
  );
  let liquidVolumePerVialCentiml: number | null = null;
  if (trackingMethod === 'liquid') {
    try {
      liquidVolumePerVialCentiml = parseMlToCentiml(v.text(input.volumePerVialMl), 'Volume per Vial');
    } catch (error) {
      v.add('volumePerVialMl', error instanceof Error ? error.message : 'Volume per Vial is invalid');
    }
  }
  return {
    name: v.requiredText('name', input.name, 'Item Name'),
    trackingMethod,
    manufacturer: v.optionalText('manufacturer', input.manufacturer, 120),
    currentUnitCostCents: v.requiredCents(
      'costPerUnit', input.costPerUnit, trackingMethod === 'liquid' ? 'Cost per Vial' : 'Cost per Unit',
    ),
    unitOfMeasurement: trackingMethod === 'liquid'
      ? 'ml'
      : v.requiredText('unitOfMeasurement', input.unitOfMeasurement, 'Unit of Measurement', 32),
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
    liquidVolumePerVialCentiml,
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
  const initialQuantity = fields.trackingMethod === 'standard'
    ? v.requiredInteger('initialQuantity', input.initialQuantity, 'Initial Quantity', { min: 0 })
    : 0;
  const initialUnopenedVials = fields.trackingMethod === 'liquid'
    ? v.requiredInteger('initialUnopenedVials', input.initialUnopenedVials, 'Number of Vials', { min: 0 })
    : 0;
  let initialOpenVialCentiml = 0;
  if (fields.trackingMethod === 'liquid' && v.text(input.initialOpenVialMl)) {
    try {
      initialOpenVialCentiml = parseNonNegativeMlToCentiml(v.text(input.initialOpenVialMl), 'Remaining ml in Open Vial');
      if (fields.liquidVolumePerVialCentiml && initialOpenVialCentiml > fields.liquidVolumePerVialCentiml) {
        v.add('initialOpenVialMl', 'Remaining ml cannot exceed Volume per Vial');
      }
    } catch (error) {
      v.add('initialOpenVialMl', error instanceof Error ? error.message : 'Remaining ml is invalid');
    }
  }
  if (v.hasErrors) return failFields(v.errors);

  return runAction(() => {
    const created = createItem(db, actor, {
      ...fields,
      initialQuantity,
      initialUnopenedVials,
      initialOpenVialCentiml,
    });
    return { itemId: created.id, internalCode: created.internalCode, name: created.name };
  });
}

// --- Edit (§5.7) ------------------------------------------------------------

export interface UpdatedItem {
  itemId: number;
  internalCode: string;
  name: string;
}

/**
 * Редактирование предмета (§5.7).
 *
 * Внутренний код и штрихкод здесь нельзя передать напрямую: их нет в
 * `ItemFormInput`. Штрихкод всегда равен постоянному системному Item Code.
 * Изменение стоимости влияет только на будущие добавления — ни одна строка
 * операции отсюда не переписывается (§11.3, §11.4, §18.15, §18.16).
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

    const updated = updateItem(db, actor, itemId, {
      name: fields.name,
      manufacturer: fields.manufacturer,
      currentUnitCostCents: fields.currentUnitCostCents,
      unitOfMeasurement: fields.unitOfMeasurement,
      referenceNumber: fields.referenceNumber,
      category: fields.category,
      storageLocation: fields.storageLocation,
      lowStockThreshold: fields.lowStockThreshold,
      notes: fields.notes,
      ...(status ? { status } : {}),
    });

    return {
      itemId: updated.id,
      internalCode: updated.internalCode,
      name: updated.name,
    };
  });
}

export interface DeletedItem {
  itemId: number;
  internalCode: string;
  name: string;
  disposition: 'deleted' | 'archived';
}

export function deleteItemAction(
  db: AppDatabase,
  actor: Actor,
  itemId: number,
): ActionResult<DeletedItem> {
  if (!isAdmin(actor)) return forbidden('delete item');
  return runAction(() => {
    const result = deleteItem(db, actor, itemId);
    return {
      itemId,
      internalCode: result.item.internalCode,
      name: result.item.name,
      disposition: result.disposition,
    };
  });
}

export function convertItemToLiquidAction(db: AppDatabase, actor: Actor, input: {
  itemId?: RawFormValue;
  volumePerVialMl?: RawFormValue;
  costPerVial?: RawFormValue;
}): ActionResult<UpdatedItem> {
  if (!isAdmin(actor)) return forbidden('convert an item to liquid volume');
  const v = new FieldValidator();
  const itemId = v.requiredInteger('itemId', input.itemId, 'Item', { min: 1 });
  const costPerVialCents = v.requiredCents('costPerVial', input.costPerVial, 'Cost per Vial');
  let volumePerVialCentiml = 0;
  try { volumePerVialCentiml = parseMlToCentiml(v.text(input.volumePerVialMl), 'Volume per Vial'); }
  catch (error) { v.add('volumePerVialMl', error instanceof Error ? error.message : 'Volume per Vial is invalid'); }
  if (v.hasErrors) return failFields(v.errors);
  return runAction(() => {
    const item = convertItemToLiquid(db, actor, { itemId, volumePerVialCentiml, costPerVialCents });
    return { itemId: item.id, internalCode: item.internalCode, name: item.name };
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
  liquidUnopenedVialsAfter?: number;
  liquidOpenVialCentimlAfter?: number;
  /** false — событие с этим ключом уже применялось; остаток не изменён повторно. */
  applied: boolean;
}

export function receiveStockAction(
  db: AppDatabase,
  actor: Actor,
  input: ReceiveStockFormInput,
): ActionResult<StockChangeResult> {
  if (!isInventoryWorker(actor)) return forbidden('receive stock');

  const v = new FieldValidator();
  const itemId = v.requiredInteger('itemId', input.itemId, 'Item', { min: 1 });
  const quantity = v.requiredInteger('quantity', input.quantity, 'Quantity received', { min: 1 });
  const clientEventId = v.requiredText('clientEventId', input.clientEventId, 'Request id', 120);
  const rawCost = v.text(input.newCostPerUnit);
  if (rawCost && !canSeeCost(db, actor)) return forbidden('change receipt cost');
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
    return {
      itemId,
      quantityAfter: result.quantityAfter,
      ...(result.liquidUnopenedVialsAfter === undefined ? {} : {
        liquidUnopenedVialsAfter: result.liquidUnopenedVialsAfter,
        liquidOpenVialCentimlAfter: result.liquidOpenVialCentimlAfter,
      }),
      applied: result.applied,
    };
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
  unopenedVials?: RawFormValue;
  openVialMl?: RawFormValue;
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
  const item = getItem(db, itemId);
  const mode = v.oneOf('mode', input.mode ?? 'delta', ADJUSTMENT_MODES, 'Adjustment type');
  const legacyReasons: Record<string, AdjustmentReason> = {
    damaged: 'Damaged', expired: 'Discarded', missing: 'Used but Not Recorded',
    other: 'Other', 'inventory correction': 'Inventory Count Correction',
  };
  const rawReason = v.text(input.reason);
  const reason: AdjustmentReason = v.oneOf(
    'reason',
    legacyReasons[rawReason.toLocaleLowerCase()] ?? input.reason,
    ADJUSTMENT_REASONS,
    'Reason',
  );
  const notes = v.optionalText('notes', input.notes, 500);
  const clientEventId = v.requiredText('clientEventId', input.clientEventId, 'Request id', 120);

  const isLiquid = item?.trackingMethod === 'liquid';
  const amount = isLiquid ? 0 : mode === 'set'
    ? v.requiredInteger('amount', input.amount, 'New quantity', { min: 0 })
    : v.requiredInteger('amount', input.amount, 'Quantity change');

  const unopenedVials = isLiquid
    ? v.requiredInteger('unopenedVials', input.unopenedVials, 'Unopened vials', { min: 0 })
    : 0;
  let openVialCentiml = 0;
  if (isLiquid && !v.text(input.openVialMl)) {
    v.add('openVialMl', 'Remaining ml in Open Vial is required');
  } else if (isLiquid) {
    try {
      openVialCentiml = parseNonNegativeMlToCentiml(v.text(input.openVialMl), 'Remaining ml in Open Vial');
    } catch (error) {
      v.add('openVialMl', error instanceof Error ? error.message : 'Remaining ml is invalid');
    }
  }
  if (isLiquid && item?.liquidVolumePerVialCentiml && openVialCentiml > item.liquidVolumePerVialCentiml) {
    v.add('openVialMl', 'Remaining ml cannot exceed Volume per Vial');
  }

  if (!isLiquid && mode === 'delta' && amount === 0 && !v.errors.amount) {
    v.add('amount', 'Quantity change cannot be zero');
  }
  if (reason === 'Other' && !notes) v.add('notes', 'Explanation is required when Reason is Other');
  if (v.hasErrors) return failFields(v.errors);

  // §5.9 требует причину из списка; свободный комментарий лишь дополняет её.
  // Пациентские данные в него вносить нельзя (§18.3) — предупреждение в UI.
  const fullReason = notes ? `${reason}: ${notes}` : reason;

  return runAction(() => {
    if (isLiquid) {
      const result = adjustLiquidStock(db, actor, {
        itemId,
        unopenedVials,
        openVialCentiml,
        reason: fullReason,
        clientEventId,
      });
      return {
        itemId,
        quantityAfter: result.unopenedVialsAfter,
        liquidUnopenedVialsAfter: result.unopenedVialsAfter,
        liquidOpenVialCentimlAfter: result.openVialCentimlAfter,
        applied: result.applied,
      };
    }
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
