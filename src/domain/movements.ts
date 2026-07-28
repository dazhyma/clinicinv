/**
 * Движения остатков — ядро учёта (§10.4, §16, §17.6).
 *
 * ЕДИНСТВЕННЫЙ способ изменить `items.current_quantity` — вызвать applyMovement().
 * Прямой UPDATE остатка мимо журнала запрещён: именно журнал не даёт неправильно
 * пересчитать склад при изменениях, сделанных после операции (§10.4), и делает
 * возможным Void «ровно на списанное» (§10.3).
 *
 * Идемпотентность: ключ приходит ОТ КЛИЕНТА и проверяется уникальным индексом
 * БД `ux_inventory_movements_idempotency`. Проверка «а нет ли уже такого ключа?»
 * в памяти приложения не решает задачу — два параллельных запроса (двойное
 * срабатывание сканера, ретрай после таймаута) пройдут её оба.
 * Повторная отправка возвращает результат первой операции как успех, а не ошибку.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AppDatabase, DbLike, Tx } from '@/db/client';
import {
  inventoryMovements,
  items,
  type InventoryMovementRow,
  type MovementType,
} from '@/db/schema';
import { errors } from './errors';
import { assertNonZeroDelta } from './quantity';

/**
 * Все изменения остатка идут в транзакции BEGIN IMMEDIATE (§16).
 * `immediate` берёт писательскую блокировку сразу, а не при первой записи:
 * иначе два параллельных сканирования могли бы прочитать один и тот же остаток
 * и разойтись при апгрейде блокировки (SQLITE_BUSY посреди операции).
 */
export function runInTransaction<T>(db: AppDatabase, fn: (tx: Tx) => T): T {
  return db.transaction(fn, { behavior: 'immediate' });
}

/**
 * Схемы ключей идемпотентности (docs/data-model.md §6).
 * `voidReversal` — детерминированный, БЕЗ случайной части: это и есть машинная
 * гарантия того, что повторный Void не вернёт остатки второй раз (§18.21).
 */
export const idempotencyKeys = {
  initialStock: (itemId: number) => `init:${itemId}`,
  receiveStock: (clientEventId: string) => `receive:${clientEventId}`,
  manualAdjustment: (clientEventId: string) => `adjust:${clientEventId}`,
  countCorrection: (countId: number, itemId: number) => `count:${countId}:item:${itemId}`,
  operationScan: (operationId: number, clientEventId: string) =>
    `op:${operationId}:scan:${clientEventId}`,
  operationPackItem: (operationId: number, clientEventId: string, itemId: number) =>
    `op:${operationId}:pack:${clientEventId}:item:${itemId}`,
  operationLineChange: (operationId: number, lineId: number, clientEventId: string) =>
    `op:${operationId}:line:${lineId}:rev:${clientEventId}`,
  operationUndo: (operationId: number, eventId: number, itemId: number) =>
    `op:${operationId}:undo:${eventId}:item:${itemId}`,
  voidReversal: (operationId: number, itemId: number) => `void:${operationId}:item:${itemId}`,
} as const;

export interface ApplyMovementInput {
  itemId: number;
  movementType: MovementType;
  /** Знак задаёт направление. Ноль запрещён (инвариант I-3). */
  quantityDelta: number;
  /** Ключ идемпотентности. Обязателен всегда. */
  idempotencyKey: string;
  operationId?: number | null;
  inventoryCountId?: number | null;
  reason?: string | null;
  /** Q-9: цена конкретной поставки; задним числом её не восстановить. */
  unitCostAtReceiptCents?: number | null;
  actorAccountId?: number | null;
}

export interface ApplyMovementResult {
  movement: InventoryMovementRow;
  /** false — движение с таким ключом уже было; остаток НЕ изменён повторно. */
  created: boolean;
  quantityAfter: number;
}

/**
 * Записывает движение и синхронно сдвигает остаток предмета.
 * Вызывать только внутри транзакции: запись движения и обновление остатка
 * обязаны быть атомарны (инвариант I-2).
 */
