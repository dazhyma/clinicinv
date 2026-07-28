import { describe, expect, it } from 'vitest';
import {
  resolveBarcodeForConfirmation,
  type BarcodeConfirmationView,
} from '@/actions/scanning';
import { getOperationState, startOperationAction } from '@/actions/operations';
import { getItem } from '@/domain/items';
import { listMovementsForItem } from '@/domain/movements';
import { FIXTURES, makeBasicPack, makeItem, setupTestDb } from './helpers';

function expectSuccess<T>(result: { ok: boolean }): T {
  if (!result.ok) throw new Error(`Expected success, got ${JSON.stringify(result)}`);
  return (result as { ok: true; data: T }).data;
}

describe('barcode confirmation lookup is read-only', () => {
  it('returns an item card without changing stock, movements, or an operation', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze, {
      sku: 'GAUZE-44',
      referenceNumber: 'REF-127',
    });
    const operation = expectSuccess<{ operationId: number }>(
      startOperationAction(ctx.db, ctx.staff),
    );
    const stockBefore = getItem(ctx.db, item.id)?.currentQuantity;
    const movementCountBefore = listMovementsForItem(ctx.db, item.id).length;

    const card = expectSuccess<BarcodeConfirmationView>(
      resolveBarcodeForConfirmation(ctx.db, ctx.staff, item.barcodeValue),
    );

    expect(card).toMatchObject({
      kind: 'item',
      id: item.id,
      name: 'Gauze 4x4',
      internalCode: item.internalCode,
      sku: 'GAUZE-44',
      referenceNumber: 'REF-127',
      currentQuantity: 10,
      components: [],
    });
    expect(getItem(ctx.db, item.id)?.currentQuantity).toBe(stockBefore);
    expect(listMovementsForItem(ctx.db, item.id)).toHaveLength(movementCountBefore);
    expect(getOperationState(ctx.db, ctx.staff, operation.operationId)?.lines).toEqual([]);
  });

  it('returns pack contents without decrementing any component', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);
    const gloves = makeItem(ctx, FIXTURES.gloves);
    const pack = makeBasicPack(ctx, [
      { itemId: gauze.id, quantity: 2 },
      { itemId: gloves.id, quantity: 1 },
    ]);

    const card = expectSuccess<BarcodeConfirmationView>(
      resolveBarcodeForConfirmation(ctx.db, ctx.staff, pack.barcodeValue),
    );

    expect(card.kind).toBe('pack');
    expect(card.currentQuantity).toBeNull();
    expect(card.components).toEqual([
      {
        itemId: gauze.id,
        name: gauze.name,
        quantity: 2,
        unitOfMeasurement: gauze.unitOfMeasurement,
        currentQuantity: 10,
      },
      {
        itemId: gloves.id,
        name: gloves.name,
        quantity: 1,
        unitOfMeasurement: gloves.unitOfMeasurement,
        currentQuantity: 50,
      },
    ]);
    expect(getItem(ctx.db, gauze.id)?.currentQuantity).toBe(10);
    expect(getItem(ctx.db, gloves.id)?.currentQuantity).toBe(50);
  });

  it('unknown and inactive barcodes cannot produce a confirmable card', () => {
    const ctx = setupTestDb();
    const unknown = resolveBarcodeForConfirmation(ctx.db, ctx.staff, 'NOT-A-BARCODE');
    expect(unknown).toMatchObject({ ok: false, code: 'BARCODE_NOT_FOUND' });
  });
});
