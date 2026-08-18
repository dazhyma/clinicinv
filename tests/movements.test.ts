/**
 * Движения остатков: инвариант current_quantity == SUM(quantity_delta)
 * и идемпотентность (§10.4, §16; AC-7).
 */
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { inventoryMovements, items } from '@/db/schema';
import { adjustStock, createItem, getItem, receiveStock, updateItem } from '@/domain/items';
import {
  applyMovement,
  findStockInvariantMismatches,
  idempotencyKeys,
  listMovementsForItem,
  runInTransaction,
  sumMovements,
} from '@/domain/movements';
import { addItemToOperation, finishOperation, startOperation, voidOperation } from '@/domain/operations';
import { FIXTURES, makeItem, nextClientEventId, setupTestDb } from './helpers';

describe('Initial Quantity проходит через журнал движений (C-13)', () => {
  it('создаёт движение initial, а не пишет остаток напрямую', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    const movements = listMovementsForItem(ctx.db, item.id);
    expect(movements).toHaveLength(1);
    expect(movements[0]!.movementType).toBe('initial');
    expect(movements[0]!.quantityDelta).toBe(10);
    expect(item.currentQuantity).toBe(10);
    expect(sumMovements(ctx.db, item.id)).toBe(10);
  });

  it('при Initial Quantity = 0 движение не создаётся, инвариант держится', () => {
    const ctx = setupTestDb();
    const item = createItem(ctx.db, ctx.admin, {
      name: 'Empty item',
      currentUnitCostCents: 100,
      unitOfMeasurement: 'each',
      initialQuantity: 0,
    });

    expect(listMovementsForItem(ctx.db, item.id)).toHaveLength(0);
    expect(item.currentQuantity).toBe(0);
    expect(findStockInvariantMismatches(ctx.db)).toEqual([]);
  });
});

describe('Инвариант current_quantity == SUM(quantity_delta)', () => {
  it('держится после серии разнотипных движений', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze); // initial +10

    // received +20
    receiveStock(ctx.db, ctx.admin, {
      itemId: item.id,
      quantity: 20,
      clientEventId: nextClientEventId('recv'),
    });

    // used_in_operation -3 и returned_from_operation +1 через операцию
    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    addItemToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      itemId: item.id,
      quantity: 3,
      clientEventId: nextClientEventId('scan'),
    });

    // manual_adjustment -2
    adjustStock(ctx.db, ctx.admin, {
      itemId: item.id,
      change: { type: 'delta', delta: -2 },
      reason: 'damaged',
      clientEventId: nextClientEventId('adj'),
    });

    // count_correction +4 через прямое движение
    runInTransaction(ctx.db, (tx) =>
      applyMovement(tx, {
        itemId: item.id,
        movementType: 'manual_adjustment',
        quantityDelta: 4,
        reason: 'received outside normal process',
        idempotencyKey: 'manual-extra-1',
      }),
    );

    // void_reversal +3
    finishOperation(ctx.db, ctx.staff, operation.id);
    voidOperation(ctx.db, ctx.admin, operation.id, 'test');

    const finalItem = getItem(ctx.db, item.id)!;
    // 10 + 20 - 3 - 2 + 4 + 3 = 32
    expect(finalItem.currentQuantity).toBe(32);
    expect(sumMovements(ctx.db, item.id)).toBe(32);
    expect(findStockInvariantMismatches(ctx.db)).toEqual([]);
  });
});