export function applyMovement(tx: DbLike, input: ApplyMovementInput): ApplyMovementResult {
  assertNonZeroDelta(input.quantityDelta);

  const key = input.idempotencyKey?.trim();
  if (!key) {
    throw errors.validationFailed('An idempotency key is required for every stock movement');
  }

  const inserted = tx
    .insert(inventoryMovements)
    .values({
      itemId: input.itemId,
      movementType: input.movementType,
      quantityDelta: input.quantityDelta,
      operationId: input.operationId ?? null,
      inventoryCountId: input.inventoryCountId ?? null,
      reason: input.reason ?? null,
      unitCostAtReceiptCents: input.unitCostAtReceiptCents ?? null,
      idempotencyKey: key,
      createdByAccountId: input.actorAccountId ?? null,
      createdAt: new Date(),
    })
    .onConflictDoNothing({ target: inventoryMovements.idempotencyKey })
    .returning()
    .get();

  if (!inserted) {
    // Повтор того же события. Остаток не трогаем и возвращаем результат первого
    // применения — пользователь должен увидеть успех, а не ошибку (§16, AC-7.1).
    const existing = tx
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.idempotencyKey, key))
      .get();
    if (!existing) throw errors.validationFailed('Stock movement could not be recorded');

    const current = tx
      .select({ quantity: items.currentQuantity })
      .from(items)
      .where(eq(items.id, existing.itemId))
      .get();

    return { movement: existing, created: false, quantityAfter: current?.quantity ?? 0 };
  }

  const updated = tx
    .update(items)
    .set({
      currentQuantity: sql`${items.currentQuantity} + ${input.quantityDelta}`,
      updatedAt: new Date(),
    })
    .where(eq(items.id, input.itemId))
    .returning({ quantity: items.currentQuantity })
    .get();

  if (!updated) throw errors.itemNotFound(input.itemId);

  return { movement: inserted, created: true, quantityAfter: updated.quantity };
}

/** Сумма всех движений предмета — левая часть инварианта I-1. */
export function sumMovements(tx: DbLike, itemId: number): number {
  const row = tx
    .select({ total: sql<number>`coalesce(sum(${inventoryMovements.quantityDelta}), 0)` })
    .from(inventoryMovements)
    .where(eq(inventoryMovements.itemId, itemId))
    .get();
  return row?.total ?? 0;
}

export interface InvariantMismatch {
  itemId: number;
  internalCode: string;
  currentQuantity: number;
  sumOfMovements: number;
}

/**
 * Сверка инварианта I-1 по всем предметам: current_quantity == SUM(quantity_delta).
 * Расхождение — критический дефект учёта (AC-7.4).
 */
export function findStockInvariantMismatches(tx: DbLike): InvariantMismatch[] {
  // Две простые выборки вместо коррелированного подзапроса. Причина конкретная:
  // в подзапросе ссылка на items.id рендерится Drizzle как неквалифицированное
  // "id" и связывается с id таблицы движений, давая тихо неверный результат.
  // Сверка инварианта — не то место, где допустима хрупкая генерация SQL.
  const sums = new Map(
    tx
      .select({
        itemId: inventoryMovements.itemId,
        total: sql<number>`coalesce(sum(${inventoryMovements.quantityDelta}), 0)`,
      })
      .from(inventoryMovements)
      .groupBy(inventoryMovements.itemId)
      .all()
      .map((row) => [row.itemId, row.total] as const),
  );

  return tx
    .select({
      itemId: items.id,
      internalCode: items.internalCode,
      currentQuantity: items.currentQuantity,
    })
    .from(items)
    .all()
    .map((row) => ({ ...row, sumOfMovements: sums.get(row.itemId) ?? 0 }))
    .filter((row) => row.currentQuantity !== row.sumOfMovements);
}

/**
 * Чистое списание операции по каждому предмету (§10.3, docs/state-machines.md §2.4):
 *
 *   чистое_списание = |SUM(used_in_operation)| − SUM(returned_from_operation)
 *
 * Возвращается ровно эта величина, а не «остаток до операции» и не сумма всех
 * used: поставки и промежуточные возвраты обязаны остаться учтёнными.
 */
export function netDeductionsByOperation(
  tx: DbLike,
  operationId: number,
): { itemId: number; netDeducted: number }[] {
  const rows = tx
    .select({
      itemId: inventoryMovements.itemId,
      net: sql<number>`coalesce(sum(${inventoryMovements.quantityDelta}), 0)`,
    })
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.operationId, operationId),
        inArray(inventoryMovements.movementType, ['used_in_operation', 'returned_from_operation']),
      ),
    )
    .groupBy(inventoryMovements.itemId)
    .all();

  // `net` отрицателен ровно на столько, сколько операция реально забрала.
  return rows
    .map((row) => ({ itemId: row.itemId, netDeducted: -row.net }))
    .filter((row) => row.netDeducted > 0);
}

export function listMovementsForOperation(
  tx: DbLike,
  operationId: number,
): InventoryMovementRow[] {
  return tx
    .select()
    .from(inventoryMovements)
    .where(eq(inventoryMovements.operationId, operationId))
    .all();
}

export function listMovementsForItem(tx: DbLike, itemId: number): InventoryMovementRow[] {
  return tx
    .select()
    .from(inventoryMovements)
    .where(eq(inventoryMovements.itemId, itemId))
    .orderBy(inventoryMovements.id)
    .all();
}
