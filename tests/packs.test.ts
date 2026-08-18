/**
 * AC-3 / §6 / §7.7 / §16 — паки.
 */
import { describe, expect, it } from 'vitest';
import { getItem, updateItem } from '@/domain/items';
import { findStockInvariantMismatches, listMovementsForOperation } from '@/domain/movements';
import { packCurrentCostCents, updatePack } from '@/domain/packs';
import {
  addItemToOperation,
  addPackToOperation,
  finishOperation,
  listOperationLines,
  operationTotalCents,
  startOperation,
} from '@/domain/operations';
import { getOperation } from '@/domain/operations';
import { FIXTURES, makeBasicPack, makeItem, nextClientEventId, setupTestDb } from './helpers';

function buildScenario() {
  const ctx = setupTestDb();
  const gauze = makeItem(ctx, { ...FIXTURES.gauze, quantity: 100 });
  const gloves = makeItem(ctx, FIXTURES.gloves);
  const syringe = makeItem(ctx, FIXTURES.syringe);
  const mask = makeItem(ctx, FIXTURES.mask);
  const pack = makeBasicPack(ctx, [
    { itemId: gauze.id, quantity: 2 },
    { itemId: gloves.id, quantity: 3 },
    { itemId: syringe.id, quantity: 1 },
  ]);
  return { ctx, gauze, gloves, syringe, mask, pack };
}

describe('AC-3.1: один скан добавляет весь состав', () => {
  it('создаёт 3 строки, снимки цен и правильно уменьшает остатки', () => {
    const { ctx, gauze, gloves, syringe, pack } = buildScenario();

    // §6.4: расчётная стоимость пака = 2×3.00 + 3×0.50 + 1×1.20 = $8.70
    expect(packCurrentCostCents(ctx.db, pack.id)).toBe(870);
    expect(pack.internalCode).toMatch(/^PCK-\d{6}$/);

    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    const result = addPackToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      packId: pack.id,
      clientEventId: nextClientEventId('packscan'),
    });

    expect(result.applied).toBe(true);
    expect(result.lines).toHaveLength(3);

    const lines = listOperationLines(ctx.db, operation.id);
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line.sourceType).toBe('pack');
      expect(line.sourcePackId).toBe(pack.id);
    }

    const byItem = new Map(lines.map((l) => [l.itemId, l]));
    expect(byItem.get(gauze.id)!.quantity).toBe(2);
    expect(byItem.get(gauze.id)!.unitCostSnapshotCents).toBe(300);
    expect(byItem.get(gauze.id)!.lineTotalCents).toBe(600);
    expect(byItem.get(gloves.id)!.lineTotalCents).toBe(150);
    expect(byItem.get(syringe.id)!.lineTotalCents).toBe(120);
    expect(operationTotalCents(ctx.db, getOperation(ctx.db, operation.id)!)).toBe(870);

    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(98);
    expect(getItem(ctx.db, gloves.id)!.currentQuantity).toBe(47);
    expect(getItem(ctx.db, syringe.id)!.currentQuantity).toBe(19);

    const used = listMovementsForOperation(ctx.db, operation.id).filter(
      (m) => m.movementType === 'used_in_operation',
    );
    expect(used).toHaveLength(3);
    expect(used.map((m) => m.quantityDelta).sort((a, b) => a - b)).toEqual([-3, -2, -1]);
    expect(findStockInvariantMismatches(ctx.db)).toEqual([]);
  });

  it('повторная отправка того же скана пака ничего не задваивает', () => {
    const { ctx, gauze, gloves, syringe, pack } = buildScenario();
    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    const clientEventId = 'pack-retry';

    const first = addPackToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      packId: pack.id,
      clientEventId,
    });
    const retry = addPackToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      packId: pack.id,
      clientEventId,
    });

    expect(first.applied).toBe(true);
    expect(retry.applied).toBe(false);
    expect(listOperationLines(ctx.db, operation.id)).toHaveLength(3);
    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(98);
    expect(getItem(ctx.db, gloves.id)!.currentQuantity).toBe(47);
    expect(getItem(ctx.db, syringe.id)!.currentQuantity).toBe(19);
  });
});

describe('AC-3.2: скан пака атомарен (§16)', () => {
  it('неактивный предмет в составе отменяет ВЕСЬ скан, остатки не меняются', () => {
    const { ctx, gauze, gloves, syringe, pack } = buildScenario();
    // Вторая позиция пака выведена из оборота.
    updateItem(ctx.db, ctx.admin, gloves.id, { status: 'inactive' });

    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    expect(() =>
      addPackToOperation(ctx.db, ctx.staff, {
        operationId: operation.id,
        packId: pack.id,
        clientEventId: nextClientEventId('packscan'),
      }),
    ).toThrow(/Item is inactive/i);

    // Ни одной строки, ни одного движения, остатки нетронуты.
    expect(listOperationLines(ctx.db, operation.id)).toHaveLength(0);
    expect(listMovementsForOperation(ctx.db, operation.id)).toHaveLength(0);
    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(100);
    expect(getItem(ctx.db, gloves.id)!.currentQuantity).toBe(50);
    expect(getItem(ctx.db, syringe.id)!.currentQuantity).toBe(20);
    expect(findStockInvariantMismatches(ctx.db)).toEqual([]);
  });
});

