/**
 * Инвентаризация (§5.10; сущности нет в §17 — см. противоречие C-4, Q-17).
 *
 * Черновик хранится на сервере, потому что §5.10 требует, чтобы незавершённая
 * инвентаризация переживала обновление страницы. `expected_quantity` — снимок
 * на момент ввода строки: параллельно идущая операция иначе исказит разницу.
 */
import { and, eq } from 'drizzle-orm';
import type { AppDatabase, DbLike } from '@/db/client';
import {
  inventoryCountLines,
  inventoryCounts,
  items,
  type InventoryCountLineRow,
  type InventoryCountRow,
} from '@/db/schema';
import { assertAdmin, type Actor } from './actor';
import { AUDIT_ACTIONS, writeAudit } from './audit';
import { errors } from './errors';
import { applyMovement, idempotencyKeys, runInTransaction } from './movements';
import { assertNonNegativeQuantity } from './quantity';

export function startInventoryCount(
  db: AppDatabase,
  actor: Actor,
  notes?: string | null,
): InventoryCountRow {
  assertAdmin(actor, 'start inventory count');
  const now = new Date();
  return db
    .insert(inventoryCounts)
    .values({
      status: 'draft',
      notes: notes?.trim() || null,
      createdByAccountId: actor.accountId,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
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
  assertAdmin(actor, 'record inventory count line');
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
  assertAdmin(actor, 'apply inventory count');

  return runInTransaction(db, (tx) => {
    const count = getInventoryCount(tx, countId);
    if (!count) throw errors.countNotFound();
    if (count.status !== 'draft') throw errors.countNotDraft(count.status);

    const lines = listCountLines(tx, countId);
    const corrections: ApplyCountResult['corrections'] = [];
    const now = new Date();

    for (const line of lines) {
      if (line.difference === 0) {
        tx.update(inventoryCountLines)
          .set({ applied: true, updatedAt: now })
          .where(eq(inventoryCountLines.id, line.id))
          .run();
        continue;
      }

      const movement = applyMovement(tx, {
        itemId: line.itemId,
        movementType: 'count_correction',
        quantityDelta: line.difference,
        inventoryCountId: countId,
        idempotencyKey: idempotencyKeys.countCorrection(countId, line.itemId),
        reason: 'inventory correction',
        actorAccountId: actor.accountId,
      });

      tx.update(inventoryCountLines)
        .set({ applied: true, updatedAt: now })
        .where(eq(inventoryCountLines.id, line.id))
        .run();

      corrections.push({
        itemId: line.itemId,
        delta: movement.created ? line.difference : 0,
        quantityAfter: movement.quantityAfter,
      });
    }

    const applied = tx
      .update(inventoryCounts)
      .set({ status: 'applied', appliedAt: now, updatedAt: now })
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
  assertAdmin(actor, 'cancel inventory count');
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
