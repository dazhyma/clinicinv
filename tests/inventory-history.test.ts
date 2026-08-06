import { describe, expect, it } from 'vitest';
import {
  applyInventoryCountAction,
  recordCountLineAction,
  startInventoryCountAction,
  type InventoryCountStateView,
} from '@/actions/inventory-count';
import {
  getInventoryHistoryForActor,
  listInventoryHistoryForActor,
} from '@/actions/inventory-history';
import { getItemHistoryForActor } from '@/actions/item-history';
import { receiveStockAction, updateItemAction } from '@/actions/items';
import { getItem } from '@/domain/items';
import { listMovementsForItem } from '@/domain/movements';
import { FIXTURES, makeItem, nextClientEventId, setupTestDb } from './helpers';

function success<T>(result: { ok: boolean }): T {
  if (!result.ok) throw new Error(`Expected success: ${JSON.stringify(result)}`);
  return (result as { ok: true; data: T }).data;
}

describe('Inventory History', () => {
  it('хранит номер, роли начала/завершения и снимки последнего ввода', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze, {
      referenceNumber: 'REF-1',
    });
    const count = success<InventoryCountStateView>(
      startInventoryCountAction(ctx.db, ctx.staff),
    );
    expect(count.internalCode).toBe('INV-000001');

    success(
      recordCountLineAction(ctx.db, ctx.admin, {
        countId: count.id,
        itemId: item.id,
        countedQuantity: 8,
      }),
    );
    success(applyInventoryCountAction(ctx.db, ctx.staff, count.id));

    // Последующее редактирование карточки не переписывает завершённый отчёт.
    success(
      updateItemAction(ctx.db, ctx.admin, item.id, {
        name: 'Renamed Gauze',
        referenceNumber: 'REF-2',
        costPerUnit: '3.00',
        unitOfMeasurement: 'each',
      }),
    );

    expect(listInventoryHistoryForActor(ctx.db, ctx.staff)).toEqual([
      expect.objectContaining({
        id: count.id,
        internalCode: 'INV-000001',
        status: 'Completed',
        startedBy: 'Staff',
        completedBy: 'Staff',
        countedItems: 1,
        differenceCount: 1,
      }),
    ]);

    const detail = getInventoryHistoryForActor(ctx.db, ctx.admin, count.id)!;
    expect(detail.lines[0]).toMatchObject({
      name: 'Gauze 4x4',
      referenceNumber: 'REF-1',
      expectedQuantity: 10,
      countedQuantity: 8,
      difference: -2,
      finalQuantity: 8,
      updatedBy: 'Admin',
    });
  });

  it('при параллельном движении Finish приводит текущий остаток точно к Actual', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);
    const count = success<InventoryCountStateView>(
      startInventoryCountAction(ctx.db, ctx.admin),
    );
    success(
      recordCountLineAction(ctx.db, ctx.admin, {
        countId: count.id,
        itemId: item.id,
        countedQuantity: 8,
      }),
    );

    // После физического подсчёта, но до Finish пришла отдельная поставка.
    success(
      receiveStockAction(ctx.db, ctx.staff, {
        itemId: item.id,
        quantity: 5,
        clientEventId: nextClientEventId('parallel-receive'),
      }),
    );
    expect(getItem(ctx.db, item.id)?.currentQuantity).toBe(15);

    success(applyInventoryCountAction(ctx.db, ctx.staff, count.id));
    expect(getItem(ctx.db, item.id)?.currentQuantity).toBe(8);
    expect(
      listMovementsForItem(ctx.db, item.id).find(
        (movement) => movement.movementType === 'count_correction',
      )?.quantityDelta,
    ).toBe(-7);
  });
});

describe('Item History', () => {
  it('доступна только Admin и объединяет изменения карточки с движениями', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    success(
      updateItemAction(ctx.db, ctx.admin, item.id, {
        name: 'Sterile Gauze',
        referenceNumber: '',
        costPerUnit: '3.25',
        unitOfMeasurement: 'each',
      }),
    );
    success(
      receiveStockAction(ctx.db, ctx.staff, {
        itemId: item.id,
        quantity: 4,
        reason: 'Delivery 42',
        clientEventId: nextClientEventId('history-receive'),
      }),
    );

    expect(getItemHistoryForActor(ctx.db, ctx.staff, item.id, 'all')).toBeUndefined();

    const all = getItemHistoryForActor(ctx.db, ctx.admin, item.id, 'all')!;
    expect(all.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'Item Created', accountRole: 'Admin' }),
        expect.objectContaining({
          action: 'Item Name Changed',
          oldValue: 'Gauze 4x4',
          newValue: 'Sterile Gauze',
          accountRole: 'Admin',
        }),
        expect.objectContaining({
          action: 'Unit Cost Changed',
          oldValue: '300',
          newValue: '325',
          accountRole: 'Admin',
        }),
        expect.objectContaining({
          action: 'Receive Stock',
          accountRole: 'Staff',
          quantityBefore: 10,
          quantityDelta: 4,
          quantityAfter: 14,
          reason: 'Delivery 42',
        }),
      ]),
    );

    const received = getItemHistoryForActor(ctx.db, ctx.admin, item.id, 'received')!;
    expect(received.entries).toHaveLength(1);
    expect(received.entries[0]?.action).toBe('Receive Stock');
    const cost = getItemHistoryForActor(ctx.db, ctx.admin, item.id, 'cost')!;
    expect(cost.entries).toHaveLength(1);
    expect(cost.entries[0]?.action).toBe('Unit Cost Changed');
  });
});
