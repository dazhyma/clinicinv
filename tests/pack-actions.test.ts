/**
 * Слой действий над паками (§6, §3.2, §18.6, §18.7, §18.17, §18.22).
 *
 * Действия вызываются НАПРЯМУЮ, минуя HTTP и UI: это модель атаки из AC-6.2
 * (шаг 11) — «кнопку восстановили в браузере и отправили запрос».
 */
import { describe, expect, it } from 'vitest';
import {
  createPackAction,
  getPackForActor,
  listPacksForActor,
  updatePackAction,
} from '@/actions/packs';
import { getItem, updateItem } from '@/domain/items';
import { getPackComposition, listPacks } from '@/domain/packs';
import { findStockInvariantMismatches } from '@/domain/movements';
import {
  addPackToOperation,
  finishOperation,
  listOperationLines,
  operationTotalCents,
  getOperation,
  startOperation,
} from '@/domain/operations';
import { SETTING_KEYS, setSetting } from '@/domain/settings';
import { FIXTURES, makeItem, nextClientEventId, setupTestDb } from './helpers';

function expectFailure(result: { ok: boolean }) {
  expect(result.ok).toBe(false);
  return result as { ok: false; error: string; code: string; fieldErrors?: Record<string, string> };
}

function expectSuccess<T>(result: { ok: boolean }) {
  if (!result.ok) throw new Error(`Expected success, got: ${JSON.stringify(result)}`);
  return result as unknown as { ok: true; data: T };
}

function buildScenario() {
  const ctx = setupTestDb();
  const gauze = makeItem(ctx, { ...FIXTURES.gauze, quantity: 100 });
  const gloves = makeItem(ctx, FIXTURES.gloves);
  const syringe = makeItem(ctx, FIXTURES.syringe);
  const mask = makeItem(ctx, FIXTURES.mask);

  const created = expectSuccess<{ packId: number; internalCode: string }>(
    createPackAction(ctx.db, ctx.admin, {
      name: 'Basic Pack',
      components: [
        { itemId: String(gauze.id), quantity: '2' },
        { itemId: String(gloves.id), quantity: '3' },
        { itemId: String(syringe.id), quantity: '1' },
      ],
    }),
  ).data;

  return { ctx, gauze, gloves, syringe, mask, packId: created.packId, code: created.internalCode };
}

// --- §3.2, §18.22 -----------------------------------------------------------

describe('Staff получает отказ по каждому Admin-действию с паками', () => {
  it('Add New Pack отклоняется, ни один пак не создан', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    const result = expectFailure(
      createPackAction(ctx.db, ctx.staff, {
        name: 'Staff Pack',
        components: [{ itemId: String(item.id), quantity: '2' }],
      }),
    );

    expect(result.code).toBe('FORBIDDEN');
    expect(result.error).toMatch(/permission/i);
    expect(listPacks(ctx.db, { includeInactive: true })).toHaveLength(0);
  });

  it('Edit Pack отклоняется: название, заметки, статус и состав не изменились', () => {
    const { ctx, packId, mask } = buildScenario();
    const before = getPackForActor(ctx.db, ctx.admin, packId)!;

    const result = expectFailure(
      updatePackAction(ctx.db, ctx.staff, packId, {
        name: 'Renamed by staff',
        notes: 'staff note',
        status: 'inactive',
        components: [{ itemId: String(mask.id), quantity: '9' }],
      }),
    );

    expect(result.code).toBe('FORBIDDEN');

    const after = getPackForActor(ctx.db, ctx.admin, packId)!;
    expect(after.name).toBe(before.name);
    expect(after.notes).toBe(before.notes);
    expect(after.status).toBe('active');
    expect(after.components.map((c) => [c.itemId, c.quantity])).toEqual(
      before.components.map((c) => [c.itemId, c.quantity]),
    );
    expect(after.costCents).toBe(before.costCents);
  });

  it('отказ приходит до валидации: пустая форма Staff даёт FORBIDDEN, а не список полей', () => {
    const ctx = setupTestDb();

    const result = expectFailure(createPackAction(ctx.db, ctx.staff, {}));
    expect(result.code).toBe('FORBIDDEN');
    expect(result.fieldErrors).toBeUndefined();
  });

  it('Staff может читать список паков и их состав (§3.2)', () => {
    const { ctx, packId } = buildScenario();

    const result = listPacksForActor(ctx.db, ctx.staff, {});
    expect(result.packs).toHaveLength(1);
    expect(result.packs[0]!.id).toBe(packId);
    expect(result.packs[0]!.components).toHaveLength(3);
  });
});

