/**
 * Инвентаризация (§5.10; сущности нет в §17 — см. противоречие C-4, Q-17).
 *
 * Черновик хранится на сервере, потому что §5.10 требует, чтобы незавершённая
 * инвентаризация переживала обновление страницы. `expected_quantity` — снимок
 * на момент ввода строки: параллельно идущая операция иначе исказит разницу.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { AppDatabase, DbLike } from '@/db/client';
import {
  inventoryCountLines,
  inventoryCounts,
  inventoryMovements,
  liquidInventoryMovements,
  items,
  type InventoryCountLineRow,
  type InventoryCountRow,
} from '@/db/schema';
import { assertAdmin, assertInventoryWorker, type Actor } from './actor';
import { AUDIT_ACTIONS, writeAudit } from './audit';
import { errors } from './errors';
import { applyMovement, idempotencyKeys, runInTransaction } from './movements';
import { applyLiquidMovement } from './liquid-movements';
import { liquidTotalCentiml } from './liquid';
import { assertNonNegativeQuantity } from './quantity';

export function startInventoryCount(
  db: AppDatabase,
  actor: Actor,
  notes?: string | null,
): InventoryCountRow {
  assertInventoryWorker(actor, 'start inventory count');
  return runInTransaction(db, (tx) => {
    const now = new Date();
    const created = tx
      .insert(inventoryCounts)
      .values({
        status: 'draft',
        notes: notes?.trim() || null,
        createdByAccountId: actor.accountId,
        createdByRole: actor.role,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    return tx
      .update(inventoryCounts)
      .set({ internalCode: `INV-${String(created.id).padStart(6, '0')}` })
      .where(eq(inventoryCounts.id, created.id))
      .returning()
      .get();
  });
}

export function getInventoryCount(tx: DbLike, countId: number): InventoryCountRow | undefined {
  return tx.select().from(inventoryCounts).where(eq(inventoryCounts.id, countId)).get();
}

export function listCountLines(tx: DbLike, countId: number): InventoryCountLineRow[] {
  return tx
    .select()
    .from(inventoryCountLines)
    .where(eq(inventoryCountLines.countId, countId))
    .orderBy(inventoryCountLines.id)
    .all();
}

export interface CompletedInventoryCountSummary {
  count: InventoryCountRow;
  countedItems: number;
  differenceCount: number;
}

export function listCompletedInventoryCounts(tx: DbLike): CompletedInventoryCountSummary[] {
  return tx
    .select({
      count: inventoryCounts,
      countedItems: sql<number>`count(${inventoryCountLines.id})`,
      differenceCount: sql<number>`coalesce(sum(case when ${inventoryCountLines.difference} <> 0 then 1 else 0 end), 0)`,
    })
    .from(inventoryCounts)
    .leftJoin(inventoryCountLines, eq(inventoryCountLines.countId, inventoryCounts.id))
    .where(and(eq(inventoryCounts.status, 'applied'), isNull(inventoryCounts.deletedAt)))
    .groupBy(inventoryCounts.id)
    .orderBy(desc(inventoryCounts.appliedAt), desc(inventoryCounts.id))
    .all();
}

export function getCompletedInventoryCount(
  tx: DbLike,
  countId: number,
): { count: InventoryCountRow; lines: InventoryCountLineRow[] } | undefined {
  const count = getInventoryCount(tx, countId);
  if (!count || count.status !== 'applied' || count.deletedAt) return undefined;
  return { count, lines: listCountLines(tx, count.id) };
}

/** Последний незакрытый черновик — то, что предлагается продолжить после refresh. */
export function findDraftInventoryCount(tx: DbLike): InventoryCountRow | undefined {
  return tx
    .select()
    .from(inventoryCounts)
    .where(eq(inventoryCounts.status, 'draft'))
    .orderBy(inventoryCounts.id)
    .all()
    .at(-1);
}

export interface UpsertCountLineInput {
  countId: number;
  itemId: number;
  countedQuantity: number;
  countedUnopenedVials?: number;
  countedOpenVialCentiml?: number;
}

/**
 * §5.10 шаги 2–5: сканируем предмет, вводим фактическое количество, система
 * показывает ожидаемое и разницу. Остаток здесь ещё НЕ меняется.
 */
