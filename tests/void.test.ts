/**
 * AC-5 / §10.3 / §18.19–§18.21 — аннулирование операции.
 * Канонический пример: 10 → 8 → 28 → 30.
 */
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { inventoryMovements } from '@/db/schema';
import { getItem, receiveStock } from '@/domain/items';
import { findStockInvariantMismatches, listMovementsForOperation } from '@/domain/movements';
import {
  addItemToOperation,
  finishOperation,
  listActiveOperations,
  listOperationLines,
  setLineQuantity,
  startOperation,
  totalCostForFinishedOperations,
  voidOperation,
} from '@/domain/operations';
import { FIXTURES, makeItem, nextClientEventId, setupTestDb } from './helpers';

describe('AC-5.1: возврат ровно списанного количества (10 → 8 → 28 → 30)', () => {
  it('поставка между операцией и аннулированием остаётся учтённой', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);
    expect(gauze.currentQuantity).toBe(10);

    // Шаг 1: операция списывает 2 (два скана по одной единице).
    const operation = startOperation(ctx.db, ctx.staff);
    addItemToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      itemId: gauze.id,
      clientEventId: nextClientEventId('scan'),
    });
    addItemToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      itemId: gauze.id,
      clientEventId: nextClientEventId('scan'),
    });
    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(8);

    const lines = listOperationLines(ctx.db, operation.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.quantity).toBe(2);
    expect(lines[0]!.unitCostSnapshotCents).toBe(300);
    expect(lines[0]!.lineTotalCents).toBe(600);

    // Шаг 2: Finish and Lock.
    const finished = finishOperation(ctx.db, ctx.staff, operation.id);
    expect(finished.status).toBe('Finished');
    expect(finished.totalCostSnapshotCents).toBe(600);
    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(8);

    // Шаг 3: поставка +20 → 28.
    receiveStock(ctx.db, ctx.admin, {
      itemId: gauze.id,
      quantity: 20,
      clientEventId: nextClientEventId('recv'),
    });
    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(28);

    // Шаг 6: Void.
    const result = voidOperation(ctx.db, ctx.admin, operation.id, 'entered in error');

    // Обязательные проверки AC-5.1.
    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(30); // 1
    expect(getItem(ctx.db, gauze.id)!.currentQuantity).not.toBe(10); // 2
    expect(getItem(ctx.db, gauze.id)!.currentQuantity).not.toBe(12); // 3
    expect(getItem(ctx.db, gauze.id)!.currentQuantity).not.toBe(32); // 4

    // 5: поставка сохранена.
    const received = ctx.db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.movementType, 'received'))
      .all();
    expect(received).toHaveLength(1);
    expect(received[0]!.quantityDelta).toBe(20);

    // 6: ровно одно движение void_reversal на предмет.
    const reversals = listMovementsForOperation(ctx.db, operation.id).filter(
      (m) => m.movementType === 'void_reversal',
    );
    expect(reversals).toHaveLength(1);
    expect(reversals[0]!.quantityDelta).toBe(2);
    expect(result.returned).toEqual([
      { itemId: gauze.id, quantity: 2, quantityAfter: 30 },
    ]);

    // 7: статус.
    expect(result.operation.status).toBe('Voided');
    expect(result.operation.voidedAt).not.toBeNull();

    // 8: строки операции сохранены.
    const afterVoid = listOperationLines(ctx.db, operation.id);
    expect(afterVoid).toHaveLength(1);
    expect(afterVoid[0]!.quantity).toBe(2);
    expect(afterVoid[0]!.lineTotalCents).toBe(600);

    // 9: операция исключена из финансовых итогов.
    expect(totalCostForFinishedOperations(ctx.db)).toBe(0);

    // 10: нет в блоке активных.
    expect(listActiveOperations(ctx.db)).toHaveLength(0);

    // 11: инвариант.
    expect(findStockInvariantMismatches(ctx.db)).toEqual([]);
  });
});

