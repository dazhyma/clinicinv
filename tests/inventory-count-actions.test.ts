/**
 * §5.10 — инвентаризация через слой действий (`src/actions/inventory-count.ts`).
 *
 * Действия вызываются НАПРЯМУЮ, минуя HTTP и экран: так выглядит и попытка
 * Staff выполнить Admin-действие вручную (§3.2, §18.22, AC-6.2 шаг 11), и
 * повторное чтение состояния после refresh.
 *
 * Главное проверяемое свойство: расхождение исправляется ДВИЖЕНИЕМ
 * `count_correction`, а не записью остатка. Поэтому инвариант
 * `current_quantity == SUM(quantity_delta)` держится и после инвентаризации.
 */
import { describe, expect, it } from 'vitest';
import {
  applyInventoryCountAction,
  cancelInventoryCountAction,
  findDraftCountForActor,
  getCountStateForActor,
  recordCountLineAction,
  scanForCountAction,
  startInventoryCountAction,
  type InventoryCountStateView,
} from '@/actions/inventory-count';
import { findStockInvariantMismatches, listMovementsForItem } from '@/domain/movements';
import { getItem } from '@/domain/items';
import { FIXTURES, makeBasicPack, makeItem, setupTestDb, type TestContext } from './helpers';

function expectSuccess<T>(result: { ok: boolean }): { ok: true; data: T } {
  if (!result.ok) throw new Error(`Expected success, got: ${JSON.stringify(result)}`);
  return result as unknown as { ok: true; data: T };
}

function expectFailure(result: { ok: boolean }) {
  expect(result.ok).toBe(false);
  return result as { ok: false; error: string; code: string };
}

function startCount(ctx: TestContext): InventoryCountStateView {
  return expectSuccess<InventoryCountStateView>(startInventoryCountAction(ctx.db, ctx.admin)).data;
}

function stockOf(ctx: TestContext, itemId: number): number {
  return getItem(ctx.db, itemId)?.currentQuantity ?? -1;
}

// --- §5.10, шаги 1–6 --------------------------------------------------------

describe('§5.10: инвентаризация корректирует остаток движением', () => {
  it('расхождение между ожидаемым и фактическим списывается движением count_correction', () => {
    const ctx = setupTestDb();
    // FR-50, дословный пример: ожидаемое 100, введено 97, разница −3.
    const gauze = makeItem(ctx, { ...FIXTURES.gauze, quantity: 100 });
    expect(stockOf(ctx, gauze.id)).toBe(100);

    const count = startCount(ctx);

    // Шаг 2: скан предмета. Шаг 4: система показывает ожидаемое количество.
    const target = expectSuccess<{ expectedQuantity: number; itemId: number; name: string }>(
      scanForCountAction(ctx.db, ctx.admin, { countId: count.id, barcode: gauze.barcodeValue }),
    ).data;
    expect(target.itemId).toBe(gauze.id);
    expect(target.expectedQuantity).toBe(100);
    // Скан ничего не меняет: остаток трогает только подтверждение (шаг 6).
    expect(stockOf(ctx, gauze.id)).toBe(100);

    // Шаг 3: вводится физически найденное количество. Шаг 5: показана разница.
    const recorded = expectSuccess<{
      state: InventoryCountStateView;
      line: { expectedQuantity: number; countedQuantity: number; difference: number };
      message: string;
    }>(
      recordCountLineAction(ctx.db, ctx.admin, {
        countId: count.id,
        itemId: gauze.id,
        countedQuantity: 97,
      }),
    ).data;

    expect(recorded.line.expectedQuantity).toBe(100);
    expect(recorded.line.countedQuantity).toBe(97);
    expect(recorded.line.difference).toBe(-3);
    expect(recorded.message).toContain('expected 100');
    expect(recorded.message).toContain('difference -3');
    // Остаток по-прежнему прежний: черновик не меняет склад.
    expect(stockOf(ctx, gauze.id)).toBe(100);

    // Шаг 6: подтверждение.
    const applied = expectSuccess<{ correctedItems: number }>(
      applyInventoryCountAction(ctx.db, ctx.admin, count.id),
    ).data;
    expect(applied.correctedItems).toBe(1);
    expect(stockOf(ctx, gauze.id)).toBe(97);

    // Корректировка — именно движение, а не прямая запись остатка (§10.4, D-3).
    const movements = listMovementsForItem(ctx.db, gauze.id);
    const correction = movements.find((movement) => movement.movementType === 'count_correction')!;
    expect(correction).toBeDefined();
    expect(correction.quantityDelta).toBe(-3);
    expect(correction.inventoryCountId).toBe(count.id);
    expect(findStockInvariantMismatches(ctx.db)).toEqual([]);
  });

  it('излишек на полке даёт положительное движение, недостача — отрицательное', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, { ...FIXTURES.gauze, quantity: 10 });
    const gloves = makeItem(ctx, { ...FIXTURES.gloves, quantity: 50 });

    const count = startCount(ctx);
    expectSuccess(
      recordCountLineAction(ctx.db, ctx.admin, {
        countId: count.id,
        itemId: gauze.id,
        countedQuantity: 12,
      }),
    );
    expectSuccess(
      recordCountLineAction(ctx.db, ctx.admin, {
        countId: count.id,
        itemId: gloves.id,
        countedQuantity: 44,
      }),
    );

    expectSuccess(applyInventoryCountAction(ctx.db, ctx.admin, count.id));

    expect(stockOf(ctx, gauze.id)).toBe(12);
    expect(stockOf(ctx, gloves.id)).toBe(44);
    expect(
      listMovementsForItem(ctx.db, gauze.id).find((m) => m.movementType === 'count_correction')!
        .quantityDelta,
    ).toBe(2);
    expect(
      listMovementsForItem(ctx.db, gloves.id).find((m) => m.movementType === 'count_correction')!
        .quantityDelta,
    ).toBe(-6);
    expect(findStockInvariantMismatches(ctx.db)).toEqual([]);
  });

  it('совпадение с ожидаемым не создаёт движения вовсе', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, { ...FIXTURES.gauze, quantity: 10 });

    const count = startCount(ctx);
    expectSuccess(
      recordCountLineAction(ctx.db, ctx.admin, {
        countId: count.id,
        itemId: gauze.id,
        countedQuantity: 10,
      }),
    );
    const applied = expectSuccess<{ correctedItems: number; message: string }>(
      applyInventoryCountAction(ctx.db, ctx.admin, count.id),
    ).data;

    expect(applied.correctedItems).toBe(0);
    expect(applied.message).toContain('matched');
    expect(
      listMovementsForItem(ctx.db, gauze.id).filter((m) => m.movementType === 'count_correction'),
    ).toEqual([]);
    expect(stockOf(ctx, gauze.id)).toBe(10);
  });

  it('повторное подтверждение той же инвентаризации отклоняется и не корректирует дважды', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, { ...FIXTURES.gauze, quantity: 10 });

    const count = startCount(ctx);
    expectSuccess(
      recordCountLineAction(ctx.db, ctx.admin, {
        countId: count.id,
        itemId: gauze.id,
        countedQuantity: 7,
      }),
    );
    expectSuccess(applyInventoryCountAction(ctx.db, ctx.admin, count.id));
    expect(stockOf(ctx, gauze.id)).toBe(7);

    const second = expectFailure(applyInventoryCountAction(ctx.db, ctx.admin, count.id));
    expect(second.code).toBe('COUNT_NOT_DRAFT');
    expect(stockOf(ctx, gauze.id)).toBe(7);
    expect(findStockInvariantMismatches(ctx.db)).toEqual([]);
  });
});

