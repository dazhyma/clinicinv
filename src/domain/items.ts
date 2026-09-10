/**
 * Предметы инвентаря: создание, редактирование, поставка, ручная корректировка
 * (§5.4, §5.5, §5.7, §5.8, §5.9, §5.11).
 *
 * Каждое изменение проверяет право внутри домена (§3.2, §18.22). Receive Stock
 * доступен Staff и Admin; создание, редактирование и adjustment — только Admin.
 */
import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import type { AppDatabase, DbLike } from '@/db/client';
import {
  barcodeRegistry,
  inventoryCountLines,
  inventoryCounts,
  inventoryMovements,
  liquidInventoryMovements,
  itemHistoryEvents,
  items,
  operationItems,
  operations,
  packItems,
  DEFAULT_UNITS_OF_MEASUREMENT,
  type EntityStatus,
  type ItemRow,
  type TrackingMethod,
} from '@/db/schema';
import { normalizeSearchCode } from '@/lib/search-normalization';
import { assertAdmin, assertInventoryWorker, isAdmin, type Actor } from './actor';
import { AUDIT_ACTIONS, writeAudit } from './audit';
import { ITEM_CODE_PREFIX, nextInternalCode, normalizeScannedCode } from './codes';
import { errors } from './errors';
import { applyLiquidMovement } from './liquid-movements';
import { liquidTotalCentiml } from './liquid';
import { resolveManufacturer } from './manufacturers';
import { writeItemHistoryEvent } from './item-history';
import { assertNonNegativeCents, formatCents } from './money';
import { applyMovement, idempotencyKeys, runInTransaction } from './movements';
import { assertNonNegativeQuantity, assertPositiveQuantity, isValidQuantity } from './quantity';
import { staffCanSeeCost } from './settings';

/** Регистрирует единственный штрихкод Item — его постоянный системный код. */
function registerItemBarcode(
  tx: DbLike,
  barcodeValue: string,
  itemId: number,
  createdAt: Date,
): void {
  tx.insert(barcodeRegistry)
    .values({ barcodeValue, ownerType: 'item', ownerId: itemId, createdAt })
    .run();
}

export interface CreateItemInput {
  name: string;
  trackingMethod?: TrackingMethod;
  manufacturer?: string | null;
  /** §5.4: обязательное поле. Целые центы. */
  currentUnitCostCents: number;
  /** §5.4: обязательное поле. */
  unitOfMeasurement: string;
  /** §5.4: обязательное поле, может быть 0. */
  initialQuantity: number;
  initialUnopenedVials?: number;
  initialOpenVialCentiml?: number;
  liquidVolumePerVialCentiml?: number | null;
  referenceNumber?: string | null;
  category?: string | null;
  storageLocation?: string | null;
  lowStockThreshold?: number | null;
  notes?: string | null;
  status?: EntityStatus;
}

/**
 * Создаёт предмет: выдаёт постоянный внутренний код, регистрирует штрихкод в
 * глобальном реестре и — если Initial Quantity > 0 — пишет движение `initial`.
 *
 * Начальное количество проходит через журнал движений намеренно (C-13):
 * прямая запись в current_quantity сломала бы инвариант
 * current_quantity == SUM(quantity_delta) на первом же предмете, после чего
 * любая сверка склада стала бы невозможной.
 */
