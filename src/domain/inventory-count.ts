/**
 * Инвентаризация (§5.10; сущности нет в §17 — см. противоречие C-4, Q-17).
 *
 * Черновик хранится на сервере, потому что §5.10 требует, чтобы незавершённая
 * инвентаризация переживала обновление страницы. `expected_quantity` — снимок
 * на момент ввода строки: параллельно идущая операция иначе исказит разницу.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { AppDatabase, DbLike } from '@/db/client';
import {
  inventoryCountLines,
  inventoryCounts,
  items,
  type InventoryCountLineRow,
  type InventoryCountRow,
} from '@/db/schema';
import { assertInventoryWorker, type Actor } from './actor';
import { AUDIT_ACTIONS, writeAudit } from './audit';
import { errors } from './errors';
import { applyMovement, idempotencyKeys, runInTransaction } from './movements';
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
    .where(eq(inventoryCounts.status, 'applied'))
    .groupBy(inventoryCounts.id)
    .orderBy(desc(inventoryCounts.appliedAt), desc(inventoryCounts.id))
    .all();
}

export function getCompletedInventoryCount(
  tx: DbLike,
  countId: number,
): { count: InventoryCountRow; lines: InventoryCountLineRow[] } | undefined {
  const count = getInventoryCount(tx, countId);
  if (!count || count.status !== 'applied') return undefined;
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

    const now = new Date();
    const expected = item.currentQuantity;
    const difference = input.countedQuantity - expected;

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
          countedQuantity: input.countedQuantity,
          difference,
          itemNameSnapshot: item.name,
          internalCodeSnapshot: item.internalCode,
          skuSnapshot: item.sku,
          referenceNumberSnapshot: item.referenceNumber,
          photoUrlSnapshot: item.photoUrl,
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
        countedQuantity: input.countedQuantity,
        difference,
        applied: false,
        itemNameSnapshot: item.name,
        internalCodeSnapshot: item.internalCode,
        skuSnapshot: item.sku,
        referenceNumberSnapshot: item.referenceNumber,
        photoUrlSnapshot: item.photoUrl,
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
