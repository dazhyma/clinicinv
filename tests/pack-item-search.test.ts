import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createItemAction, listItemsForActor } from '@/actions/items';
import { filterPackItems, indexPackItems } from '@/app/inventory/_components/searchable-item-select';
import { setupTestDb } from './helpers';

describe('Pack searchable item selector', () => {
  it('keeps the menu portaled, keyboard accessible, and page-scroll safe', () => {
    const source = readFileSync(join(process.cwd(),
      'src/app/inventory/_components/searchable-item-select.tsx'), 'utf8');
    expect(source).toContain('placeholder="Search by item name or code..."');
    expect(source).toContain('role="combobox"');
    expect(source).toContain('role="listbox"');
    expect(source).toContain("event.key === 'Enter'");
    expect(source).toContain("event.key === 'Escape'");
    expect(source).toContain('createPortal');
    expect(source).toContain('preventScroll: true');
    expect(source).not.toContain('scrollIntoView');
  });

  it('searches names, normalized codes, references, and manufacturers', () => {
    const ctx = setupTestDb();
    const created = createItemAction(ctx.db, ctx.admin, {
      name: 'BD Syringe 20 ml',
      trackingMethod: 'standard',
      manufacturer: 'Becton Dickinson',
      referenceNumber: 'MDT-57382828',
      costPerUnit: '1.00',
      unitOfMeasurement: 'each',
      initialQuantity: '1',
    });
    if (!created.ok) throw new Error(created.error);
    const items = listItemsForActor(ctx.db, ctx.admin).items;
    const indexed = indexPackItems(items);
    const ids = (query: string) => filterPackItems(indexed, query, new Set(), '').map((item) => item.id);

    expect(ids('syringe 20')).toContain(created.data.itemId);
    expect(ids(created.data.internalCode.replaceAll('-', ''))).toContain(created.data.itemId);
    expect(ids('MDT57382828')).toContain(created.data.itemId);
    expect(ids('becton')).toContain(created.data.itemId);
  });

  it('excludes items selected in another row while retaining the current row', () => {
    const ctx = setupTestDb();
    const created = createItemAction(ctx.db, ctx.admin, {
      name: 'Selected Item', trackingMethod: 'standard', costPerUnit: '1.00',
      unitOfMeasurement: 'each', initialQuantity: '1',
    });
    if (!created.ok) throw new Error(created.error);
    const items = listItemsForActor(ctx.db, ctx.admin).items;
    const indexed = indexPackItems(items);
    const excluded = new Set([String(items[0]!.id)]);

    expect(filterPackItems(indexed, '', excluded, '')).not.toContainEqual(items[0]);
    expect(filterPackItems(indexed, '', excluded, String(items[0]!.id))).toContainEqual(items[0]);
  });

  it('limits an empty or matching result list to 50 items', () => {
    const ctx = setupTestDb();
    const item = listItemsForActor(ctx.db, ctx.admin).items[0]!;
    const many = Array.from({ length: 75 }, (_, index) => ({
      ...item,
      id: index + 1,
      name: `Syringe ${String(index + 1).padStart(3, '0')}`,
    }));
    const indexed = indexPackItems(many);

    expect(filterPackItems(indexed, '', new Set(), '')).toHaveLength(50);
    expect(filterPackItems(indexed, 'syringe', new Set(), '')).toHaveLength(50);
  });

  it('loads the full catalog for Pack forms instead of only the first 200 items', () => {
    const ctx = setupTestDb();
    for (let index = 1; index <= 205; index += 1) {
      const created = createItemAction(ctx.db, ctx.admin, {
        name: `Catalog Item ${String(index).padStart(3, '0')}`,
        trackingMethod: 'standard',
        costPerUnit: '1.00',
        unitOfMeasurement: 'each',
        initialQuantity: '1',
      });
      if (!created.ok) throw new Error(created.error);
    }

    expect(listItemsForActor(ctx.db, ctx.admin).items).toHaveLength(200);
    const fullCatalog = listItemsForActor(ctx.db, ctx.admin, { limit: null }).items;
    expect(fullCatalog).toHaveLength(205);
    expect(fullCatalog.at(-1)?.name).toBe('Catalog Item 205');

    const newPage = readFileSync(join(process.cwd(),
      'src/app/inventory/packs/new/page.tsx'), 'utf8');
    const editPage = readFileSync(join(process.cwd(),
      'src/app/inventory/packs/[id]/edit/page.tsx'), 'utf8');
    expect(newPage).toContain('{ limit: null }');
    expect(editPage).toContain('{ includeInactive: true, limit: null }');
  });
});