// --- §6.4 -------------------------------------------------------------------

describe('Стоимость пака — сумма по текущим ценам (§6.4)', () => {
  it('2×$3.00 + 3×$0.50 + 1×$1.20 = $8.70', () => {
    const { ctx, packId } = buildScenario();
    const pack = getPackForActor(ctx.db, ctx.admin, packId)!;

    expect(pack.costCents).toBe(870);
    expect(pack.costFormatted).toBe('$8.70');

    const gauzeLine = pack.components.find((c) => c.name === FIXTURES.gauze.name)!;
    expect(gauzeLine.unitCostCents).toBe(300);
    expect(gauzeLine.lineTotalCents).toBe(600);
    expect(gauzeLine.lineTotalFormatted).toBe('$6.00');
  });

  it('изменение цены предмета пересчитывает стоимость пака: $8.70 → $11.20', () => {
    const { ctx, gauze, packId } = buildScenario();

    updateItem(ctx.db, ctx.admin, gauze.id, { currentUnitCostCents: 425 });

    const pack = getPackForActor(ctx.db, ctx.admin, packId)!;
    expect(pack.costCents).toBe(1120);
    expect(pack.costFormatted).toBe('$11.20');
  });

  it('изменение состава пересчитывает стоимость, но не порождает движений остатков (§6.5)', () => {
    const { ctx, gauze, gloves, syringe, mask, packId } = buildScenario();

    expectSuccess(
      updatePackAction(ctx.db, ctx.admin, packId, {
        name: 'Basic Pack',
        components: [
          { itemId: String(gauze.id), quantity: '4' },
          { itemId: String(gloves.id), quantity: '3' },
          { itemId: String(syringe.id), quantity: '1' },
          { itemId: String(mask.id), quantity: '1' },
        ],
      }),
    );

    const pack = getPackForActor(ctx.db, ctx.admin, packId)!;
    // 4×3.00 + 3×0.50 + 1×1.20 + 1×0.25 = $14.95
    expect(pack.costCents).toBe(1495);
    expect(pack.totalUnits).toBe(9);
    expect(pack.componentCount).toBe(4);

    // Остатки предметов нетронуты: пак — не складской объект (§6.5, §18.10).
    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(100);
    expect(getItem(ctx.db, mask.id)!.currentQuantity).toBe(100);
    expect(findStockInvariantMismatches(ctx.db)).toEqual([]);
  });

  it('в представлении пака нет собственного остатка (§6.5, §18.10)', () => {
    const { ctx, packId } = buildScenario();
    const pack = getPackForActor(ctx.db, ctx.admin, packId)!;

    expect('currentQuantity' in pack).toBe(false);
    expect('quantity' in pack).toBe(false);
    expect('inStock' in pack).toBe(false);
  });
});

// --- §6.7, §18.17 -----------------------------------------------------------

describe('Изменение состава пака не меняет завершённую операцию (§6.7)', () => {
  it('состав, количества и итог завершённой операции остаются исходными', () => {
    const { ctx, gauze, gloves, syringe, mask, packId } = buildScenario();

    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id });
    addPackToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      packId,
      clientEventId: nextClientEventId('packscan'),
    });
    const finished = finishOperation(ctx.db, ctx.staff, operation.id);
    expect(finished.totalCostSnapshotCents).toBe(870);

    // Через слой действий: состав переписан целиком, цена предмета изменена.
    expectSuccess(
      updatePackAction(ctx.db, ctx.admin, packId, {
        name: 'Basic Pack v2',
        components: [
          { itemId: String(gauze.id), quantity: '4' },
          { itemId: String(mask.id), quantity: '1' },
        ],
      }),
    );
    updateItem(ctx.db, ctx.admin, gauze.id, { currentUnitCostCents: 425 });

    const lines = listOperationLines(ctx.db, operation.id);
    expect(lines).toHaveLength(3);
    expect(lines.find((l) => l.itemId === gauze.id)!.quantity).toBe(2);
    expect(lines.find((l) => l.itemId === gauze.id)!.unitCostSnapshotCents).toBe(300);
    expect(lines.find((l) => l.itemId === gloves.id)!.quantity).toBe(3);
    expect(lines.find((l) => l.itemId === syringe.id)!.quantity).toBe(1);
    expect(lines.find((l) => l.itemId === mask.id)).toBeUndefined();
    expect(operationTotalCents(ctx.db, getOperation(ctx.db, operation.id)!)).toBe(870);

    // А текущая расчётная стоимость пака уже другая: 4×4.25 + 1×0.25 = $17.25.
    expect(getPackForActor(ctx.db, ctx.admin, packId)!.costCents).toBe(1725);
  });
});

