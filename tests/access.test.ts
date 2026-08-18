/**
 * AC-6.2 / §3.2 / §18.22 — разграничение Staff/Admin проверяется на сервере.
 *
 * Тесты вызывают доменные сервисы НАПРЯМУЮ, минуя UI и HTTP: именно так
 * выглядит «воссоздать Admin-кнопку в браузере и отправить запрос».
 */
import { describe, expect, it } from 'vitest';
import { getItem, adjustStock, createItem, receiveStock, updateItem } from '@/domain/items';
import { createPack, updatePack } from '@/domain/packs';
import {
  addItemToOperation,
  finishOperation,
  startOperation,
  voidOperation,
} from '@/domain/operations';
import {
  applyInventoryCount,
  cancelInventoryCount,
  startInventoryCount,
  upsertCountLine,
} from '@/domain/inventory-count';
import { SETTING_KEYS, setSetting } from '@/domain/settings';
import { FIXTURES, makeItem, nextClientEventId, setupTestDb } from './helpers';

describe('Staff не получает полный Admin-доступ', () => {
  it('создание предмета отклоняется', () => {
    const ctx = setupTestDb();
    expect(() =>
      createItem(ctx.db, ctx.staff, {
        name: 'Contraband',
        currentUnitCostCents: 100,
        unitOfMeasurement: 'each',
        initialQuantity: 5,
      }),
    ).toThrow(/permission/i);
  });

  it('редактирование предмета и смена стоимости отклоняются', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    expect(() => updateItem(ctx.db, ctx.staff, item.id, { name: 'Renamed' })).toThrow(
      /permission/i,
    );
    expect(() =>
      updateItem(ctx.db, ctx.staff, item.id, { currentUnitCostCents: 999 }),
    ).toThrow(/permission/i);

    const unchanged = getItem(ctx.db, item.id)!;
    expect(unchanged.name).toBe('Gauze 4x4');
    expect(unchanged.currentUnitCostCents).toBe(300);
  });

  it('Receive Stock разрешён, а ручная корректировка по-прежнему отклоняется', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    receiveStock(ctx.db, ctx.staff, {
      itemId: item.id,
      quantity: 20,
      clientEventId: nextClientEventId('recv'),
    });

    expect(() =>
      adjustStock(ctx.db, ctx.staff, {
        itemId: item.id,
        change: { type: 'delta', delta: -5 },
        reason: 'missing',
        clientEventId: nextClientEventId('adj'),
      }),
    ).toThrow(/permission/i);

    expect(getItem(ctx.db, item.id)!.currentQuantity).toBe(30);
  });

  it('себестоимость поставки Staff меняет только при включённой настройке', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    expect(() =>
      receiveStock(ctx.db, ctx.staff, {
        itemId: item.id,
        quantity: 5,
        newUnitCostCents: 425,
        clientEventId: nextClientEventId('recv'),
      }),
    ).toThrow(/permission/i);
    expect(getItem(ctx.db, item.id)!.currentQuantity).toBe(10);
    expect(getItem(ctx.db, item.id)!.currentUnitCostCents).toBe(300);

    setSetting(ctx.db, SETTING_KEYS.staffCanSeeCost, 'true');
    receiveStock(ctx.db, ctx.staff, {
      itemId: item.id,
      quantity: 5,
      newUnitCostCents: 425,
      clientEventId: nextClientEventId('recv'),
    });
    expect(getItem(ctx.db, item.id)!.currentQuantity).toBe(15);
    expect(getItem(ctx.db, item.id)!.currentUnitCostCents).toBe(425);
  });

  it('создание и изменение пака отклоняются', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);
    const pack = createPack(ctx.db, ctx.admin, {
      name: 'Basic Pack',
      composition: [{ itemId: item.id, quantity: 1 }],
    });

    expect(() =>
      createPack(ctx.db, ctx.staff, {
        name: 'Staff Pack',
        composition: [{ itemId: item.id, quantity: 1 }],
      }),
    ).toThrow(/permission/i);

    expect(() => updatePack(ctx.db, ctx.staff, pack.id, { name: 'Renamed' })).toThrow(
      /permission/i,
    );
  });

  it('Staff может провести инвентаризацию во всех фазах', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);
    const count = startInventoryCount(ctx.db, ctx.staff);

    upsertCountLine(ctx.db, ctx.staff, {
      countId: count.id,
      itemId: item.id,
      countedQuantity: 7,
    });
    applyInventoryCount(ctx.db, ctx.staff, count.id);
    expect(getItem(ctx.db, item.id)!.currentQuantity).toBe(7);

    const cancelled = startInventoryCount(ctx.db, ctx.staff);
    cancelInventoryCount(ctx.db, ctx.staff, cancelled.id);
    expect(getItem(ctx.db, item.id)!.currentQuantity).toBe(7);
  });

  it('Void операции отклоняется', () => {
    const ctx = setupTestDb();
    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    expect(() => voidOperation(ctx.db, ctx.staff, operation.id)).toThrow(/permission/i);
  });
});

describe('Staff может выполнять свои действия (§3.2)', () => {
  it('начать операцию, сканировать и завершить', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    addItemToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      itemId: item.id,
      clientEventId: nextClientEventId('scan'),
    });
    const finished = finishOperation(ctx.db, ctx.staff, operation.id);

    expect(finished.status).toBe('Finished');
    expect(getItem(ctx.db, item.id)!.currentQuantity).toBe(9);
  });
});

describe('Admin выполняет всё', () => {
  it('полный административный цикл проходит', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    updateItem(ctx.db, ctx.admin, item.id, { currentUnitCostCents: 425, name: 'Gauze sterile' });
    receiveStock(ctx.db, ctx.admin, {
      itemId: item.id,
      quantity: 5,
      clientEventId: nextClientEventId('recv'),
    });
    adjustStock(ctx.db, ctx.admin, {
      itemId: item.id,
      change: { type: 'delta', delta: -1 },
      reason: 'damaged',
      clientEventId: nextClientEventId('adj'),
    });

    const updated = getItem(ctx.db, item.id)!;
    expect(updated.name).toBe('Gauze sterile');
    expect(updated.currentUnitCostCents).toBe(425);
    expect(updated.currentQuantity).toBe(14);
  });
});

describe('Инвентаризация (§5.10)', () => {
  it('черновик хранится на сервере и применяется движениями count_correction', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, { ...FIXTURES.mask, quantity: 100 });

    const count = startInventoryCount(ctx.db, ctx.admin);
    const line = upsertCountLine(ctx.db, ctx.admin, {
      countId: count.id,
      itemId: item.id,
      countedQuantity: 97,
    });

    expect(line.expectedQuantity).toBe(100);
    expect(line.difference).toBe(-3);
    // Остаток до подтверждения не тронут.
    expect(getItem(ctx.db, item.id)!.currentQuantity).toBe(100);

    const applied = applyInventoryCount(ctx.db, ctx.admin, count.id);
    expect(applied.count.status).toBe('applied');
    expect(getItem(ctx.db, item.id)!.currentQuantity).toBe(97);

    // Повторное применение невозможно.
    expect(() => applyInventoryCount(ctx.db, ctx.admin, count.id)).toThrow(/already closed/i);
    expect(getItem(ctx.db, item.id)!.currentQuantity).toBe(97);
  });
});