// --- §5.10: черновик переживает refresh -------------------------------------

describe('§5.10: незавершённая инвентаризация хранится на сервере', () => {
  it('перечитывание состояния возвращает те же позиции и значения', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, { ...FIXTURES.gauze, quantity: 10 });
    const gloves = makeItem(ctx, { ...FIXTURES.gloves, quantity: 50 });

    const count = startCount(ctx);
    expectSuccess(
      recordCountLineAction(ctx.db, ctx.admin, {
        countId: count.id,
        itemId: gauze.id,
        countedQuantity: 8,
      }),
    );
    expectSuccess(
      recordCountLineAction(ctx.db, ctx.admin, {
        countId: count.id,
        itemId: gloves.id,
        countedQuantity: 50,
      }),
    );

    // Это и есть refresh: страница ничего не помнит и читает состояние заново.
    const reloaded = findDraftCountForActor(ctx.db, ctx.admin)!;
    expect(reloaded.id).toBe(count.id);
    expect(reloaded.status).toBe('draft');
    expect(reloaded.countedItems).toBe(2);
    expect(reloaded.differenceCount).toBe(1);
    expect(reloaded.lines.map((line) => [line.itemId, line.countedQuantity, line.difference])).toEqual(
      [
        [gauze.id, 8, -2],
        [gloves.id, 50, 0],
      ],
    );
    // Черновик не тронул склад.
    expect(stockOf(ctx, gauze.id)).toBe(10);

    // Повторный «Start New Count» продолжает черновик, а не вытесняет его.
    const again = startCount(ctx);
    expect(again.id).toBe(count.id);
    expect(again.countedItems).toBe(2);
  });

  it('повторный скан предмета показывает уже введённое значение и перезаписывает строку', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, { ...FIXTURES.gauze, quantity: 10 });

    const count = startCount(ctx);
    expectSuccess(
      recordCountLineAction(ctx.db, ctx.admin, {
        countId: count.id,
        itemId: gauze.id,
        countedQuantity: 8,
      }),
    );

    const rescan = expectSuccess<{ countedQuantity: number | null; expectedQuantity: number }>(
      scanForCountAction(ctx.db, ctx.admin, { countId: count.id, barcode: gauze.barcodeValue }),
    ).data;
    expect(rescan.countedQuantity).toBe(8);
    expect(rescan.expectedQuantity).toBe(10);

    expectSuccess(
      recordCountLineAction(ctx.db, ctx.admin, {
        countId: count.id,
        itemId: gauze.id,
        countedQuantity: 9,
      }),
    );

    const state = getCountStateForActor(ctx.db, ctx.admin, count.id)!;
    expect(state.lines).toHaveLength(1);
    expect(state.lines[0]!.countedQuantity).toBe(9);
    expect(state.lines[0]!.difference).toBe(-1);

    expectSuccess(applyInventoryCountAction(ctx.db, ctx.admin, count.id));
    expect(stockOf(ctx, gauze.id)).toBe(9);
    expect(findStockInvariantMismatches(ctx.db)).toEqual([]);
  });

  it('отменённая инвентаризация не меняет остаток и больше не предлагается', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, { ...FIXTURES.gauze, quantity: 10 });

    const count = startCount(ctx);
    expectSuccess(
      recordCountLineAction(ctx.db, ctx.admin, {
        countId: count.id,
        itemId: gauze.id,
        countedQuantity: 2,
      }),
    );
    expectSuccess(cancelInventoryCountAction(ctx.db, ctx.admin, count.id));

    expect(stockOf(ctx, gauze.id)).toBe(10);
    expect(findDraftCountForActor(ctx.db, ctx.admin)).toBeUndefined();
    expect(getCountStateForActor(ctx.db, ctx.admin, count.id)!.status).toBe('cancelled');
  });
});

