import { describe, expect, it } from 'vitest';
import {
  listActiveItemsForLabels,
  resolveBulkLabels,
} from '@/actions/item-labels';
import { createItem, updateItem } from '@/domain/items';
import {
  calculateLabelSheetLayout,
  MAX_BULK_LABELS,
} from '@/domain/label-sheet';
import { createItemLabelSheetPdf } from '@/pdf/item-label-sheet';
import { setupTestDb } from './helpers';

function createZeroItem(
  ctx: ReturnType<typeof setupTestDb>,
  name: string,
  referenceNumber?: string,
) {
  return createItem(ctx.db, ctx.admin, {
    name,
    currentUnitCostCents: 100,
    unitOfMeasurement: 'each',
    initialQuantity: 0,
    referenceNumber,
  });
}

describe('Bulk item label selection', () => {
  it('показывает обеим ролям только активные и неархивированные товары', () => {
    const ctx = setupTestDb();
    const active = createZeroItem(ctx, 'Active Gauze');
    const inactive = createZeroItem(ctx, 'Inactive Gauze');
    updateItem(ctx.db, ctx.admin, inactive.id, { status: 'inactive' });

    expect(listActiveItemsForLabels(ctx.db, ctx.staff).map((item) => item.id)).toEqual([
      active.id,
    ]);
    expect(listActiveItemsForLabels(ctx.db, ctx.admin).map((item) => item.id)).toEqual([
      active.id,
    ]);
  });

  it('сортирует товары и использует Item Code во всём полном лейбле', () => {
    const ctx = setupTestDb();
    const second = createZeroItem(ctx, 'Zeta', 'REF-ZETA');
    const first = createZeroItem(ctx, 'Alpha');

    const model = resolveBulkLabels(ctx.db, ctx.staff, {
      sizeId: 'medium',
      selection: [
        { itemId: second.id, copies: 2 },
        { itemId: first.id, copies: 1 },
      ],
    });

    expect(model.items.map((item) => item.name)).toEqual(['Alpha', 'Zeta']);
    expect(model.items[1]).toMatchObject({
      barcodeValue: second.internalCode,
      internalCode: second.internalCode,
      referenceNumber: 'REF-ZETA',
      copies: 2,
    });
    expect(model.items[1]?.labelSvg).toContain(second.internalCode);
    expect(model.items[1]?.labelSvg).toContain('Zeta (Ref: REF-ZETA)');
    expect(model.layout).toMatchObject({
      columns: 3,
      rows: 7,
      labelsPerPage: 21,
      pageCount: 1,
      totalLabels: 3,
    });
  });

  it('отклоняет неактивный товар, дубликат и некорректное количество копий', () => {
    const ctx = setupTestDb();
    const item = createZeroItem(ctx, 'Gauze');
    updateItem(ctx.db, ctx.admin, item.id, { status: 'inactive' });

    expect(() =>
      resolveBulkLabels(ctx.db, ctx.admin, {
        sizeId: 'medium',
        selection: [{ itemId: item.id, copies: 1 }],
      }),
    ).toThrow(/no longer active/i);
    expect(() =>
      resolveBulkLabels(ctx.db, ctx.admin, {
        sizeId: 'medium',
        selection: [
          { itemId: item.id, copies: 1 },
          { itemId: item.id, copies: 1 },
        ],
      }),
    ).toThrow(/more than once/i);
    expect(() =>
      resolveBulkLabels(ctx.db, ctx.admin, {
        sizeId: 'medium',
        selection: [{ itemId: item.id, copies: 101 }],
      }),
    ).toThrow(/between 1 and 100/i);
  });

  it('ограничивает один документ десятью тысячами лейблов', () => {
    const ctx = setupTestDb();
    const selection = Array.from({ length: 101 }, (_, index) => ({
      itemId: createZeroItem(ctx, `Item ${index}`).id,
      copies: 100,
    }));

    expect(() =>
      resolveBulkLabels(ctx.db, ctx.admin, {
        sizeId: 'medium',
        selection,
      }),
    ).toThrow(/at most 10000 labels/i);
  });
});

describe('Label sheet layout and PDF', () => {
  it('переносит лейблы на следующие US Letter страницы', () => {
    expect(calculateLabelSheetLayout('medium', 22)).toMatchObject({
      labelsPerPage: 21,
      pageCount: 2,
    });
    expect(calculateLabelSheetLayout('small', MAX_BULK_LABELS).pageCount).toBeGreaterThan(1);
  });

  it('создаёт один многостраничный PDF', async () => {
    const ctx = setupTestDb();
    const item = createZeroItem(ctx, 'Sterile Gauze', 'REF-44');
    const model = resolveBulkLabels(ctx.db, ctx.admin, {
      sizeId: 'medium',
      selection: [{ itemId: item.id, copies: 22 }],
    });

    const pdf = await createItemLabelSheetPdf(model);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(2_000);
    expect(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(2);
  });
});