// --- §5.5, §18.6, §18.7 -----------------------------------------------------

describe('Внутренний код пака уникален и постоянен', () => {
  it('код выдаётся системой в формате PCK-000000 и не повторяется', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    const codes = new Set<string>();
    for (let index = 0; index < 5; index += 1) {
      const created = expectSuccess<{ internalCode: string }>(
        createPackAction(ctx.db, ctx.admin, {
          name: `Pack ${index}`,
          components: [{ itemId: String(item.id), quantity: '1' }],
        }),
      ).data;
      expect(created.internalCode).toMatch(/^PCK-\d{6}$/);
      codes.add(created.internalCode);
    }

    expect(codes.size).toBe(5);
  });

  it('редактирование названия, фото, состава, заметок и статуса код не меняет', () => {
    const { ctx, mask, packId, code } = buildScenario();
    const before = getPackForActor(ctx.db, ctx.admin, packId)!;

    expectSuccess(
      updatePackAction(ctx.db, ctx.admin, packId, {
        name: 'Completely different name',
        notes: 'new notes',
        status: 'inactive',
        photoUrl: '/api/photos/abcdef0123456789abcdef0123456789',
        components: [{ itemId: String(mask.id), quantity: '7' }],
      }),
    );

    const after = getPackForActor(ctx.db, ctx.admin, packId)!;
    expect(after.internalCode).toBe(code);
    expect(after.internalCode).toBe(before.internalCode);
    expect(after.barcodeValue).toBe(before.barcodeValue);
    // Изменения при этом действительно применились.
    expect(after.name).toBe('Completely different name');
    expect(after.components).toHaveLength(1);
  });

  it('форма не может подменить код: доменный слой отвергает такую попытку', () => {
    const { ctx, packId, code } = buildScenario();

    // `PackFormInput` не содержит этих полей вовсе, поэтому подмена возможна
    // только вызовом домена напрямую — и он её отвергает (§18.7).
    expect(() =>
      // @ts-expect-error — проверяется именно защита от поля, которого в типе нет.
      updatePackAction(ctx.db, ctx.admin, packId, { name: 'x', internalCode: 'PCK-999999' }),
    ).not.toThrow();
    expect(getPackForActor(ctx.db, ctx.admin, packId)!.internalCode).toBe(code);
  });

  it('уникальность держит БД, а не только приложение (§18.6)', () => {
    const { ctx, code } = buildScenario();

    expect(() =>
      ctx.sqlite
        .prepare(
          'insert into barcode_registry (barcode_value, owner_type, owner_id, created_at) values (?, ?, ?, ?)',
        )
        .run(code, 'item', 999, Date.now()),
    ).toThrow(/UNIQUE|constraint/i);

    expect(() =>
      ctx.sqlite
        .prepare(
          'insert into packs (internal_code, barcode_value, name, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
        )
        .run(code, code, 'Clone', 'active', Date.now(), Date.now()),
    ).toThrow(/UNIQUE|constraint/i);
  });
});

// --- §3.2, D-18 -------------------------------------------------------------

describe('Себестоимость пака для Staff (настройка staff_can_see_cost)', () => {
  it('при выключенной настройке полей стоимости нет в ответе вовсе', () => {
    const { ctx, packId } = buildScenario();

    const view = getPackForActor(ctx.db, ctx.staff, packId)!;

    expect('costCents' in view).toBe(false);
    expect('costFormatted' in view).toBe(false);
    for (const component of view.components) {
      expect('unitCostCents' in component).toBe(false);
      expect('unitCostFormatted' in component).toBe(false);
      expect('lineTotalCents' in component).toBe(false);
      expect('lineTotalFormatted' in component).toBe(false);
    }
    // Состав и количества при этом видны: Staff сканирует паки (§3.2).
    expect(view.components.map((c) => c.quantity)).toEqual([2, 3, 1]);
    expect(view.totalUnits).toBe(6);
    expect(listPacksForActor(ctx.db, ctx.staff, {}).showCost).toBe(false);
  });

  it('при включённой настройке Staff видит ту же стоимость, что и Admin', () => {
    const { ctx, packId } = buildScenario();
    setSetting(ctx.db, SETTING_KEYS.staffCanSeeCost, 'true');

    const view = getPackForActor(ctx.db, ctx.staff, packId)!;
    expect(view.costCents).toBe(870);
    expect(view.components[0]!.unitCostFormatted).toBe('$3.00');
  });

  it('Admin видит стоимость независимо от настройки', () => {
    const { ctx, packId } = buildScenario();
    setSetting(ctx.db, SETTING_KEYS.staffCanSeeCost, 'false');

    expect(getPackForActor(ctx.db, ctx.admin, packId)!.costCents).toBe(870);
  });
});