describe('AC-3.3: изменение состава пака не меняет завершённую операцию', () => {
  it('завершённая операция сохраняет исходный состав и итог $8.70', () => {
    const { ctx, gauze, gloves, syringe, mask, pack } = buildScenario();

    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    addPackToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      packId: pack.id,
      clientEventId: nextClientEventId('packscan'),
    });
    const finished = finishOperation(ctx.db, ctx.staff, operation.id);
    expect(finished.totalCostSnapshotCents).toBe(870);

    // Admin меняет состав: Gauze ×2 → ×4, добавляет Mask ×1.
    updatePack(ctx.db, ctx.admin, pack.id, {
      composition: [
        { itemId: gauze.id, quantity: 4 },
        { itemId: gloves.id, quantity: 3 },
        { itemId: syringe.id, quantity: 1 },
        { itemId: mask.id, quantity: 1 },
      ],
    });
    // 4×3.00 + 3×0.50 + 1×1.20 + 1×0.25 = $14.95
    expect(packCurrentCostCents(ctx.db, pack.id)).toBe(1495);

    // Завершённая операция не изменилась.
    const lines = listOperationLines(ctx.db, operation.id);
    expect(lines).toHaveLength(3);
    expect(lines.find((l) => l.itemId === gauze.id)!.quantity).toBe(2);
    expect(lines.find((l) => l.itemId === mask.id)).toBeUndefined();
    expect(operationTotalCents(ctx.db, getOperation(ctx.db, operation.id)!)).toBe(870);

    // Редактирование пака не породило движений: остатки прежние.
    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(98);
    expect(getItem(ctx.db, gloves.id)!.currentQuantity).toBe(47);
    expect(getItem(ctx.db, syringe.id)!.currentQuantity).toBe(19);
    expect(getItem(ctx.db, mask.id)!.currentQuantity).toBe(100);

    // Новый скан использует новый состав.
    const next = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    addPackToOperation(ctx.db, ctx.staff, {
      operationId: next.id,
      packId: pack.id,
      clientEventId: nextClientEventId('packscan'),
    });
    expect(listOperationLines(ctx.db, next.id)).toHaveLength(4);
    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(94);
    expect(getItem(ctx.db, mask.id)!.currentQuantity).toBe(99);
    expect(findStockInvariantMismatches(ctx.db)).toEqual([]);
  });
});

describe('AC-4.4: стоимость пака следует за ценами, история — нет', () => {
  it('после роста цены Gauze пак стоит $11.20, а завершённая операция — $8.70', () => {
    const { ctx, gauze, pack } = buildScenario();
    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    addPackToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      packId: pack.id,
      clientEventId: nextClientEventId('packscan'),
    });
    finishOperation(ctx.db, ctx.staff, operation.id);

    updateItem(ctx.db, ctx.admin, gauze.id, { currentUnitCostCents: 425 });

    expect(packCurrentCostCents(ctx.db, pack.id)).toBe(1120);
    expect(operationTotalCents(ctx.db, getOperation(ctx.db, operation.id)!)).toBe(870);
  });
});

describe('AC-3.4: предмет в нескольких паках и отдельно', () => {
  it('источники различимы, суммарное списание корректно', () => {
    const { ctx, gauze, pack } = buildScenario();
    const extraPack = makeBasicPack(ctx, [{ itemId: gauze.id, quantity: 1 }], 'Extra Pack');

    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    addPackToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      packId: pack.id,
      clientEventId: nextClientEventId('packscan'),
    });
    addPackToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      packId: extraPack.id,
      clientEventId: nextClientEventId('packscan'),
    });
    addItemToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      itemId: gauze.id,
      clientEventId: nextClientEventId('scan'),
    });

    // 2 (Basic) + 1 (Extra) + 1 (отдельный скан) = 4
    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(96);

    const gauzeLines = listOperationLines(ctx.db, operation.id).filter(
      (l) => l.itemId === gauze.id,
    );
    expect(gauzeLines).toHaveLength(3);
    expect(gauzeLines.find((l) => l.sourcePackId === pack.id)!.quantity).toBe(2);
    expect(gauzeLines.find((l) => l.sourcePackId === extraPack.id)!.quantity).toBe(1);
    expect(gauzeLines.find((l) => l.sourceType === 'individual')!.quantity).toBe(1);
  });
});

describe('Пак не имеет собственного остатка (§6.5, §18.10)', () => {
  it('в схеме packs нет ни одного столбца количества или стоимости', () => {
    const ctx = setupTestDb();
    const columns = (
      ctx.sqlite.prepare('PRAGMA table_info(packs)').all() as { name: string }[]
    ).map((c) => c.name);

    expect(columns).not.toContain('current_quantity');
    expect(columns).not.toContain('quantity');
    expect(columns.some((c) => c.includes('cost'))).toBe(false);
  });
});
