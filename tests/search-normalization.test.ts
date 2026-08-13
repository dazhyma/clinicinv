import { describe, expect, it } from 'vitest';
import { listItemsForActor } from '@/actions/items';
import {
  searchItemsForCountAction,
  startInventoryCountAction,
} from '@/actions/inventory-count';
import {
  searchItemsForOperationAction,
} from '@/actions/operations';
import { searchSelectionTargetsForConfirmation } from '@/actions/scanning';
import { normalizeSearchCode } from '@/lib/search-normalization';
import { FIXTURES, makeBasicPack, makeItem, setupTestDb } from './helpers';

function ids(result: { ok: boolean; data?: Array<{ id?: number; itemId?: number }> }): number[] {
  if (!result.ok || !result.data) throw new Error(`Expected success, got ${JSON.stringify(result)}`);
  return result.data.map((row) => row.id ?? row.itemId ?? -1);
}

describe('нормализованный поиск кодов товаров', () => {
  it('убирает любые разделители и регистр, сохраняя начальные нули', () => {
    expect(normalizeSearchCode(' 00-mdt.(57)/38_2828 ')).toBe('00MDT57382828');
  });

  it('одинаково работает в каталоге, общем селекторе и Operations', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze, { referenceNumber: 'MDT-5738.2828' });
    const count = startInventoryCountAction(ctx.db, ctx.admin);
    if (!count.ok) throw new Error(`Expected count, got ${JSON.stringify(count)}`);

    for (const query of ['MDT57382828', 'mdt 5738/2828', 'MDT-(5738)_2828']) {
      expect(listItemsForActor(ctx.db, ctx.staff, { q: query }).items.map((row) => row.id))
        .toContain(item.id);
      expect(ids(searchSelectionTargetsForConfirmation(ctx.db, ctx.staff, { query })))
        .toContain(item.id);
      expect(ids(searchItemsForOperationAction(ctx.db, ctx.staff, query))).toContain(item.id);
      expect(ids(searchItemsForCountAction(ctx.db, ctx.staff, {
        countId: count.data.id,
        query,
      }))).toContain(item.id);
    }
  });

  it('находит код без разделителей, когда он записан внутри Item Name', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, {
      ...FIXTURES.gauze,
      name: 'Medication NDC 8888-8888-282828',
    });

    expect(listItemsForActor(ctx.db, ctx.staff, { q: '88888888282828' }).items.map((row) => row.id))
      .toContain(item.id);
    expect(ids(searchSelectionTargetsForConfirmation(ctx.db, ctx.staff, {
      query: '8888 8888 282828',
    }))).toContain(item.id);
  });

  it('находит системные Item/Pack codes без дефиса и не считает одни разделители запросом кода', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);
    const pack = makeBasicPack(ctx, [{ itemId: item.id, quantity: 1 }], 'Procedure Pack');

    expect(
      ids(searchSelectionTargetsForConfirmation(ctx.db, ctx.staff, {
        query: item.internalCode.replace('-', ''),
      })),
    ).toContain(item.id);
    expect(
      ids(searchSelectionTargetsForConfirmation(ctx.db, ctx.staff, {
        query: pack.internalCode.replace('-', ''),
        includePacks: true,
      })),
    ).toContain(pack.id);
    expect(listItemsForActor(ctx.db, ctx.staff, { q: '--- / ()' }).items).toEqual([]);
  });
});