describe('AC-5.2 / AC-5.3: повторный Void невозможен', () => {
  it('второй Void отклоняется сообщением «Operation was already voided»', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);
    const operation = startOperation(ctx.db, ctx.staff);
    addItemToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      itemId: gauze.id,
      quantity: 2,
      clientEventId: nextClientEventId('scan'),
    });
    finishOperation(ctx.db, ctx.staff, operation.id);
    voidOperation(ctx.db, ctx.admin, operation.id);

    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(10);

    expect(() => voidOperation(ctx.db, ctx.admin, operation.id)).toThrowError(
      'Operation was already voided',
    );

    // Остаток не изменился и новых возвратов не создано.
    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(10);
    const reversals = listMovementsForOperation(ctx.db, operation.id).filter(
      (m) => m.movementType === 'void_reversal',
    );
    expect(reversals).toHaveLength(1);
    expect(findStockInvariantMismatches(ctx.db)).toEqual([]);
  });

  it('детерминированный ключ не даёт применить возврат дважды даже в обход статуса', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);
    const operation = startOperation(ctx.db, ctx.staff);
    addItemToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      itemId: gauze.id,
      quantity: 2,
      clientEventId: nextClientEventId('scan'),
    });
    voidOperation(ctx.db, ctx.admin, operation.id);
    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(10);

    // Прямая вставка движения с тем же ключом отклоняется ограничением БД.
    expect(() =>
      ctx.sqlite
        .prepare(
          `INSERT INTO inventory_movements
             (item_id, movement_type, quantity_delta, operation_id, idempotency_key, created_at)
           VALUES (?, 'void_reversal', 2, ?, ?, ?)`,
        )
        .run(gauze.id, operation.id, `void:${operation.id}:item:${gauze.id}`, Date.now()),
    ).toThrow(/UNIQUE constraint failed/i);

    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(10);
  });
});

describe('AC-5.4: Void с промежуточными возвратами возвращает чистое списание', () => {
  it('списано 5, возвращено 3 → Void возвращает 2', () => {
    const ctx = setupTestDb();
    const gloves = makeItem(ctx, FIXTURES.gloves); // 50

    const operation = startOperation(ctx.db, ctx.staff);
    const added = addItemToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      itemId: gloves.id,
      quantity: 5,
      clientEventId: nextClientEventId('scan'),
    });
    expect(getItem(ctx.db, gloves.id)!.currentQuantity).toBe(45);

    setLineQuantity(ctx.db, ctx.staff, {
      operationId: operation.id,
      operationItemId: added.lines[0]!.id,
      quantity: 2,
      clientEventId: nextClientEventId('qty'),
    });
    expect(getItem(ctx.db, gloves.id)!.currentQuantity).toBe(48);

    finishOperation(ctx.db, ctx.staff, operation.id);
    const result = voidOperation(ctx.db, ctx.admin, operation.id);

    expect(result.returned[0]!.quantity).toBe(2);
    expect(getItem(ctx.db, gloves.id)!.currentQuantity).toBe(50);
    expect(findStockInvariantMismatches(ctx.db)).toEqual([]);
  });
});

describe('AC-5.5: Void активной операции', () => {
  it('возвращает остаток и убирает операцию из активных', () => {
    const ctx = setupTestDb();
    const syringe = makeItem(ctx, FIXTURES.syringe); // 20

    const operation = startOperation(ctx.db, ctx.staff);
    addItemToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      itemId: syringe.id,
      quantity: 3,
      clientEventId: nextClientEventId('scan'),
    });
    expect(getItem(ctx.db, syringe.id)!.currentQuantity).toBe(17);

    const result = voidOperation(ctx.db, ctx.admin, operation.id);
    expect(result.operation.status).toBe('Voided');
    expect(getItem(ctx.db, syringe.id)!.currentQuantity).toBe(20);
    expect(listActiveOperations(ctx.db)).toHaveLength(0);

    // Сканировать в аннулированную операцию нельзя.
    expect(() =>
      addItemToOperation(ctx.db, ctx.staff, {
        operationId: operation.id,
        itemId: syringe.id,
        clientEventId: nextClientEventId('scan'),
      }),
    ).toThrowError('Operation was already voided');
  });
});

describe('AC-5.6: Void недоступен Staff', () => {
  it('сервер отклоняет Void из-под Staff и ничего не меняет', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);
    const operation = startOperation(ctx.db, ctx.staff);
    addItemToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      itemId: gauze.id,
      quantity: 2,
      clientEventId: nextClientEventId('scan'),
    });
    finishOperation(ctx.db, ctx.staff, operation.id);

    expect(() => voidOperation(ctx.db, ctx.staff, operation.id)).toThrow(/permission/i);

    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(8);
    const reversals = listMovementsForOperation(ctx.db, operation.id).filter(
      (m) => m.movementType === 'void_reversal',
    );
    expect(reversals).toHaveLength(0);
  });
});