export function createItem(db: AppDatabase, actor: Actor, input: CreateItemInput): ItemRow {
  assertAdmin(actor, 'create item');

  const name = input.name?.trim();
  if (!name) throw errors.validationFailed('Item Name is required');
  const trackingMethod = input.trackingMethod ?? 'standard';
  const unitOfMeasurement = trackingMethod === 'liquid' ? 'ml' : input.unitOfMeasurement?.trim();
  if (!unitOfMeasurement) throw errors.validationFailed('Unit of Measurement is required');
  assertNonNegativeCents(input.currentUnitCostCents, 'Cost per Unit');
  assertNonNegativeQuantity(input.initialQuantity, 'Initial Quantity');
  const initialUnopenedVials = input.initialUnopenedVials ?? 0;
  const initialOpenVialCentiml = input.initialOpenVialCentiml ?? 0;
  const volumePerVial = input.liquidVolumePerVialCentiml ?? null;
  if (trackingMethod === 'liquid') {
    assertNonNegativeQuantity(initialUnopenedVials, 'Number of Vials');
    if (!volumePerVial || volumePerVial <= 0) throw errors.validationFailed('Volume per Vial is required');
    if (initialOpenVialCentiml < 0 || initialOpenVialCentiml > volumePerVial) {
      throw errors.validationFailed('Open vial amount cannot exceed Volume per Vial');
    }
  }
  if (input.lowStockThreshold != null) {
    assertNonNegativeQuantity(input.lowStockThreshold, 'Low Stock Threshold');
  }

  return runInTransaction(db, (tx) => {
    const internalCode = nextInternalCode(tx, ITEM_CODE_PREFIX);
    const barcodeValue = internalCode;
    const now = new Date();
    const manufacturer = resolveManufacturer(tx, actor, input.manufacturer);

    const created = tx
      .insert(items)
      .values({
        internalCode,
        barcodeValue,
        name,
        referenceNumber: input.referenceNumber?.trim() || null,
        trackingMethod,
        manufacturerId: manufacturer?.id ?? null,
        currentUnitCostCents: input.currentUnitCostCents,
        unitOfMeasurement,
        currentQuantity: 0,
        liquidVolumePerVialCentiml: trackingMethod === 'liquid' ? volumePerVial : null,
        liquidUnopenedVials: 0,
        liquidOpenVialCentiml: 0,
        category: input.category?.trim() || null,
        storageLocation: input.storageLocation?.trim() || null,
        lowStockThreshold: input.lowStockThreshold ?? null,
        notes: input.notes?.trim() || null,
        status: input.status ?? 'active',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    registerItemBarcode(tx, internalCode, created.id, now);

    let finalRow = created;
    if (trackingMethod === 'standard' && input.initialQuantity > 0) {
      const result = applyMovement(tx, {
        itemId: created.id,
        movementType: 'initial',
        quantityDelta: input.initialQuantity,
        idempotencyKey: idempotencyKeys.initialStock(created.id),
        reason: 'initial stock',
        unitCostAtReceiptCents: input.currentUnitCostCents,
        actorAccountId: actor.accountId,
      });
      finalRow = { ...created, currentQuantity: result.quantityAfter };
    } else if (trackingMethod === 'liquid' && (initialUnopenedVials > 0 || initialOpenVialCentiml > 0)) {
      const result = applyLiquidMovement(tx, {
        itemId: created.id,
        movementType: 'initial',
        next: { unopenedVials: initialUnopenedVials, openVialCentiml: initialOpenVialCentiml },
        idempotencyKey: `liquid:initial:${created.id}`,
        reason: 'initial liquid stock',
        vialCostAtReceiptCents: input.currentUnitCostCents,
        actorAccountId: actor.accountId,
      });
      finalRow = {
        ...created,
        liquidUnopenedVials: result.unopenedVials,
        liquidOpenVialCentiml: result.openVialCentiml,
      };
    }

    writeAudit(tx, {
      action: AUDIT_ACTIONS.itemCreated,
      actorAccountId: actor.accountId,
      actorRole: actor.role,
      entityType: 'item',
      entityId: created.id,
      summary: trackingMethod === 'liquid'
        ? `${internalCode} "${name}" @ ${formatCents(input.currentUnitCostCents)}/vial, initial ${initialUnopenedVials} vials`
        : `${internalCode} "${name}" @ ${formatCents(input.currentUnitCostCents)}, initial ${input.initialQuantity}`,
    });
    writeItemHistoryEvent(tx, {
      itemId: created.id,
      eventType: 'item.created',
      newValue: name,
      actorAccountId: actor.accountId,
      actorRole: actor.role,
      createdAt: now,
    });

    return finalRow;
  });
}

/**
 * Поля, которые Admin может менять через обычную форму (§5.7).
 * `internal_code` и `barcode_value` в этот тип не входят: оба значения
 * постоянны и не редактируются пользователем.
 */
export interface UpdateItemPatch {
  name?: string;
  manufacturer?: string | null;
  referenceNumber?: string | null;
  currentUnitCostCents?: number;
  unitOfMeasurement?: string;
  category?: string | null;
  storageLocation?: string | null;
  lowStockThreshold?: number | null;
  notes?: string | null;
  status?: EntityStatus;
}

const IMMUTABLE_ITEM_FIELDS = [
  'internalCode', 'barcodeValue', 'internal_code', 'barcode_value',
  'currentQuantity', 'current_quantity', 'trackingMethod', 'tracking_method',
  'liquidVolumePerVialCentiml', 'liquid_volume_per_vial_centiml',
];

/**
 * Редактирование предмета.
 *
 * Изменение стоимости влияет ТОЛЬКО на будущие добавления: ни одна строка
 * operation_items здесь не обновляется — ни в завершённых, ни в активных
 * операциях (§5.7, §11.3, §11.4, §18.15, §18.16).
 *
 * Остаток отсюда изменить нельзя: для этого есть receiveStock/adjustStock,
 * которые пишут движения (§10.4).
 */
export function updateItem(
  db: AppDatabase,
  actor: Actor,
  itemId: number,
  patch: UpdateItemPatch,
): ItemRow {
  assertAdmin(actor, 'edit item');

  for (const field of IMMUTABLE_ITEM_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      throw errors.immutableField(field);
    }
  }

  if (patch.currentUnitCostCents !== undefined) {
    assertNonNegativeCents(patch.currentUnitCostCents, 'Cost per Unit');
  }
  if (patch.lowStockThreshold != null) {
    assertNonNegativeQuantity(patch.lowStockThreshold, 'Low Stock Threshold');
  }
  if (patch.name !== undefined && !patch.name.trim()) {
    throw errors.validationFailed('Item Name is required');
  }

  return runInTransaction(db, (tx) => {
    const existing = tx.select().from(items).where(eq(items.id, itemId)).get();
    if (!existing) throw errors.itemNotFound(itemId);
    if (existing.archivedAt) {
      throw errors.validationFailed(`${existing.name} is archived and cannot be edited`);
    }
    const manufacturer = patch.manufacturer === undefined
      ? undefined
      : resolveManufacturer(tx, actor, patch.manufacturer);
    const updated = tx
      .update(items)
      .set({
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(manufacturer !== undefined ? { manufacturerId: manufacturer?.id ?? null } : {}),
        ...(patch.referenceNumber !== undefined
          ? { referenceNumber: patch.referenceNumber?.trim() || null }
          : {}),
        ...(patch.currentUnitCostCents !== undefined
          ? { currentUnitCostCents: patch.currentUnitCostCents }
          : {}),
        ...(patch.unitOfMeasurement !== undefined
          ? { unitOfMeasurement: patch.unitOfMeasurement.trim() }
          : {}),
        ...(patch.category !== undefined ? { category: patch.category?.trim() || null } : {}),
        ...(patch.storageLocation !== undefined
          ? { storageLocation: patch.storageLocation?.trim() || null }
          : {}),
        ...(patch.lowStockThreshold !== undefined
          ? { lowStockThreshold: patch.lowStockThreshold }
          : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes?.trim() || null } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        updatedAt: new Date(),
      })
      .where(eq(items.id, itemId))
      .returning()
      .get();

    if (
      patch.currentUnitCostCents !== undefined &&
      patch.currentUnitCostCents !== existing.currentUnitCostCents
    ) {
      writeAudit(tx, {
        action: AUDIT_ACTIONS.itemCostChanged,
        actorAccountId: actor.accountId,
        actorRole: actor.role,
        entityType: 'item',
        entityId: itemId,
        summary: `${existing.internalCode}: ${formatCents(existing.currentUnitCostCents)} -> ${formatCents(patch.currentUnitCostCents)}`,
      });
    }

    const historyFields: Array<{
      field: keyof UpdateItemPatch;
      eventType: 'item.information_changed' | 'item.cost_changed';
      oldValue: unknown;
      newValue: unknown;
    }> = [
      {
        field: 'name',
        eventType: 'item.information_changed',
        oldValue: existing.name,
        newValue: updated.name,
      },
      {
        field: 'manufacturer',
        eventType: 'item.information_changed',
        oldValue: existing.manufacturerId,
        newValue: updated.manufacturerId,
      },
      {
        field: 'referenceNumber',
        eventType: 'item.information_changed',
        oldValue: existing.referenceNumber,
        newValue: updated.referenceNumber,
      },
      {
        field: 'currentUnitCostCents',
        eventType: 'item.cost_changed',
        oldValue: existing.currentUnitCostCents,
        newValue: updated.currentUnitCostCents,
      },
      {
        field: 'unitOfMeasurement',
        eventType: 'item.information_changed',
        oldValue: existing.unitOfMeasurement,
        newValue: updated.unitOfMeasurement,
      },
      {
        field: 'category',
        eventType: 'item.information_changed',
        oldValue: existing.category,
        newValue: updated.category,
      },
      {
        field: 'storageLocation',
        eventType: 'item.information_changed',
        oldValue: existing.storageLocation,
        newValue: updated.storageLocation,
      },
      {
        field: 'lowStockThreshold',
        eventType: 'item.information_changed',
        oldValue: existing.lowStockThreshold,
        newValue: updated.lowStockThreshold,
      },
      {
        field: 'notes',
        eventType: 'item.information_changed',
        oldValue: existing.notes,
        newValue: updated.notes,
      },
      {
        field: 'status',
        eventType: 'item.information_changed',
        oldValue: existing.status,
        newValue: updated.status,
      },
    ];
    const changedFields = new Set(Object.keys(patch));
    for (const change of historyFields) {
      if (!changedFields.has(change.field) || Object.is(change.oldValue, change.newValue)) continue;
      writeItemHistoryEvent(tx, {
        itemId,
        eventType: change.eventType,
        fieldName: change.field,
        oldValue: change.oldValue == null ? null : String(change.oldValue),
        newValue: change.newValue == null ? null : String(change.newValue),
        actorAccountId: actor.accountId,
        actorRole: actor.role,
      });
    }

    writeAudit(tx, {
      action: AUDIT_ACTIONS.itemUpdated,
      actorAccountId: actor.accountId,
      actorRole: actor.role,
      entityType: 'item',
      entityId: itemId,
      summary: `${existing.internalCode}: ${Object.keys(patch).join(', ') || 'no changes'}`,
    });

    return updated;
  });
}

export interface ReceiveStockInput {
  itemId: number;
  quantity: number;
  /**
   * Новая себестоимость единицы. Q-9 / §5.8: в MVP последняя указанная цена
   * становится текущей для БУДУЩИХ операций; история не пересчитывается.
   */
  newUnitCostCents?: number | null;
  /** Идентификатор события, сгенерированный клиентом; переживает ретраи. */
  clientEventId: string;
  reason?: string | null;
}

export interface ReceiveStockResult {
  item: ItemRow;
  quantityAfter: number;
  liquidUnopenedVialsAfter?: number;
  liquidOpenVialCentimlAfter?: number;
  /** false — тот же clientEventId уже применялся, поставка не задвоена. */
  applied: boolean;
}

/** Receive Stock (§5.8). */
export function receiveStock(
  db: AppDatabase,
  actor: Actor,
  input: ReceiveStockInput,
): ReceiveStockResult {
  assertInventoryWorker(actor, 'receive stock');
  if (
    input.newUnitCostCents != null &&
    !isAdmin(actor) &&
    !staffCanSeeCost(db)
  ) {
    throw errors.forbidden('change receipt cost');
  }
  assertPositiveQuantity(input.quantity, 'Received quantity');
  if (input.newUnitCostCents != null) {
    assertNonNegativeCents(input.newUnitCostCents, 'Cost per Unit');
  }

  return runInTransaction(db, (tx) => {
    const item = tx.select().from(items).where(eq(items.id, input.itemId)).get();
    if (!item) throw errors.itemNotFound(input.itemId);
    if (item.status !== 'active' || item.archivedAt) throw errors.itemInactive(item.name);

    if (item.trackingMethod === 'liquid') {
      const movement = applyLiquidMovement(tx, {
        itemId: input.itemId,
        movementType: 'received',
        next: {
          unopenedVials: item.liquidUnopenedVials + input.quantity,
          openVialCentiml: item.liquidOpenVialCentiml,
        },
        idempotencyKey: `liquid:${idempotencyKeys.receiveStock(input.clientEventId)}`,
        reason: input.reason ?? null,
        vialCostAtReceiptCents: input.newUnitCostCents ?? item.currentUnitCostCents,
        actorAccountId: actor.accountId,
      });
      let updated = item;
      if (movement.created && input.newUnitCostCents != null) {
        updated = tx.update(items).set({
          currentUnitCostCents: input.newUnitCostCents,
          updatedAt: new Date(),
        }).where(eq(items.id, input.itemId)).returning().get();
      }
      if (movement.created) {
        writeAudit(tx, {
          action: AUDIT_ACTIONS.stockReceived,
          actorAccountId: actor.accountId,
          actorRole: actor.role,
          entityType: 'item',
          entityId: input.itemId,
          summary: `${item.internalCode}: +${input.quantity} unopened vials -> ${movement.unopenedVials}`,
        });
      }
      return {
        item: {
          ...updated,
          liquidUnopenedVials: movement.unopenedVials,
          liquidOpenVialCentiml: movement.openVialCentiml,
        },
        quantityAfter: movement.unopenedVials,
        liquidUnopenedVialsAfter: movement.unopenedVials,
        liquidOpenVialCentimlAfter: movement.openVialCentiml,
        applied: movement.created,
      };
    }

    const movement = applyMovement(tx, {
      itemId: input.itemId,
      movementType: 'received',
      quantityDelta: input.quantity,
      idempotencyKey: idempotencyKeys.receiveStock(input.clientEventId),
      reason: input.reason ?? null,
      unitCostAtReceiptCents: input.newUnitCostCents ?? item.currentUnitCostCents,
      actorAccountId: actor.accountId,
    });

    let updated = item;
    if (movement.created) {
      updated = tx
        .update(items)
        .set({
          ...(input.newUnitCostCents != null
            ? { currentUnitCostCents: input.newUnitCostCents }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(items.id, input.itemId))
        .returning()
        .get();

      writeAudit(tx, {
        action: AUDIT_ACTIONS.stockReceived,
        actorAccountId: actor.accountId,
        actorRole: actor.role,
        entityType: 'item',
        entityId: input.itemId,
        summary: `${item.internalCode}: +${input.quantity} -> ${movement.quantityAfter}`,
      });
    }

    return {
      item: { ...updated, currentQuantity: movement.quantityAfter },
      quantityAfter: movement.quantityAfter,
      applied: movement.created,
    };
  });
}

export type StockChange =
  | { type: 'delta'; delta: number }
  | { type: 'set'; quantity: number };

export interface AdjustStockInput {
  itemId: number;
  /** §5.9: «величина изменения ИЛИ новое фактическое количество» (Q-21). */
  change: StockChange;
  /** §5.9: причина обязательна. */
  reason: string;
  clientEventId: string;
}

/**
 * Ручная корректировка остатка (§5.9).
 *
 * В журнал всегда пишется ДЕЛЬТА, даже если Admin ввёл новое абсолютное
 * количество: дельта вычисляется от текущего значения в той же транзакции.
 * Хранение абсолютного значения в журнале движений сломало бы пересчёт (Q-21).
 *
 * Завершённые операции корректировка не меняет — она вообще их не касается.
 */
export function adjustStock(
  db: AppDatabase,
  actor: Actor,
  input: AdjustStockInput,
): { quantityAfter: number; applied: boolean } {
  assertAdmin(actor, 'adjust stock');
  const reason = input.reason?.trim();
  if (!reason) throw errors.validationFailed('A reason is required for a manual adjustment');

  return runInTransaction(db, (tx) => {
    const item = tx.select().from(items).where(eq(items.id, input.itemId)).get();
    if (!item) throw errors.itemNotFound(input.itemId);
    if (item.status !== 'active' || item.archivedAt) throw errors.itemInactive(item.name);

    let delta: number;
    if (input.change.type === 'delta') {
      delta = input.change.delta;
    } else {
      assertNonNegativeQuantity(input.change.quantity, 'New quantity');
      delta = input.change.quantity - item.currentQuantity;
    }

    if (!isValidQuantity(delta) || delta === 0) {
      // Установка того же количества — не ошибка, а отсутствие изменения.
      return { quantityAfter: item.currentQuantity, applied: false };
    }

    const movement = applyMovement(tx, {
      itemId: input.itemId,
      movementType: 'manual_adjustment',
      quantityDelta: delta,
      idempotencyKey: idempotencyKeys.manualAdjustment(input.clientEventId),
      reason,
      actorAccountId: actor.accountId,
    });

    if (movement.created) {
      writeAudit(tx, {
        action: AUDIT_ACTIONS.stockAdjusted,
        actorAccountId: actor.accountId,
        actorRole: actor.role,
        entityType: 'item',
        entityId: input.itemId,
        summary: `${item.internalCode}: ${delta > 0 ? '+' : ''}${delta} -> ${movement.quantityAfter} (${reason})`,
      });
    }

    return { quantityAfter: movement.quantityAfter, applied: movement.created };
  });
}

export interface AdjustLiquidStockInput {
  itemId: number;
  unopenedVials: number;
  openVialCentiml: number;
  reason: string;
  clientEventId: string;
}

export function adjustLiquidStock(
  db: AppDatabase,
  actor: Actor,
  input: AdjustLiquidStockInput,
): { unopenedVialsAfter: number; openVialCentimlAfter: number; applied: boolean } {
  assertAdmin(actor, 'adjust liquid stock');
  if (!input.reason.trim()) throw errors.validationFailed('A reason is required for a manual adjustment');
  return runInTransaction(db, (tx) => {
    const item = tx.select().from(items).where(eq(items.id, input.itemId)).get();
    if (!item) throw errors.itemNotFound(input.itemId);
    if (item.status !== 'active' || item.archivedAt) throw errors.itemInactive(item.name);
    const movement = applyLiquidMovement(tx, {
      itemId: item.id,
      movementType: 'manual_adjustment',
      next: { unopenedVials: input.unopenedVials, openVialCentiml: input.openVialCentiml },
      idempotencyKey: `liquid:${idempotencyKeys.manualAdjustment(input.clientEventId)}`,
      reason: input.reason,
      actorAccountId: actor.accountId,
    });
    if (movement.created) {
      writeAudit(tx, {
        action: AUDIT_ACTIONS.stockAdjusted,
        actorAccountId: actor.accountId,
        actorRole: actor.role,
        entityType: 'item',
        entityId: item.id,
        summary: `${item.internalCode}: ${item.liquidUnopenedVials} vials + ${item.liquidOpenVialCentiml} centi-ml -> ${movement.unopenedVials} vials + ${movement.openVialCentiml} centi-ml (${input.reason})`,
      });
    }
    return {
      unopenedVialsAfter: movement.unopenedVials,
      openVialCentimlAfter: movement.openVialCentiml,
      applied: movement.created,
    };
  });
}

export interface ConvertItemToLiquidInput {
  itemId: number;
  volumePerVialCentiml: number;
  costPerVialCents: number;
}

/**
 * Односторонняя конвертация Standard → Liquid. Исторические строки операций и
 * движения остаются неизменными; текущий стандартный остаток переносится как
 * число запечатанных флаконов через два канонических журнала.
 */
export function convertItemToLiquid(
  db: AppDatabase,
  actor: Actor,
  input: ConvertItemToLiquidInput,
): ItemRow {
  assertAdmin(actor, 'convert an item to liquid volume');
  if (!Number.isSafeInteger(input.volumePerVialCentiml) || input.volumePerVialCentiml <= 0) {
    throw errors.validationFailed('Volume per Vial must be greater than 0');
  }
  assertNonNegativeCents(input.costPerVialCents, 'Cost per Vial');
  return runInTransaction(db, (tx) => {
    const item = getItem(tx, input.itemId);
    if (!item) throw errors.itemNotFound(input.itemId);
    if (item.archivedAt) throw errors.validationFailed('Archived items cannot be converted');
    if (item.trackingMethod !== 'standard') throw errors.validationFailed('Only a Standard Units item can be converted');
    if (tx.select({ id: packItems.id }).from(packItems).where(eq(packItems.itemId, item.id)).limit(1).get()) {
      throw errors.validationFailed('Remove this item from every Pack before converting it');
    }
    if (tx.select({ id: operationItems.id }).from(operationItems)
      .innerJoin(operations, eq(operations.id, operationItems.operationId))
      .where(and(eq(operationItems.itemId, item.id), eq(operations.status, 'Active'))).limit(1).get()) {
      throw errors.validationFailed('Finish or remove this item from its Active Surgery before converting it');
    }
    if (tx.select({ id: inventoryCountLines.id }).from(inventoryCountLines)
      .innerJoin(inventoryCounts, eq(inventoryCounts.id, inventoryCountLines.countId))
      .where(and(eq(inventoryCountLines.itemId, item.id), eq(inventoryCounts.status, 'draft'))).limit(1).get()) {
      throw errors.validationFailed('Complete or cancel the draft Inventory Count before converting this item');
    }

    if (item.currentQuantity > 0) applyMovement(tx, {
      itemId: item.id,
      movementType: 'manual_adjustment',
      quantityDelta: -item.currentQuantity,
      idempotencyKey: `convert-liquid:${item.id}:standard`,
      reason: 'Converted to liquid volume tracking',
      actorAccountId: actor.accountId,
    });
    const now = new Date();
    tx.update(items).set({
      trackingMethod: 'liquid',
      unitOfMeasurement: 'ml',
      currentUnitCostCents: input.costPerVialCents,
      liquidVolumePerVialCentiml: input.volumePerVialCentiml,
      liquidUnopenedVials: 0,
      liquidOpenVialCentiml: 0,
      lowStockThreshold: null,
      updatedAt: now,
    }).where(eq(items.id, item.id)).run();
    applyLiquidMovement(tx, {
      itemId: item.id,
      movementType: 'initial',
      next: { unopenedVials: item.currentQuantity, openVialCentiml: 0 },
      idempotencyKey: `liquid:convert-liquid:${item.id}`,
      reason: 'Converted from standard units',
      vialCostAtReceiptCents: input.costPerVialCents,
      actorAccountId: actor.accountId,
    });
    writeItemHistoryEvent(tx, { itemId: item.id, eventType: 'item.information_changed',
      fieldName: 'trackingMethod', oldValue: 'Standard Units', newValue: 'Liquid Volume (ml)',
      actorAccountId: actor.accountId, actorRole: actor.role, createdAt: now });
    writeAudit(tx, { action: AUDIT_ACTIONS.itemConvertedToLiquid, actorAccountId: actor.accountId,
      actorRole: actor.role, entityType: 'item', entityId: item.id,
      summary: `${item.internalCode}: ${item.currentQuantity} units -> ${item.currentQuantity} unopened vials at ${input.volumePerVialCentiml} centi-ml each` });
    return getItem(tx, item.id)!;
  });
}

// --- Чтение -----------------------------------------------------------------

export function getItem(tx: DbLike, itemId: number): ItemRow | undefined {
  return tx.select().from(items).where(eq(items.id, itemId)).get();
}

export interface DeleteItemResult {
  disposition: 'deleted' | 'archived';
  item: ItemRow;
}

/**
 * Delete Item необратим. Совершенно неиспользованный товар с нулевым остатком
 * удаляется вместе с barcode aliases и технической Item History. Любая
 * складская/операционная связь переводит его в Archived без изменения остатка.
 */
export function deleteItem(
  db: AppDatabase,
  actor: Actor,
  itemId: number,
): DeleteItemResult {
  assertAdmin(actor, 'delete item');

  return runInTransaction(db, (tx) => {
    const item = getItem(tx, itemId);
    if (!item) throw errors.itemNotFound(itemId);
    if (item.archivedAt) {
      throw errors.validationFailed(`${item.name} has already been archived`);
    }

    const hasMovement = Boolean(
      tx.select({ id: inventoryMovements.id }).from(inventoryMovements)
        .where(eq(inventoryMovements.itemId, itemId)).limit(1).get(),
    );
    const hasLiquidMovement = Boolean(
      tx.select({ id: liquidInventoryMovements.id }).from(liquidInventoryMovements)
        .where(eq(liquidInventoryMovements.itemId, itemId)).limit(1).get(),
    );
    const hasOperation = Boolean(
      tx.select({ id: operationItems.id }).from(operationItems)
        .where(eq(operationItems.itemId, itemId)).limit(1).get(),
    );
    const hasCount = Boolean(
      tx.select({ id: inventoryCountLines.id }).from(inventoryCountLines)
        .where(eq(inventoryCountLines.itemId, itemId)).limit(1).get(),
    );
    const belongsToPack = Boolean(
      tx.select({ id: packItems.id }).from(packItems)
        .where(eq(packItems.itemId, itemId)).limit(1).get(),
    );
    const mustArchive =
      item.currentQuantity !== 0 || item.liquidUnopenedVials !== 0 || item.liquidOpenVialCentiml !== 0 ||
      hasMovement || hasLiquidMovement || hasOperation || hasCount || belongsToPack;

    if (!mustArchive) {
      tx.delete(itemHistoryEvents).where(eq(itemHistoryEvents.itemId, itemId)).run();
      tx.delete(barcodeRegistry)
        .where(and(eq(barcodeRegistry.ownerType, 'item'), eq(barcodeRegistry.ownerId, itemId)))
        .run();
      tx.delete(items).where(eq(items.id, itemId)).run();
      writeAudit(tx, {
        action: AUDIT_ACTIONS.itemDeleted,
        actorAccountId: actor.accountId,
        actorRole: actor.role,
        entityType: 'item',
        entityId: itemId,
        summary: `${item.internalCode} "${item.name}" permanently deleted`,
      });
      return { disposition: 'deleted', item };
    }

    const now = new Date();
    const archived = tx
      .update(items)
      .set({
        status: 'inactive',
        archivedAt: now,
        archivedByAccountId: actor.accountId,
        updatedAt: now,
      })
      .where(eq(items.id, itemId))
      .returning()
      .get();
    writeItemHistoryEvent(tx, {
      itemId,
      eventType: 'item.archived',
      actorAccountId: actor.accountId,
      actorRole: actor.role,
      createdAt: now,
    });
    writeAudit(tx, {
      action: AUDIT_ACTIONS.itemArchived,
      actorAccountId: actor.accountId,
      actorRole: actor.role,
      entityType: 'item',
      entityId: itemId,
      summary: `${item.internalCode} "${item.name}" archived`,
    });
    return { disposition: 'archived', item: archived };
  });
}

/** Разрешение отсканированной строки в предмет (§7.5). */
export function findItemByBarcode(tx: DbLike, barcode: string): ItemRow | undefined {
  const normalized = normalizeScannedCode(barcode);
  return tx.select().from(items).where(eq(items.barcodeValue, normalized)).get();
}

/** Поиск по названию, системному Item Code и reference number. */
export function searchItems(
  tx: DbLike,
  query: string,
  options: { includeInactive?: boolean; limit?: number } = {},
): ItemRow[] {
  const rawQuery = query.trim();
  const term = `%${rawQuery.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const normalized = normalizeSearchCode(rawQuery);
  const statusCondition = options.includeInactive ? undefined : eq(items.status, 'active');
  const originalMatch = or(
    sql`${items.name} like ${term} escape '\\'`,
    sql`${items.internalCode} like ${term} escape '\\'`,
    sql`${items.referenceNumber} like ${term} escape '\\'`,
    sql`${items.barcodeValue} like ${term} escape '\\'`,
  );
  const match = normalized
    ? or(
        originalMatch,
        sql`normalize_code(${items.name}) like ${`%${normalized}%`}`,
        sql`normalize_code(${items.internalCode}) like ${`%${normalized}%`}`,
        sql`normalize_code(${items.referenceNumber}) like ${`%${normalized}%`}`,
        sql`normalize_code(${items.barcodeValue}) like ${`%${normalized}%`}`,
      )
    : originalMatch;

  return tx
    .select()
    .from(items)
    .where(statusCondition ? and(statusCondition, match) : match)
    .orderBy(items.name)
    .limit(options.limit ?? 50)
    .all();
}

/** §5.11: предмет считается «низким остатком», если порог задан и остаток <= порога. */
export function isLowStock(item: ItemRow): boolean {
  if (item.trackingMethod === 'liquid') {
    return item.liquidLowStockThresholdCentiml != null && item.liquidVolumePerVialCentiml != null &&
      liquidTotalCentiml(item.liquidUnopenedVials, item.liquidOpenVialCentiml, item.liquidVolumePerVialCentiml)
        <= item.liquidLowStockThresholdCentiml;
  }
  return item.lowStockThreshold != null && item.currentQuantity <= item.lowStockThreshold;
}

/** §5.3: наличие как фильтр списка. */
export const AVAILABILITY_FILTERS = ['all', 'in_stock', 'out_of_stock'] as const;
export type AvailabilityFilter = (typeof AVAILABILITY_FILTERS)[number];

export interface ItemListFilters {
  /** Одна строка ищется по названию, системному Item Code и reference number. */
  query?: string;
  category?: string | null;
  storageLocation?: string | null;
  manufacturerId?: number | null;
  availability?: AvailabilityFilter;
  /** §5.11: только предметы на пороге низкого остатка или ниже. */
  lowStockOnly?: boolean;
  priceMissing?: boolean;
  includeInactive?: boolean;
  /** `null` запрашивает полный список для форм, которым нужен весь каталог. */
  limit?: number | null;
}

/**
 * Список предметов с поиском и фильтрами (§5.2, §5.3, §5.11).
 *
 * Фильтрация выполняется в SQL, а не в JS: список предметов клиники (Q-43:
 * до ~5000 наименований) не должен целиком подниматься в память ради поиска.
 */
export function listItems(tx: DbLike, filters: ItemListFilters = {}): ItemRow[] {
  const conditions: SQL[] = [];

  if (!filters.includeInactive) {
    conditions.push(eq(items.status, 'active'));
  }

  const query = filters.query?.trim();
  if (query) {
    // Экранирование служебных символов LIKE: без него «100%» или «a_b»
    // молча превратились бы в шаблон и дали неверную выборку.
    const term = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    const originalMatch = or(
      sql`${items.name} like ${term} escape '\\'`,
      sql`${items.internalCode} like ${term} escape '\\'`,
      sql`${items.referenceNumber} like ${term} escape '\\'`,
      sql`${items.barcodeValue} like ${term} escape '\\'`,
    );
    const normalized = normalizeSearchCode(query);
    const match = normalized
      ? or(
          originalMatch,
          sql`normalize_code(${items.name}) like ${`%${normalized}%`}`,
          sql`normalize_code(${items.internalCode}) like ${`%${normalized}%`}`,
          sql`normalize_code(${items.referenceNumber}) like ${`%${normalized}%`}`,
          sql`normalize_code(${items.barcodeValue}) like ${`%${normalized}%`}`,
        )
      : originalMatch;
    if (match) conditions.push(match);
  }

  if (filters.category) conditions.push(eq(items.category, filters.category));
  if (filters.storageLocation) conditions.push(eq(items.storageLocation, filters.storageLocation));
  if (filters.manufacturerId) conditions.push(eq(items.manufacturerId, filters.manufacturerId));

  if (filters.availability === 'in_stock') {
    conditions.push(sql`CASE WHEN ${items.trackingMethod} = 'liquid'
      THEN (${items.liquidUnopenedVials} * ${items.liquidVolumePerVialCentiml} + ${items.liquidOpenVialCentiml}) > 0
      ELSE ${items.currentQuantity} > 0 END`);
  } else if (filters.availability === 'out_of_stock') {
    conditions.push(sql`CASE WHEN ${items.trackingMethod} = 'liquid'
      THEN (${items.liquidUnopenedVials} * ${items.liquidVolumePerVialCentiml} + ${items.liquidOpenVialCentiml}) <= 0
      ELSE ${items.currentQuantity} <= 0 END`);
  }

  if (filters.lowStockOnly) {
    conditions.push(
      sql`CASE WHEN ${items.trackingMethod} = 'liquid'
        THEN ${items.liquidLowStockThresholdCentiml} is not null AND
          (${items.liquidUnopenedVials} * ${items.liquidVolumePerVialCentiml} + ${items.liquidOpenVialCentiml}) <= ${items.liquidLowStockThresholdCentiml}
        ELSE ${items.lowStockThreshold} is not null AND ${items.currentQuantity} <= ${items.lowStockThreshold} END`,
    );
  }
  if (filters.priceMissing) conditions.push(eq(items.currentUnitCostCents, 0));

  const where = conditions.length ? and(...conditions) : undefined;

  return tx
    .select()
    .from(items)
    .where(where)
    .orderBy(items.name)
    // SQLite трактует LIMIT -1 как отсутствие лимита. Обычные каталоги по-
    // прежнему ограничены 200 строками; полный список запрашивается явно.
    .limit(filters.limit === null ? -1 : filters.limit ?? 200)
    .all();
}

/** Значения для выпадающего фильтра по категории (§5.3). */
export function listCategories(tx: DbLike): string[] {
  return tx
    .selectDistinct({ value: items.category })
    .from(items)
    .where(sql`${items.category} is not null and trim(${items.category}) <> ''`)
    .orderBy(items.category)
    .all()
    .map((row) => row.value)
    .filter((value): value is string => Boolean(value));
}

/** Значения для выпадающего фильтра по месту хранения (§5.3). */
export function listStorageLocations(tx: DbLike): string[] {
  return tx
    .selectDistinct({ value: items.storageLocation })
    .from(items)
    .where(sql`${items.storageLocation} is not null and trim(${items.storageLocation}) <> ''`)
    .orderBy(items.storageLocation)
    .all()
    .map((row) => row.value)
    .filter((value): value is string => Boolean(value));
}

/**
 * §5.4: семь значений из ТЗ плюс те, что Admin уже ввёл сам
 * («другие настраиваемые варианты», Q-24). Жёсткого enum в БД нет намеренно:
 * добавление единицы измерения не должно требовать миграции.
 */
export function listUnitsOfMeasurement(tx: DbLike): string[] {
  const used = tx
    .selectDistinct({ value: items.unitOfMeasurement })
    .from(items)
    .all()
    .map((row) => row.value)
    .filter((value): value is string => Boolean(value));

  return [...new Set<string>([...DEFAULT_UNITS_OF_MEASUREMENT, ...used])];
}

/** §5.11: предметы с остатком на уровне порога или ниже. */
export function listLowStockItems(tx: DbLike): ItemRow[] {
  return tx
    .select()
    .from(items)
    .where(
      and(
        eq(items.status, 'active'),
        sql`CASE WHEN ${items.trackingMethod} = 'liquid'
          THEN ${items.liquidLowStockThresholdCentiml} is not null AND
            (${items.liquidUnopenedVials} * ${items.liquidVolumePerVialCentiml} + ${items.liquidOpenVialCentiml}) <= ${items.liquidLowStockThresholdCentiml}
          ELSE ${items.lowStockThreshold} is not null AND ${items.currentQuantity} <= ${items.lowStockThreshold} END`,
      ),
    )
    .orderBy(items.name)
    .all();
}
