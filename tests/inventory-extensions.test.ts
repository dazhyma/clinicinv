import { describe, expect, it } from 'vitest';
import { createItemAction, adjustStockAction, convertItemToLiquidAction } from '@/actions/items';
import { applyInventoryCountAction, recordCountLineAction, startInventoryCountAction } from '@/actions/inventory-count';
import { getInventoryHistoryForActor } from '@/actions/inventory-history';
import { listItemsForActor } from '@/actions/items';
import { addItemToOperationAction, addMissingItemAction, editFinishedLineCostAction, editFinishedSurgeryTypeAction, finishOperationAction, startOperationAction } from '@/actions/operations';
import { createPackAction } from '@/actions/packs';
import { listItemHistory } from '@/domain/item-history';
import { getItem } from '@/domain/items';
import { liquidMovementInvariantViolations } from '@/domain/liquid-movements';
import { addPackToOperation, editFinishedLineCost, getOperation, listOperationLines, startOrTimer, stopOrTimer } from '@/domain/operations';
import { createSurgeryType, listSurgeryTypes } from '@/domain/surgery-types';
import { parseDollarsToMicros } from '@/domain/liquid';
import { clinicDateTimeInput, clinicLocalDateTimeToUtc } from '@/lib/clinic-time';
import { setupTestDb } from './helpers';

function data<T>(result: { ok: boolean }): T {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return (result as { ok: true; data: T }).data;
}

