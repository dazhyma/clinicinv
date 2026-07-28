import { describe, expect, it } from 'vitest';
import {
  deleteInventoryCountAction,
  getInventoryHistoryForActor,
  listInventoryHistoryForActor,
} from '@/actions/inventory-history';
import {
  applyInventoryCountAction,
  recordCountLineAction,
  startInventoryCountAction,
  type InventoryCountStateView,
} from '@/actions/inventory-count';
import { deleteItemAction, receiveStockAction } from '@/actions/items';
import { deletePackAction } from '@/actions/packs';
import { barcodeRegistry, itemHistoryEvents } from '@/db/schema';
import { getItem } from '@/domain/items';
import { listItemHistory } from '@/domain/item-history';
import {
  findStockInvariantMismatches,
  listMovementsForItem,
} from '@/domain/movements';
import { addPackToOperation, startOperation } from '@/domain/operations';
import { getPack } from '@/domain/packs';
import {
  FIXTURES,
  makeBasicPack,
  makeItem,
  nextClientEventId,
  setupTestDb,
} from './helpers';

function success<T>(result: { ok: boolean }): T {
  if (!result.ok) throw new Error(`Expected success: ${JSON.stringify(result)}`);
  return (result as { ok: true; data: T }).data;
}

describe('Delete Inventory Count', () => {
  it('точно обращает движения Count, сохраняет более позднюю поставку и не повторяется', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, { ...FIXTURES.gauze, quantity: 20 });
    const count = success<InventoryCountStateView>(
      startInventoryCountAction(ctx.db, ctx.admin),
    );
    success(
      recordCountLineAction(ctx.db, ctx.admin, {
        countId: count.id,
        itemId: item.id,
        countedQuantity: 18,
      }),
    );
    success(applyInventoryCountAction(ctx.db, ctx.admin, count.id));
    success(
      receiveStockAction(ctx.db, ctx.staff, {
        itemId: item.id,
        quantity: 10,
        clientEventId: nextClientEventId('after-count'),
      }),
    );
    expect(getItem(ctx.db, item.id)?.currentQuantity).toBe(28);

    const deleted = success<{ reversedMovements: number }>(
      deleteInventoryCountAction(ctx.db, ctx.admin, count.id),
    );
    expect(deleted.reversedMovements).toBe(1);
    expect(getItem(ctx.db, item.id)?.currentQuantity).toBe(30);
    expect(listInventoryHistoryForActor(ctx.db, ctx.admin)).toEqual([]);
    expect(getInventoryHistoryForActor(ctx.db, ctx.admin, count.id)).toBeUndefined();
    expect(deleteInventoryCountAction(ctx.db, ctx.admin, count.id)).toMatchObject({
      ok: false,
    });
    expect(getItem(ctx.db, item.id)?.currentQuantity).toBe(30);
    expect(findStockInvariantMismatches(ctx.db)).toEqual([]);

    expect(listItemHistory(ctx.db, item.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'Inventory Count Deleted',
          quantityDelta: 2,
          inventoryCountCode: count.internalCode,
        }),
      ]),
    );
  });

  it('Staff не может удалить завершённую инвентаризацию', () => {
    const ctx = setupTestDb();
    expect(deleteInventoryCountAction(ctx.db, ctx.staff, 1)).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
  });
});

describe('Delete Item', () => {
  it('полностью удаляет неиспользованный товар и его техническую историю/barcodes', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, { ...FIXTURES.gauze, quantity: 0 });

    const result = success<{ disposition: string }>(
      deleteItemAction(ctx.db, ctx.admin, item.id),
    );
    expect(result.disposition).toBe('deleted');
    expect(getItem(ctx.db, item.id)).toBeUndefined();
    expect(
      ctx.db.select().from(itemHistoryEvents).all().filter((row) => row.itemId === item.id),
    ).toEqual([]);
    expect(
      ctx.db.select().from(barcodeRegistry).all().filter((row) => row.ownerId === item.id),
    ).toEqual([]);
  });

  it('архивирует связанный товар без изменения остатка и блокирует повтор', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);
    const before = listMovementsForItem(ctx.db, item.id);

    const result = success<{ disposition: string }>(
      deleteItemAction(ctx.db, ctx.admin, item.id),
    );
    expect(result.disposition).toBe('archived');
    expect(getItem(ctx.db, item.id)).toMatchObject({
      status: 'inactive',
      currentQuantity: FIXTURES.gauze.quantity,
    });
    expect(getItem(ctx.db, item.id)?.archivedAt).toBeInstanceOf(Date);
    expect(listMovementsForItem(ctx.db, item.id)).toEqual(before);
    expect(
      receiveStockAction(ctx.db, ctx.staff, {
        itemId: item.id,
        quantity: 1,
        clientEventId: nextClientEventId('archived-receive'),
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('inactive') });
    expect(deleteItemAction(ctx.db, ctx.admin, item.id)).toMatchObject({ ok: false });
  });

  it('Staff не может удалить товар', () => {
    const ctx = setupTestDb();
    expect(deleteItemAction(ctx.db, ctx.staff, 1)).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
  });
});

describe('Delete Pack', () => {
  it('полностью удаляет неиспользованный пак, не удаляя товары', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);
    const pack = makeBasicPack(ctx, [{ itemId: item.id, quantity: 2 }]);

    expect(success<{ disposition: string }>(deletePackAction(ctx.db, ctx.admin, pack.id)))
      .toMatchObject({ disposition: 'deleted' });
    expect(getPack(ctx.db, pack.id)).toBeUndefined();
    expect(getItem(ctx.db, item.id)).toBeDefined();
  });

  it('архивирует использованный пак и сохраняет товары и остатки', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);
    const pack = makeBasicPack(ctx, [{ itemId: item.id, quantity: 2 }]);
    const operation = startOperation(ctx.db, ctx.staff);
    addPackToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      packId: pack.id,
      clientEventId: nextClientEventId('used-pack'),
    });
    const quantityBeforeDelete = getItem(ctx.db, item.id)?.currentQuantity;

    expect(success<{ disposition: string }>(deletePackAction(ctx.db, ctx.admin, pack.id)))
      .toMatchObject({ disposition: 'archived' });
    expect(getPack(ctx.db, pack.id)).toMatchObject({ status: 'inactive' });
    expect(getPack(ctx.db, pack.id)?.archivedAt).toBeInstanceOf(Date);
    expect(getItem(ctx.db, item.id)?.currentQuantity).toBe(quantityBeforeDelete);
  });
});