// --- §3.2, §18.22: роли ------------------------------------------------------

describe('§3.2: инвентаризация доступна только Admin', () => {
  it('Staff не может начать инвентаризацию, записать строку и подтвердить её', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, { ...FIXTURES.gauze, quantity: 10 });

    const denied = expectFailure(startInventoryCountAction(ctx.db, ctx.staff));
    expect(denied.code).toBe('FORBIDDEN');

    // Черновик, начатый Admin, Staff тоже не двигает и не видит.
    const count = startCount(ctx);

    expect(expectFailure(scanForCountAction(ctx.db, ctx.staff, {
      countId: count.id,
      barcode: gauze.barcodeValue,
    })).code).toBe('FORBIDDEN');

    expect(
      expectFailure(
        recordCountLineAction(ctx.db, ctx.staff, {
          countId: count.id,
          itemId: gauze.id,
          countedQuantity: 1,
        }),
      ).code,
    ).toBe('FORBIDDEN');

    expect(expectFailure(applyInventoryCountAction(ctx.db, ctx.staff, count.id)).code).toBe(
      'FORBIDDEN',
    );
    expect(expectFailure(cancelInventoryCountAction(ctx.db, ctx.staff, count.id)).code).toBe(
      'FORBIDDEN',
    );

    // Чтение состояния под Staff не отдаёт данных вовсе.
    expect(findDraftCountForActor(ctx.db, ctx.staff)).toBeUndefined();
    expect(getCountStateForActor(ctx.db, ctx.staff, count.id)).toBeUndefined();

    // Ни одной попыткой Staff остаток не изменён.
    expect(stockOf(ctx, gauze.id)).toBe(10);
    expect(findStockInvariantMismatches(ctx.db)).toEqual([]);
  });
});

// --- §14.4: конкретные сообщения --------------------------------------------

describe('§14.4: сообщения инвентаризации конкретны', () => {
  it('неизвестный штрихкод — «Barcode not found», пак — отдельное сообщение', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, { ...FIXTURES.gauze, quantity: 10 });
    const pack = makeBasicPack(ctx, [{ itemId: gauze.id, quantity: 2 }]);
    const count = startCount(ctx);

    const unknown = expectFailure(
      scanForCountAction(ctx.db, ctx.admin, { countId: count.id, barcode: 'ITM-999999' }),
    );
    expect(unknown.error).toBe('Barcode not found');

    const asPack = expectFailure(
      scanForCountAction(ctx.db, ctx.admin, { countId: count.id, barcode: pack.barcodeValue }),
    );
    expect(asPack.error).toContain('is a pack');
    expect(asPack.error).toContain('scan the item barcodes instead');
  });

  it('пустое поле количества не превращается молча в ноль', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, { ...FIXTURES.gauze, quantity: 10 });
    const count = startCount(ctx);

    const empty = expectFailure(
      recordCountLineAction(ctx.db, ctx.admin, {
        countId: count.id,
        itemId: gauze.id,
        countedQuantity: '',
      }),
    );
    expect(empty.code).toBe('VALIDATION_FAILED');
    expect(getCountStateForActor(ctx.db, ctx.admin, count.id)!.lines).toEqual([]);

    // При этом честный ноль принимается: полка может быть пустой.
    expectSuccess(
      recordCountLineAction(ctx.db, ctx.admin, {
        countId: count.id,
        itemId: gauze.id,
        countedQuantity: '0',
      }),
    );
    expectSuccess(applyInventoryCountAction(ctx.db, ctx.admin, count.id));
    expect(stockOf(ctx, gauze.id)).toBe(0);
    expect(findStockInvariantMismatches(ctx.db)).toEqual([]);
  });
});