// --- §6.3, §14.4 ------------------------------------------------------------

describe('Валидация формы пака (§6.3, §14.4)', () => {
  it('название обязательно', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    const result = expectFailure(
      createPackAction(ctx.db, ctx.admin, {
        name: '   ',
        components: [{ itemId: String(item.id), quantity: '1' }],
      }),
    );

    expect(result.fieldErrors?.name).toMatch(/Pack Name is required/i);
    expect(listPacks(ctx.db, { includeInactive: true })).toHaveLength(0);
  });

  it('пак без единой позиции не сохраняется', () => {
    const ctx = setupTestDb();

    const result = expectFailure(
      createPackAction(ctx.db, ctx.admin, { name: 'Empty', components: [] }),
    );
    expect(result.fieldErrors?.components).toMatch(/at least one item/i);
  });

  it('пустые строки формы игнорируются, а не считаются ошибкой', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    const created = expectSuccess<{ packId: number }>(
      createPackAction(ctx.db, ctx.admin, {
        name: 'Single',
        components: [
          { itemId: String(item.id), quantity: '2' },
          { itemId: '', quantity: '' },
        ],
      }),
    ).data;

    expect(getPackComposition(ctx.db, created.packId)).toHaveLength(1);
  });

  it('количество меньше единицы отклоняется с указанием строки', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    const result = expectFailure(
      createPackAction(ctx.db, ctx.admin, {
        name: 'Zero',
        components: [{ itemId: String(item.id), quantity: '0' }],
      }),
    );
    expect(result.fieldErrors?.['component-0-quantity']).toMatch(/1 or more/i);
  });

  it('один предмет дважды в одном паке — ошибка с указанием строки', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    const result = expectFailure(
      createPackAction(ctx.db, ctx.admin, {
        name: 'Duplicated',
        components: [
          { itemId: String(item.id), quantity: '1' },
          { itemId: String(item.id), quantity: '2' },
        ],
      }),
    );
    expect(result.fieldErrors?.['component-1-itemId']).toMatch(/already listed in row 1/i);
  });

  it('несуществующий предмет отклоняется конкретным сообщением', () => {
    const ctx = setupTestDb();

    const result = expectFailure(
      createPackAction(ctx.db, ctx.admin, {
        name: 'Ghost',
        components: [{ itemId: '4242', quantity: '1' }],
      }),
    );
    expect(result.fieldErrors?.['component-0-itemId']).toBe('Item not found');
  });

  it('редактирование несуществующего пака даёт «Pack not found»', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    const result = expectFailure(
      updatePackAction(ctx.db, ctx.admin, 999, {
        name: 'Ghost',
        components: [{ itemId: String(item.id), quantity: '1' }],
      }),
    );
    expect(result.error).toBe('Pack not found');
  });

  it('один предмет может входить в несколько паков (§6.5)', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    expectSuccess(
      createPackAction(ctx.db, ctx.admin, {
        name: 'Pack A',
        components: [{ itemId: String(item.id), quantity: '1' }],
      }),
    );
    expectSuccess(
      createPackAction(ctx.db, ctx.admin, {
        name: 'Pack B',
        components: [{ itemId: String(item.id), quantity: '5' }],
      }),
    );

    const packs = listPacksForActor(ctx.db, ctx.admin, {}).packs;
    expect(packs).toHaveLength(2);
    expect(packs.map((p) => p.totalUnits).sort()).toEqual([1, 5]);
  });

  it('неактивные паки скрыты от Staff даже при явном запросе', () => {
    const { ctx, packId } = buildScenario();
    expectSuccess(
      updatePackAction(ctx.db, ctx.admin, packId, {
        name: 'Basic Pack',
        status: 'inactive',
        components: [{ itemId: String(buildScenarioItemId(ctx, packId)), quantity: '1' }],
      }),
    );

    expect(listPacksForActor(ctx.db, ctx.staff, { includeInactive: true }).packs).toHaveLength(0);
    expect(listPacksForActor(ctx.db, ctx.admin, { includeInactive: true }).packs).toHaveLength(1);
  });
});

/** Первый предмет состава пака — чтобы не тащить в тест лишние идентификаторы. */
function buildScenarioItemId(ctx: ReturnType<typeof setupTestDb>, packId: number): number {
  return getPackComposition(ctx.db, packId)[0]!.item.id;
}