describe('Идемпотентность (§10.4, §16, AC-7.1)', () => {
  it('первое применение ключа списывает ровно один раз', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);
    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });

    const first = runInTransaction(ctx.db, (tx) =>
      applyMovement(tx, {
        itemId: item.id,
        movementType: 'used_in_operation',
        quantityDelta: -1,
        operationId: operation.id,
        idempotencyKey: 'same-key',
      }),
    );
    expect(first.created).toBe(true);
    expect(first.quantityAfter).toBe(9);
    expect(findStockInvariantMismatches(ctx.db)).toEqual([]);
  });

  it('второй вызов с тем же ключом возвращает результат первого как успех', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);
    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });

    const apply = () =>
      runInTransaction(ctx.db, (tx) =>
        applyMovement(tx, {
          itemId: item.id,
          movementType: 'used_in_operation',
          quantityDelta: -2,
          operationId: operation.id,
          idempotencyKey: 'op:scan:duplicate',
        }),
      );

    const first = apply();
    const second = apply();

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    // Повтор — не ошибка, а тот же результат.
    expect(second.movement.id).toBe(first.movement.id);
    expect(second.quantityAfter).toBe(8);
    expect(getItem(ctx.db, item.id)!.currentQuantity).toBe(8);
    expect(
      ctx.db.select().from(inventoryMovements).where(eq(inventoryMovements.itemId, item.id)).all(),
    ).toHaveLength(2); // initial + одно списание
  });

  it('разные ключи создают разные движения', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    for (const key of ['k1', 'k2']) {
      runInTransaction(ctx.db, (tx) =>
        applyMovement(tx, {
          itemId: item.id,
          movementType: 'manual_adjustment',
          quantityDelta: -1,
          reason: 'missing',
          idempotencyKey: key,
        }),
      );
    }

    expect(getItem(ctx.db, item.id)!.currentQuantity).toBe(8);
  });

  it('повторный Receive Stock с тем же clientEventId не задваивает поставку', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);
    const clientEventId = 'receive-retry';

    const first = receiveStock(ctx.db, ctx.admin, { itemId: item.id, quantity: 20, clientEventId });
    const retry = receiveStock(ctx.db, ctx.admin, { itemId: item.id, quantity: 20, clientEventId });

    expect(first.applied).toBe(true);
    expect(retry.applied).toBe(false);
    expect(retry.quantityAfter).toBe(30);
    expect(getItem(ctx.db, item.id)!.currentQuantity).toBe(30);
  });
});

describe('Ключи идемпотентности', () => {
  it('ключ Void детерминирован и не содержит случайной части', () => {
    expect(idempotencyKeys.voidReversal(7, 42)).toBe('void:7:item:42');
    expect(idempotencyKeys.voidReversal(7, 42)).toBe(idempotencyKeys.voidReversal(7, 42));
  });
});

describe('Ручная корректировка (§5.9, Q-21)', () => {
  it('ввод нового абсолютного количества записывается в журнал как дельта', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze); // 10

    adjustStock(ctx.db, ctx.admin, {
      itemId: item.id,
      change: { type: 'set', quantity: 7 },
      reason: 'inventory correction',
      clientEventId: nextClientEventId('adj'),
    });

    const movements = listMovementsForItem(ctx.db, item.id);
    const adjustment = movements.find((m) => m.movementType === 'manual_adjustment')!;
    expect(adjustment.quantityDelta).toBe(-3);
    expect(getItem(ctx.db, item.id)!.currentQuantity).toBe(7);
    expect(sumMovements(ctx.db, item.id)).toBe(7);
  });

  it('требует причину', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    expect(() =>
      adjustStock(ctx.db, ctx.admin, {
        itemId: item.id,
        change: { type: 'delta', delta: -1 },
        reason: '   ',
        clientEventId: nextClientEventId('adj'),
      }),
    ).toThrow(/reason is required/i);
  });
});

describe('Остаток не меняется мимо журнала (§10.4)', () => {
  it('updateItem отклоняет попытку изменить current_quantity', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    // Попытка протащить остаток через обычную форму редактирования.
    expect(() =>
      updateItem(ctx.db, ctx.admin, item.id, { currentQuantity: 999 } as never),
    ).toThrow(/cannot be changed/i);

    expect(ctx.db.select().from(items).where(eq(items.id, item.id)).get()!.currentQuantity).toBe(10);
    expect(findStockInvariantMismatches(ctx.db)).toEqual([]);
  });

  it('updateItem отклоняет попытку изменить internal_code и barcode_value (§18.7)', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    expect(() =>
      updateItem(ctx.db, ctx.admin, item.id, { internalCode: 'ITM-999999' } as never),
    ).toThrow(/cannot be changed/i);
    expect(() =>
      updateItem(ctx.db, ctx.admin, item.id, { barcodeValue: 'ITM-999999' } as never),
    ).toThrow(/cannot be changed/i);

    const unchanged = getItem(ctx.db, item.id)!;
    expect(unchanged.internalCode).toBe(item.internalCode);
    expect(unchanged.barcodeValue).toBe(item.barcodeValue);
  });
});