describe('liquid inventory', () => {
  it('converts safe Standard stock to unopened liquid vials without changing its identity', () => {
    const ctx = setupTestDb();
    const created = data<{ itemId: number; internalCode: string }>(createItemAction(ctx.db, ctx.admin, {
      name: 'Convertible Drug', trackingMethod: 'standard', costPerUnit: '12.00',
      unitOfMeasurement: 'vial', initialQuantity: '3',
    }));
    data(convertItemToLiquidAction(ctx.db, ctx.admin, { itemId: created.itemId,
      volumePerVialMl: '5.25', costPerVial: '15.00' }));
    expect(getItem(ctx.db, created.itemId)).toMatchObject({ internalCode: created.internalCode,
      trackingMethod: 'liquid', currentQuantity: 0, liquidUnopenedVials: 3,
      liquidOpenVialCentiml: 0, liquidVolumePerVialCentiml: 525, currentUnitCostCents: 1500 });
    expect(liquidMovementInvariantViolations(ctx.db)).toEqual([]);
  });

  it('blocks Standard to Liquid conversion while the item belongs to a Pack', () => {
    const ctx = setupTestDb();
    const item = data<{ itemId: number }>(createItemAction(ctx.db, ctx.admin, {
      name: 'Packed Drug', trackingMethod: 'standard', costPerUnit: '1',
      unitOfMeasurement: 'vial', initialQuantity: '2',
    }));
    data(createPackAction(ctx.db, ctx.staff, { name: 'Blocking Pack',
      components: [{ itemId: item.itemId, quantity: '1' }] }));
    const result = convertItemToLiquidAction(ctx.db, ctx.admin, { itemId: item.itemId,
      volumePerVialMl: '10', costPerVial: '1' });
    expect(result.ok).toBe(false);
    expect(getItem(ctx.db, item.itemId)?.trackingMethod).toBe('standard');
  });

  it('blocks conversion for an item in an Active Surgery or draft Inventory Count', () => {
    const active = setupTestDb();
    const activeItem = data<{ itemId: number }>(createItemAction(active.db, active.admin, {
      name: 'Active Drug', trackingMethod: 'standard', costPerUnit: '1',
      unitOfMeasurement: 'vial', initialQuantity: '2',
    }));
    const surgery = data<{ operationId: number }>(startOperationAction(active.db, active.staff, {
      doctorId: active.doctor.id, patientId: '5', surgeryTypeName: '',
    }));
    data(addItemToOperationAction(active.db, active.staff, { operationId: surgery.operationId,
      itemId: activeItem.itemId, quantity: '1', clientEventId: 'conversion-active' }));
    expect(convertItemToLiquidAction(active.db, active.admin, { itemId: activeItem.itemId,
      volumePerVialMl: '5', costPerVial: '1' }).ok).toBe(false);

    const count = setupTestDb();
    const countItem = data<{ itemId: number }>(createItemAction(count.db, count.admin, {
      name: 'Count Drug', trackingMethod: 'standard', costPerUnit: '1',
      unitOfMeasurement: 'vial', initialQuantity: '2',
    }));
    const draft = data<{ id: number }>(startInventoryCountAction(count.db, count.staff));
    data(recordCountLineAction(count.db, count.staff, { countId: draft.id,
      itemId: countItem.itemId, countedQuantity: '2' }));
    expect(convertItemToLiquidAction(count.db, count.admin, { itemId: countItem.itemId,
      volumePerVialMl: '5', costPerVial: '1' }).ok).toBe(false);
  });

  it('parses precise cost per ml and Miami wall time without browser timezone assumptions', () => {
    expect(parseDollarsToMicros('0.012345')).toBe(12_345);
    const summer = clinicLocalDateTimeToUtc('2026-07-15T09:30');
    const winter = clinicLocalDateTimeToUtc('2026-01-15T09:30');
    expect(summer.toISOString()).toBe('2026-07-15T13:30:00.000Z');
    expect(winter.toISOString()).toBe('2026-01-15T14:30:00.000Z');
    expect(clinicDateTimeInput(summer)).toBe('2026-07-15T09:30');
  });

  it('uses the open vial first and calculates cost from used ml', () => {
    const ctx = setupTestDb();
    const type = createSurgeryType(ctx.db, ctx.admin, 'Cataract');
    const created = data<{ itemId: number }>(createItemAction(ctx.db, ctx.admin, {
      name: 'Liquid medication', trackingMethod: 'liquid', manufacturer: 'Medline',
      costPerUnit: '20.00', volumePerVialMl: '5.00', initialUnopenedVials: '10',
      initialOpenVialMl: '2.00', unitOfMeasurement: '',
    }));
    const operation = data<{ operationId: number }>(startOperationAction(ctx.db, ctx.staff, {
      doctorId: ctx.doctor.id, patientId: '00012', surgeryTypeId: type.id,
    }));
    const added = data<{ state: { lines: { amountUsedFormatted: string | null }[] } }>(
      addItemToOperationAction(ctx.db, ctx.staff, { operationId: operation.operationId,
        itemId: created.itemId, amountUsedMl: '8.00', clientEventId: 'liquid-use-1' }),
    );
    expect(added.state.lines[0]?.amountUsedFormatted).toBe('8');

    const item = getItem(ctx.db, created.itemId)!;
    expect(item.liquidUnopenedVials).toBe(8);
    expect(item.liquidOpenVialCentiml).toBe(400);
    const line = listOperationLines(ctx.db, operation.operationId)[0]!;
    expect(line.amountUsedCentiml).toBe(800);
    expect(line.lineTotalCents).toBe(3200);
    expect(liquidMovementInvariantViolations(ctx.db)).toEqual([]);
  });

  it('stores liquid pack amounts in ml and lets Staff create the pack', () => {
    const ctx = setupTestDb();
    const item = data<{ itemId: number }>(createItemAction(ctx.db, ctx.admin, {
      name: 'Solution', trackingMethod: 'liquid', costPerUnit: '10', volumePerVialMl: '5',
      initialUnopenedVials: '2', initialOpenVialMl: '0', unitOfMeasurement: '',
    }));
    const pack = data<{ packId: number }>(createPackAction(ctx.db, ctx.staff, { name: 'Liquid Pack',
      components: [{ itemId: item.itemId, quantity: '', liquidAmountMl: '2.50' }] }));
    const operation = startOperationAction(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: '7', surgeryTypeId: ctx.surgeryType.id });
    const operationId = data<{ operationId: number }>(operation).operationId;
    addPackToOperation(ctx.db, ctx.staff, { operationId, packId: pack.packId, clientEventId: 'pack-liquid-1' });
    expect(getItem(ctx.db, item.itemId)?.liquidOpenVialCentiml).toBe(250);
  });

  it('accepts zero ml for a physically empty open vial adjustment', () => {
    const ctx = setupTestDb();
    const item = data<{ itemId: number }>(createItemAction(ctx.db, ctx.admin, {
      name: 'Zero Open', trackingMethod: 'liquid', costPerUnit: '5', volumePerVialMl: '10',
      initialUnopenedVials: '1', initialOpenVialMl: '0.00', unitOfMeasurement: '',
    }));
    expect(adjustStockAction(ctx.db, ctx.admin, { itemId: item.itemId, mode: 'set',
      unopenedVials: '0', openVialMl: '0.00', reason: 'Discarded', clientEventId: 'zero-open' }).ok).toBe(true);
  });

  it('counts liquid stock in unopened vials and open-vial ml', () => {
    const ctx = setupTestDb();
    const item = data<{ itemId: number }>(createItemAction(ctx.db, ctx.admin, {
      name: 'Counted Liquid', trackingMethod: 'liquid', costPerUnit: '8', volumePerVialMl: '10',
      initialUnopenedVials: '2', initialOpenVialMl: '5.50', unitOfMeasurement: '',
    }));
    const count = data<{ id: number }>(startInventoryCountAction(ctx.db, ctx.staff));
    const recorded = data<{ line: { difference: number; countedOpenVialMl: string } }>(
      recordCountLineAction(ctx.db, ctx.staff, { countId: count.id, itemId: item.itemId,
        countedQuantity: '0', countedUnopenedVials: '1', countedOpenVialMl: '2.25' }),
    );
    expect(recorded.line.difference).toBe(-1325);
    expect(recorded.line.countedOpenVialMl).toBe('2.25');
    data(applyInventoryCountAction(ctx.db, ctx.staff, count.id));
    expect(getItem(ctx.db, item.itemId)).toMatchObject({ liquidUnopenedVials: 1, liquidOpenVialCentiml: 225 });
    const history = getInventoryHistoryForActor(ctx.db, ctx.staff, count.id)!;
    expect(history.lines[0]).toMatchObject({ trackingMethod: 'liquid', finalOpenVialMl: '2.25' });
    expect(history.summary.adjustmentCount).toBe(1);
  });

  it('shows liquid receipts and consumption in item history', () => {
    const ctx = setupTestDb();
    const item = data<{ itemId: number }>(createItemAction(ctx.db, ctx.admin, {
      name: 'Liquid History', trackingMethod: 'liquid', costPerUnit: '4', volumePerVialMl: '5',
      initialUnopenedVials: '1', initialOpenVialMl: '1.50', unitOfMeasurement: '',
    }));
    adjustStockAction(ctx.db, ctx.admin, { itemId: item.itemId, mode: 'set', unopenedVials: '0',
      openVialMl: '0.50', reason: 'Discarded', clientEventId: 'liquid-history-adjust' });
    const entries = listItemHistory(ctx.db, item.itemId);
    expect(entries.some((entry) => entry.liquidStockAfter === '0 unopened + 0.50 ml open')).toBe(true);
    expect(entries.find((entry) => entry.reason === 'Discarded')?.liquidVolumeDeltaMl).toBe('-6.00');
  });

  it('deduplicates manufacturer spelling and filters by manufacturer', () => {
    const ctx = setupTestDb();
    data(createItemAction(ctx.db, ctx.admin, { name: 'First', trackingMethod: 'standard',
      manufacturer: '  Medline  ', costPerUnit: '1', unitOfMeasurement: 'each', initialQuantity: '1' }));
    data(createItemAction(ctx.db, ctx.admin, { name: 'Second', trackingMethod: 'standard',
      manufacturer: 'medline', costPerUnit: '1', unitOfMeasurement: 'each', initialQuantity: '1' }));
    const all = listItemsForActor(ctx.db, ctx.admin);
    expect(all.manufacturers).toHaveLength(1);
    expect(all.manufacturers[0]?.name).toBe('Medline');
    expect(listItemsForActor(ctx.db, ctx.admin, { manufacturerId: String(all.manufacturers[0]!.id) }).items)
      .toHaveLength(2);
  });
});