export function upsertCountLine(
  db: AppDatabase,
  actor: Actor,
  input: UpsertCountLineInput,
): InventoryCountLineRow {
  assertInventoryWorker(actor, 'record inventory count line');
  assertNonNegativeQuantity(input.countedQuantity, 'Counted quantity');

  return runInTransaction(db, (tx) => {
    const count = getInventoryCount(tx, input.countId);
    if (!count) throw errors.countNotFound();
    if (count.status !== 'draft') throw errors.countNotDraft(count.status);

    const item = tx.select().from(items).where(eq(items.id, input.itemId)).get();
    if (!item) throw errors.itemNotFound(input.itemId);
    if (item.status !== 'active' || item.archivedAt) throw errors.itemInactive(item.name);

    const now = new Date();
    const liquid = item.trackingMethod === 'liquid';
    const countedUnopened = input.countedUnopenedVials ?? 0;
    const countedOpen = input.countedOpenVialCentiml ?? 0;
    if (liquid) {
      assertNonNegativeQuantity(countedUnopened, 'Counted unopened vials');
      assertNonNegativeQuantity(countedOpen, 'Counted open vial amount');
      if (!item.liquidVolumePerVialCentiml || countedOpen > item.liquidVolumePerVialCentiml) {
        throw errors.validationFailed('Open vial amount cannot exceed the volume per vial');
      }
    }
    const expected = liquid
      ? liquidTotalCentiml(item.liquidUnopenedVials, item.liquidOpenVialCentiml, item.liquidVolumePerVialCentiml!)
      : item.currentQuantity;
    const counted = liquid
      ? liquidTotalCentiml(countedUnopened, countedOpen, item.liquidVolumePerVialCentiml!)
      : input.countedQuantity;
    const difference = counted - expected;

    const existing = tx
      .select()
      .from(inventoryCountLines)
      .where(
        and(
          eq(inventoryCountLines.countId, input.countId),
          eq(inventoryCountLines.itemId, input.itemId),
        ),
      )
      .get();

    if (existing) {
      return tx
        .update(inventoryCountLines)
        .set({
          expectedQuantity: expected,
          countedQuantity: counted,
          difference,
          trackingMethodSnapshot: item.trackingMethod,
          expectedUnopenedVials: liquid ? item.liquidUnopenedVials : null,
          countedUnopenedVials: liquid ? countedUnopened : null,
          expectedOpenVialCentiml: liquid ? item.liquidOpenVialCentiml : null,
          countedOpenVialCentiml: liquid ? countedOpen : null,
          itemNameSnapshot: item.name,
          internalCodeSnapshot: item.internalCode,
          referenceNumberSnapshot: item.referenceNumber,
          unitOfMeasurementSnapshot: item.unitOfMeasurement,
          updatedByAccountId: actor.accountId,
          updatedByRole: actor.role,
          updatedAt: now,
        })
        .where(eq(inventoryCountLines.id, existing.id))
        .returning()
        .get();
    }

    tx.update(inventoryCounts)
      .set({ updatedAt: now })
      .where(eq(inventoryCounts.id, input.countId))
      .run();

    return tx
      .insert(inventoryCountLines)
      .values({
        countId: input.countId,
        itemId: input.itemId,
        expectedQuantity: expected,
        countedQuantity: counted,
        difference,
        trackingMethodSnapshot: item.trackingMethod,
        expectedUnopenedVials: liquid ? item.liquidUnopenedVials : null,
        countedUnopenedVials: liquid ? countedUnopened : null,
        expectedOpenVialCentiml: liquid ? item.liquidOpenVialCentiml : null,
        countedOpenVialCentiml: liquid ? countedOpen : null,
        applied: false,
        itemNameSnapshot: item.name,
        internalCodeSnapshot: item.internalCode,
        referenceNumberSnapshot: item.referenceNumber,
        unitOfMeasurementSnapshot: item.unitOfMeasurement,
        updatedByAccountId: actor.accountId,
        updatedByRole: actor.role,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  });
}

export interface ApplyCountResult {
  count: InventoryCountRow;
  corrections: { itemId: number; delta: number; quantityAfter: number }[];
}

/**
 * §5.10 шаг 6: после подтверждения остаток корректируется.
 *
 * Каждая строка с ненулевой разницей порождает движение `count_correction`
 * с детерминированным ключом `count:{countId}:item:{itemId}` — повторное
 * применение той же инвентаризации не скорректирует остаток дважды.
 * Вся инвентаризация применяется одной транзакцией.
 */
export function applyInventoryCount(
  db: AppDatabase,
  actor: Actor,
  countId: number,
): ApplyCountResult {
  assertInventoryWorker(actor, 'apply inventory count');

  return runInTransaction(db, (tx) => {
    const count = getInventoryCount(tx, countId);
    if (!count) throw errors.countNotFound();
    if (count.status !== 'draft') throw errors.countNotDraft(count.status);

    const lines = listCountLines(tx, countId);
    const corrections: ApplyCountResult['corrections'] = [];
    const now = new Date();

    for (const line of lines) {
      const currentItem = tx.select().from(items).where(eq(items.id, line.itemId)).get();
      if (!currentItem) throw errors.itemNotFound(line.itemId);
      // Между подсчётом строки и Finish могли пройти операции или поставки.
      // Коррекция приводит актуальный остаток ТОЧНО к введённому Actual.
      if (line.trackingMethodSnapshot === 'liquid') {
        const next = { unopenedVials: line.countedUnopenedVials ?? 0, openVialCentiml: line.countedOpenVialCentiml ?? 0 };
        const currentTotal = liquidTotalCentiml(currentItem.liquidUnopenedVials, currentItem.liquidOpenVialCentiml, currentItem.liquidVolumePerVialCentiml!);
        const nextTotal = liquidTotalCentiml(next.unopenedVials, next.openVialCentiml, currentItem.liquidVolumePerVialCentiml!);
        const movement = applyLiquidMovement(tx, { itemId: line.itemId, movementType: 'count_correction', next,
          inventoryCountId: countId, idempotencyKey: `count:${countId}:liquid:${line.itemId}`,
          reason: 'inventory correction', actorAccountId: actor.accountId });
        tx.update(inventoryCountLines).set({ applied: true, finalQuantity: nextTotal,
          finalUnopenedVials: movement.unopenedVials, finalOpenVialCentiml: movement.openVialCentiml,
          updatedAt: now }).where(eq(inventoryCountLines.id, line.id)).run();
        if (nextTotal !== currentTotal) corrections.push({ itemId: line.itemId,
          delta: movement.created ? nextTotal - currentTotal : 0, quantityAfter: nextTotal });
        continue;
      }
      const currentDifference = line.countedQuantity - currentItem.currentQuantity;

      if (currentDifference === 0) {
        tx.update(inventoryCountLines)
          .set({ applied: true, finalQuantity: line.countedQuantity, updatedAt: now })
          .where(eq(inventoryCountLines.id, line.id))
          .run();
        continue;
      }

      const movement = applyMovement(tx, {
        itemId: line.itemId,
        movementType: 'count_correction',
        quantityDelta: currentDifference,
        inventoryCountId: countId,
        idempotencyKey: idempotencyKeys.countCorrection(countId, line.itemId),
        reason: 'inventory correction',
        actorAccountId: actor.accountId,
      });

      tx.update(inventoryCountLines)
        .set({ applied: true, finalQuantity: movement.quantityAfter, updatedAt: now })
        .where(eq(inventoryCountLines.id, line.id))
        .run();

      corrections.push({
        itemId: line.itemId,
        delta: movement.created ? currentDifference : 0,
        quantityAfter: movement.quantityAfter,
      });
    }

    const applied = tx
      .update(inventoryCounts)
      .set({
        status: 'applied',
        appliedAt: now,
        completedByAccountId: actor.accountId,
        completedByRole: actor.role,
        updatedAt: now,
      })
      .where(eq(inventoryCounts.id, countId))
      .returning()
      .get();

    writeAudit(tx, {
      action: AUDIT_ACTIONS.countApplied,
      actorAccountId: actor.accountId,
      actorRole: actor.role,
      entityType: 'inventory_count',
      entityId: countId,
      summary: `${corrections.length} correction(s) applied`,
    });

    return { count: applied, corrections };
  });
}

export function cancelInventoryCount(
  db: AppDatabase,
  actor: Actor,
  countId: number,
): InventoryCountRow {
  assertInventoryWorker(actor, 'cancel inventory count');
  return runInTransaction(db, (tx) => {
    const count = getInventoryCount(tx, countId);
    if (!count) throw errors.countNotFound();
    if (count.status !== 'draft') throw errors.countNotDraft(count.status);
    const now = new Date();
    return tx
      .update(inventoryCounts)
      .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
      .where(eq(inventoryCounts.id, countId))
      .returning()
      .get();
  });
}

export interface DeletedInventoryCountResult {
  count: InventoryCountRow;
  reversedMovements: number;
}

/**
 * Удаление завершённого Count не переписывает старые остатки: каждое созданное
 * им движение получает точное обратное движение. Маркер deleted_at и возвраты
 * записываются одной BEGIN IMMEDIATE транзакцией, поэтому повторный запрос не
 * способен применить возврат второй раз.
 */
export function deleteCompletedInventoryCount(
  db: AppDatabase,
  actor: Actor,
  countId: number,
): DeletedInventoryCountResult {
  assertAdmin(actor, 'delete inventory count');

  return runInTransaction(db, (tx) => {
    const count = getInventoryCount(tx, countId);
    if (!count || count.status !== 'applied') throw errors.countNotFound();
    if (count.deletedAt) {
      throw errors.validationFailed(
        `${count.internalCode ?? 'Inventory count'} has already been deleted`,
      );
    }

    const originals = tx
      .select()
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.inventoryCountId, countId),
          eq(inventoryMovements.movementType, 'count_correction'),
          eq(inventoryMovements.reason, 'inventory correction'),
        ),
      )
      .orderBy(inventoryMovements.id)
      .all();

    for (const movement of originals) {
      applyMovement(tx, {
        itemId: movement.itemId,
        movementType: 'count_correction',
        quantityDelta: -movement.quantityDelta,
        inventoryCountId: countId,
        idempotencyKey: idempotencyKeys.countDeletionReversal(countId, movement.id),
        reason: 'inventory count deleted',
        actorAccountId: actor.accountId,
      });
    }
    const liquidOriginals = tx.select().from(liquidInventoryMovements).where(and(
      eq(liquidInventoryMovements.inventoryCountId, countId),
      eq(liquidInventoryMovements.movementType, 'count_correction'),
      eq(liquidInventoryMovements.reason, 'inventory correction'),
    )).orderBy(liquidInventoryMovements.id).all();
    for (const movement of liquidOriginals) {
      const item = tx.select().from(items).where(eq(items.id, movement.itemId)).get();
      if (!item?.liquidVolumePerVialCentiml) throw errors.itemNotFound(movement.itemId);
      const currentTotal = liquidTotalCentiml(item.liquidUnopenedVials, item.liquidOpenVialCentiml, item.liquidVolumePerVialCentiml);
      const desired = currentTotal - movement.totalVolumeCentimlDelta;
      if (desired < 0) throw errors.validationFailed('Liquid inventory count reversal would make stock negative');
      applyLiquidMovement(tx, { itemId: item.id, movementType: 'count_correction',
        next: { unopenedVials: Math.floor(desired / item.liquidVolumePerVialCentiml),
          openVialCentiml: desired % item.liquidVolumePerVialCentiml },
        inventoryCountId: countId, idempotencyKey: `count-delete:${countId}:liquid:${movement.id}`,
        reason: 'inventory count deleted', actorAccountId: actor.accountId });
    }

    const now = new Date();
    const deleted = tx
      .update(inventoryCounts)
      .set({
        deletedAt: now,
        deletedByAccountId: actor.accountId,
        updatedAt: now,
      })
      .where(and(eq(inventoryCounts.id, countId), isNull(inventoryCounts.deletedAt)))
      .returning()
      .get();
    if (!deleted) throw errors.validationFailed('Inventory count could not be deleted');

    writeAudit(tx, {
      action: AUDIT_ACTIONS.countDeleted,
      actorAccountId: actor.accountId,
      actorRole: actor.role,
      entityType: 'inventory_count',
      entityId: countId,
      summary: `${count.internalCode ?? countId}: ${originals.length} correction(s) reversed`,
    });

    return { count: deleted, reversedMovements: originals.length + liquidOriginals.length };
  });
}