describe('Surgery metadata and controlled finished edits', () => {
  it('accepts optional and free Surgery Types, deduplicates suggestions, and preserves casing', () => {
    const ctx = setupTestDb(); const type = createSurgeryType(ctx.db, ctx.admin, 'Retina');
    const started = data<{ operationId: number }>(startOperationAction(ctx.db, ctx.staff, {
      doctorId: ctx.doctor.id, patientId: '1', surgeryTypeName: '  RETINA  ' }));
    expect(getOperation(ctx.db, started.operationId)).toMatchObject({ surgeryTypeId: type.id,
      surgeryTypeNameSnapshot: 'RETINA' });
    expect(listSurgeryTypes(ctx.db, ctx.staff).map((entry) => entry.name)).toContain('Retina');
    expect(listSurgeryTypes(ctx.db, ctx.staff).filter((entry) => entry.name.toLowerCase() === 'retina')).toHaveLength(1);
  });

  it('lets Admin set, replace, and clear the Surgery Type on a Finished surgery', () => {
    const ctx = setupTestDb();
    const started = data<{ operationId: number }>(startOperationAction(ctx.db, ctx.staff, {
      doctorId: ctx.doctor.id, patientId: '2', surgeryTypeName: '' }));
    data(finishOperationAction(ctx.db, ctx.staff, started.operationId));
    data(editFinishedSurgeryTypeAction(ctx.db, ctx.admin, { operationId: started.operationId,
      surgeryTypeName: 'New Combined Type' }));
    expect(getOperation(ctx.db, started.operationId)?.surgeryTypeNameSnapshot).toBe('New Combined Type');
    data(editFinishedSurgeryTypeAction(ctx.db, ctx.admin, { operationId: started.operationId,
      surgeryTypeName: '' }));
    expect(getOperation(ctx.db, started.operationId)?.surgeryTypeNameSnapshot).toBeNull();
  });

  it('persists one OR interval and blocks finish until stopped', () => {
    const ctx = setupTestDb(); const started = data<{ operationId: number }>(startOperationAction(ctx.db, ctx.staff, {
      doctorId: ctx.doctor.id, patientId: '1', surgeryTypeId: ctx.surgeryType.id }));
    startOrTimer(ctx.db, ctx.staff, started.operationId);
    expect(finishOperationAction(ctx.db, ctx.staff, started.operationId).ok).toBe(false);
    stopOrTimer(ctx.db, ctx.staff, started.operationId);
    expect(finishOperationAction(ctx.db, ctx.staff, started.operationId).ok).toBe(true);
    expect(() => startOrTimer(ctx.db, ctx.staff, started.operationId)).toThrow();
  });

  it('changes only the applied cost of a Finished line', () => {
    const ctx = setupTestDb();
    const item = data<{ itemId: number }>(createItemAction(ctx.db, ctx.admin, { name: 'Needle', trackingMethod: 'standard',
      costPerUnit: '0', unitOfMeasurement: 'each', initialQuantity: '5' }));
    const operation = data<{ operationId: number }>(startOperationAction(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: '4', surgeryTypeId: ctx.surgeryType.id }));
    data(addItemToOperationAction(ctx.db, ctx.staff, { operationId: operation.operationId, itemId: item.itemId,
      quantity: '1', clientEventId: 'needle-use' }));
    finishOperationAction(ctx.db, ctx.staff, operation.operationId);
    const line = listOperationLines(ctx.db, operation.operationId)[0]!;
    expect(editFinishedLineCostAction(ctx.db, ctx.staff, { operationId: operation.operationId,
      lineId: line.id, cost: '2.50' }).ok).toBe(false);
    editFinishedLineCost(ctx.db, ctx.admin, operation.operationId, line.id, 2_500_000, 'Late invoice');
    expect(listOperationLines(ctx.db, operation.operationId)[0]?.lineTotalCents).toBe(250);
    expect(getItem(ctx.db, item.itemId)?.currentUnitCostCents).toBe(0);
  });

  it('adds a missed Finished item to an existing matching line and deducts stock once', () => {
    const ctx = setupTestDb();
    const item = data<{ itemId: number }>(createItemAction(ctx.db, ctx.admin, { name: 'Late Needle',
      trackingMethod: 'standard', costPerUnit: '2', unitOfMeasurement: 'each', initialQuantity: '5' }));
    const operation = data<{ operationId: number }>(startOperationAction(ctx.db, ctx.staff, {
      doctorId: ctx.doctor.id, patientId: '8', surgeryTypeId: ctx.surgeryType.id }));
    data(addItemToOperationAction(ctx.db, ctx.staff, { operationId: operation.operationId,
      itemId: item.itemId, quantity: '1', clientEventId: 'late-base' }));
    data(finishOperationAction(ctx.db, ctx.staff, operation.operationId));
    data(addMissingItemAction(ctx.db, ctx.admin, { operationId: operation.operationId,
      itemId: item.itemId, quantity: '2', clientEventId: 'late-add' }));
    expect(listOperationLines(ctx.db, operation.operationId)).toHaveLength(1);
    expect(listOperationLines(ctx.db, operation.operationId)[0]?.quantity).toBe(3);
    expect(getItem(ctx.db, item.itemId)?.currentQuantity).toBe(2);
    data(addMissingItemAction(ctx.db, ctx.admin, { operationId: operation.operationId,
      itemId: item.itemId, quantity: '2', clientEventId: 'late-add' }));
    expect(getItem(ctx.db, item.itemId)?.currentQuantity).toBe(2);
  });
});
