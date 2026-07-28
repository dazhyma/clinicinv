/**
 * Слой действий (`src/actions/*`): роли, редактирование стоимости, валидация,
 * идемпотентность и поиск.
 *
 * Действия вызываются НАПРЯМУЮ, минуя HTTP и UI — это и есть модель атаки из
 * AC-6.2 (шаг 11): «кнопку восстановили в браузере и отправили запрос».
 */
import { describe, expect, it } from 'vitest';
import {
  adjustStockAction,
  createItemAction,
  getItemForActor,
  listItemsForActor,
  receiveStockAction,
  updateItemAction,
} from '@/actions/items';
import { updateSettingsAction } from '@/actions/settings';
import { findBarcodeOwner } from '@/domain/codes';
import { getItem } from '@/domain/items';
import { SETTING_KEYS, getNegativeStockMode, setSetting, staffCanSeeCost } from '@/domain/settings';
import { FIXTURES, makeItem, nextClientEventId, setupTestDb } from './helpers';

function expectFailure(result: { ok: boolean }) {
  expect(result.ok).toBe(false);
  return result as { ok: false; error: string; code: string; fieldErrors?: Record<string, string> };
}

function expectSuccess<T>(result: { ok: boolean }) {
  if (!result.ok) {
    throw new Error(`Expected success, got: ${JSON.stringify(result)}`);
  }
  return result as unknown as { ok: true; data: T };
}

// --- Матрица прав Staff: два inventory-процесса без полного Admin-доступа -----

describe('Слой действий: точечные права Staff', () => {
  it('Add New Item отклоняется, предмет не создан', () => {
    const ctx = setupTestDb();

    const result = expectFailure(
      createItemAction(ctx.db, ctx.staff, {
        name: 'Contraband',
        costPerUnit: '1.00',
        unitOfMeasurement: 'each',
        initialQuantity: '5',
      }),
    );

    expect(result.code).toBe('FORBIDDEN');
    expect(result.error).toMatch(/permission/i);
    expect(listItemsForActor(ctx.db, ctx.admin, {}).items).toHaveLength(0);
  });

  it('Edit отклоняется, название и стоимость не изменились', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    const result = expectFailure(
      updateItemAction(ctx.db, ctx.staff, item.id, {
        name: 'Renamed by staff',
        costPerUnit: '99.00',
        unitOfMeasurement: 'each',
      }),
    );

    expect(result.code).toBe('FORBIDDEN');
    const unchanged = getItem(ctx.db, item.id)!;
    expect(unchanged.name).toBe(FIXTURES.gauze.name);
    expect(unchanged.currentUnitCostCents).toBe(FIXTURES.gauze.costCents);
  });

  it('Receive Stock доступен и создаёт приход для Staff', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    const result = expectSuccess<{ quantityAfter: number; applied: boolean }>(
      receiveStockAction(ctx.db, ctx.staff, {
        itemId: item.id,
        quantity: '20',
        clientEventId: nextClientEventId('recv'),
      }),
    );

    expect(result.data.applied).toBe(true);
    expect(result.data.quantityAfter).toBe(30);
    expect(getItem(ctx.db, item.id)!.currentQuantity).toBe(30);
  });

  it('ручная корректировка отклоняется, остаток не изменился', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    const result = expectFailure(
      adjustStockAction(ctx.db, ctx.staff, {
        itemId: item.id,
        mode: 'delta',
        amount: '-5',
        reason: 'missing',
        clientEventId: nextClientEventId('adj'),
      }),
    );

    expect(result.code).toBe('FORBIDDEN');
    expect(getItem(ctx.db, item.id)!.currentQuantity).toBe(FIXTURES.gauze.quantity);
  });

  it('изменение настроек отклоняется, значения остались прежними', () => {
    const ctx = setupTestDb();

    const result = expectFailure(
      updateSettingsAction(ctx.db, ctx.staff, {
        staffCanSeeCost: 'true',
        negativeStockMode: 'block',
      }),
    );

    expect(result.code).toBe('FORBIDDEN');
    expect(staffCanSeeCost(ctx.db)).toBe(false);
    expect(getNegativeStockMode(ctx.db)).toBe('warn');
  });

  it('Admin выполняет те же действия успешно', () => {
    const ctx = setupTestDb();

    const created = expectSuccess<{ itemId: number; internalCode: string }>(
      createItemAction(ctx.db, ctx.admin, {
        name: 'Gauze 4x4',
        costPerUnit: '3.25',
        unitOfMeasurement: 'each',
        initialQuantity: '10',
      }),
    );
    expect(created.data.internalCode).toMatch(/^ITM-\d{6}$/);

    expectSuccess(
      receiveStockAction(ctx.db, ctx.admin, {
        itemId: created.data.itemId,
        quantity: '5',
        clientEventId: nextClientEventId('recv'),
      }),
    );
    expect(getItem(ctx.db, created.data.itemId)!.currentQuantity).toBe(15);
  });
});

describe('SKU определяет текущее значение штрихкода', () => {
  it('использует SKU при создании, а без SKU — автоматический internal code', () => {
    const ctx = setupTestDb();
    const withSku = expectSuccess<{ itemId: number; internalCode: string }>(
      createItemAction(ctx.db, ctx.admin, {
        name: 'Needle',
        costPerUnit: '1.25',
        unitOfMeasurement: 'each',
        initialQuantity: '0',
        sku: ' needle-42 ',
      }),
    );
    const automatic = expectSuccess<{ itemId: number; internalCode: string }>(
      createItemAction(ctx.db, ctx.admin, {
        name: 'Gauze',
        costPerUnit: '2.00',
        unitOfMeasurement: 'each',
        initialQuantity: '0',
        sku: '   ',
      }),
    );

    expect(getItem(ctx.db, withSku.data.itemId)).toMatchObject({
      sku: 'needle-42',
      barcodeValue: 'NEEDLE-42',
    });
    expect(getItem(ctx.db, automatic.data.itemId)?.barcodeValue).toBe(
      automatic.data.internalCode,
    );
  });

  it('при Edit синхронизирует штрихкод, сохраняя прежние коды как алиасы', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze, { sku: 'OLD-SKU' });
    const internalCode = item.internalCode;

    expectSuccess(
      updateItemAction(ctx.db, ctx.admin, item.id, {
        name: item.name,
        costPerUnit: '3.00',
        unitOfMeasurement: 'each',
        sku: 'new-sku',
      }),
    );

    expect(getItem(ctx.db, item.id)).toMatchObject({
      internalCode,
      sku: 'new-sku',
      barcodeValue: 'NEW-SKU',
    });
    for (const alias of [internalCode, 'OLD-SKU', 'NEW-SKU']) {
      expect(findBarcodeOwner(ctx.db, alias)).toMatchObject({
        ownerType: 'item',
        ownerId: item.id,
      });
    }

    expectSuccess(
      updateItemAction(ctx.db, ctx.admin, item.id, {
        name: item.name,
        costPerUnit: '3.00',
        unitOfMeasurement: 'each',
        sku: '',
      }),
    );
    expect(getItem(ctx.db, item.id)?.barcodeValue).toBe(internalCode);
  });

  it('не позволяет двум объектам использовать один SKU как штрихкод', () => {
    const ctx = setupTestDb();
    makeItem(ctx, FIXTURES.gauze, { sku: 'SHARED-SKU' });

    const duplicate = expectFailure(
      createItemAction(ctx.db, ctx.admin, {
        name: 'Another item',
        costPerUnit: '1.00',
        unitOfMeasurement: 'each',
        initialQuantity: '0',
        sku: 'shared-sku',
      }),
    );

    expect(duplicate.code).toBe('VALIDATION_FAILED');
    expect(duplicate.fieldErrors?.sku).toMatch(/already assigned/i);
  });
});

// --- §3.2, Q-1: себестоимость не попадает в ответ при выключенной настройке --

describe('Себестоимость для Staff (§3.2, настройка staff_can_see_cost)', () => {
  it('при выключенной настройке полей стоимости в ответе НЕТ вовсе', () => {
    const ctx = setupTestDb();
    makeItem(ctx, FIXTURES.gauze);

    const staffResult = listItemsForActor(ctx.db, ctx.staff, {});
    const view = staffResult.items[0]!;

    expect(staffResult.showCost).toBe(false);
    // Именно отсутствие ключа, а не пустая строка и не скрытие в CSS.
    expect('unitCostCents' in view).toBe(false);
    expect('unitCostFormatted' in view).toBe(false);
    // Остатки Staff видит — §3.2 это прямо разрешает.
    expect(view.currentQuantity).toBe(FIXTURES.gauze.quantity);
  });

  it('карточка одного предмета для Staff тоже не содержит стоимости', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    const view = getItemForActor(ctx.db, ctx.staff, item.id)!;
    expect('unitCostCents' in view).toBe(false);
  });

  it('Admin видит стоимость всегда', () => {
    const ctx = setupTestDb();
    makeItem(ctx, FIXTURES.gauze);

    const view = listItemsForActor(ctx.db, ctx.admin, {}).items[0]!;
    expect(view.unitCostCents).toBe(FIXTURES.gauze.costCents);
    expect(view.unitCostFormatted).toBe('$3.00');
  });

  it('после включения настройки Staff начинает получать стоимость', () => {
    const ctx = setupTestDb();
    makeItem(ctx, FIXTURES.gauze);

    expectSuccess(
      updateSettingsAction(ctx.db, ctx.admin, {
        staffCanSeeCost: 'true',
        negativeStockMode: 'warn',
      }),
    );

    const view = listItemsForActor(ctx.db, ctx.staff, {}).items[0]!;
    expect(view.unitCostCents).toBe(FIXTURES.gauze.costCents);
  });

  it('Staff не может указать новую себестоимость, пока настройка выключена', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    const result = expectFailure(
      receiveStockAction(ctx.db, ctx.staff, {
        itemId: item.id,
        quantity: '5',
        newCostPerUnit: '4.25',
        clientEventId: nextClientEventId('recv'),
      }),
    );

    expect(result.code).toBe('FORBIDDEN');
    expect(getItem(ctx.db, item.id)!.currentQuantity).toBe(10);
    expect(getItem(ctx.db, item.id)!.currentUnitCostCents).toBe(300);
  });

  it('после включения настройки Staff может указать новую себестоимость поставки', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);
    setSetting(ctx.db, SETTING_KEYS.staffCanSeeCost, 'true');

    expectSuccess(
      receiveStockAction(ctx.db, ctx.staff, {
        itemId: item.id,
        quantity: '5',
        newCostPerUnit: '4.25',
        clientEventId: nextClientEventId('recv'),
      }),
    );

    expect(getItem(ctx.db, item.id)!.currentQuantity).toBe(15);
    expect(getItem(ctx.db, item.id)!.currentUnitCostCents).toBe(425);
  });
});

// --- §10.4, §16: идемпотентность --------------------------------------------

describe('Идемпотентность прихода и корректировки (§10.4, §16)', () => {
  it('повторная отправка того же ключа не начисляет поставку дважды', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);
    const clientEventId = nextClientEventId('recv');

    const first = expectSuccess<{ quantityAfter: number; applied: boolean }>(
      receiveStockAction(ctx.db, ctx.admin, { itemId: item.id, quantity: '20', clientEventId }),
    );
    const second = expectSuccess<{ quantityAfter: number; applied: boolean }>(
      receiveStockAction(ctx.db, ctx.admin, { itemId: item.id, quantity: '20', clientEventId }),
    );

    expect(first.data.applied).toBe(true);
    // Повтор — успех, а не ошибка: пользователь не должен думать, что сломалось.
    expect(second.data.applied).toBe(false);
    expect(first.data.quantityAfter).toBe(30);
    expect(second.data.quantityAfter).toBe(30);
    expect(getItem(ctx.db, item.id)!.currentQuantity).toBe(30);
  });

  it('новый ключ применяет поставку заново', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    receiveStockAction(ctx.db, ctx.admin, {
      itemId: item.id,
      quantity: '20',
      clientEventId: nextClientEventId('recv'),
    });
    receiveStockAction(ctx.db, ctx.admin, {
      itemId: item.id,
      quantity: '20',
      clientEventId: nextClientEventId('recv'),
    });

    expect(getItem(ctx.db, item.id)!.currentQuantity).toBe(50);
  });

  it('повторная корректировка с тем же ключом не списывает дважды', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);
    const clientEventId = nextClientEventId('adj');

    expectSuccess(
      adjustStockAction(ctx.db, ctx.admin, {
        itemId: item.id,
        mode: 'delta',
        amount: '-3',
        reason: 'damaged',
        clientEventId,
      }),
    );
    const second = expectSuccess<{ quantityAfter: number; applied: boolean }>(
      adjustStockAction(ctx.db, ctx.admin, {
        itemId: item.id,
        mode: 'delta',
        amount: '-3',
        reason: 'damaged',
        clientEventId,
      }),
    );

    expect(second.data.applied).toBe(false);
    expect(getItem(ctx.db, item.id)!.currentQuantity).toBe(7);
  });

  it('режим «установить в» пишет дельту и приходит к заданному количеству', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, { ...FIXTURES.mask, quantity: 100 });

    const result = expectSuccess<{ quantityAfter: number }>(
      adjustStockAction(ctx.db, ctx.admin, {
        itemId: item.id,
        mode: 'set',
        amount: '97',
        reason: 'inventory correction',
        clientEventId: nextClientEventId('adj'),
      }),
    );

    expect(result.data.quantityAfter).toBe(97);
  });
});

// --- §5.4: обязательность полей ---------------------------------------------

describe('Валидация формы Add New Item (§5.4)', () => {
  it('пустая форма даёт ошибку по каждому обязательному полю', () => {
    const ctx = setupTestDb();
    const result = expectFailure(createItemAction(ctx.db, ctx.admin, {}));

    expect(result.code).toBe('VALIDATION_FAILED');
    expect(result.fieldErrors).toMatchObject({
      name: 'Item Name is required',
      costPerUnit: 'Cost per Unit is required',
      unitOfMeasurement: 'Unit of Measurement is required',
      initialQuantity: 'Initial Quantity is required',
    });
    // Необязательные поля ошибок не дают.
    expect(result.fieldErrors?.sku).toBeUndefined();
    expect(result.fieldErrors?.notes).toBeUndefined();
  });

  it('Initial Quantity = 0 допустим (§5.4), предмет создаётся', () => {
    const ctx = setupTestDb();
    const created = expectSuccess<{ itemId: number }>(
      createItemAction(ctx.db, ctx.admin, {
        name: 'Empty box',
        costPerUnit: '0',
        unitOfMeasurement: 'box',
        initialQuantity: '0',
      }),
    );

    expect(getItem(ctx.db, created.data.itemId)!.currentQuantity).toBe(0);
  });

  it('пустое поле количества и «0» — разные вещи', () => {
    const ctx = setupTestDb();
    const result = expectFailure(
      createItemAction(ctx.db, ctx.admin, {
        name: 'Gauze',
        costPerUnit: '3.00',
        unitOfMeasurement: 'each',
        initialQuantity: '',
      }),
    );
    expect(result.fieldErrors?.initialQuantity).toBe('Initial Quantity is required');
  });

  it('отрицательная стоимость и нечисловая стоимость отклоняются', () => {
    const ctx = setupTestDb();

    const negative = expectFailure(
      createItemAction(ctx.db, ctx.admin, {
        name: 'Gauze',
        costPerUnit: '-1.00',
        unitOfMeasurement: 'each',
        initialQuantity: '1',
      }),
    );
    expect(negative.fieldErrors?.costPerUnit).toMatch(/negative/i);

    const garbage = expectFailure(
      createItemAction(ctx.db, ctx.admin, {
        name: 'Gauze',
        costPerUnit: 'free',
        unitOfMeasurement: 'each',
        initialQuantity: '1',
      }),
    );
    expect(garbage.fieldErrors?.costPerUnit).toBeDefined();
  });

  it('Receive Stock требует количество больше нуля и ключ идемпотентности', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    const zero = expectFailure(
      receiveStockAction(ctx.db, ctx.admin, {
        itemId: item.id,
        quantity: '0',
        clientEventId: nextClientEventId('recv'),
      }),
    );
    expect(zero.fieldErrors?.quantity).toBeDefined();

    const noKey = expectFailure(
      receiveStockAction(ctx.db, ctx.admin, { itemId: item.id, quantity: '5' }),
    );
    expect(noKey.fieldErrors?.clientEventId).toBeDefined();

    expect(getItem(ctx.db, item.id)!.currentQuantity).toBe(FIXTURES.gauze.quantity);
  });

  it('корректировка требует причину из списка §5.9', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    const missing = expectFailure(
      adjustStockAction(ctx.db, ctx.admin, {
        itemId: item.id,
        mode: 'delta',
        amount: '-1',
        clientEventId: nextClientEventId('adj'),
      }),
    );
    expect(missing.fieldErrors?.reason).toBe('Reason is required');

    const freeText = expectFailure(
      adjustStockAction(ctx.db, ctx.admin, {
        itemId: item.id,
        mode: 'delta',
        amount: '-1',
        reason: 'because I said so',
        clientEventId: nextClientEventId('adj'),
      }),
    );
    expect(freeText.fieldErrors?.reason).toMatch(/damaged, expired, missing/);

    const zeroDelta = expectFailure(
      adjustStockAction(ctx.db, ctx.admin, {
        itemId: item.id,
        mode: 'delta',
        amount: '0',
        reason: 'other',
        clientEventId: nextClientEventId('adj'),
      }),
    );
    expect(zeroDelta.fieldErrors?.amount).toMatch(/cannot be zero/i);

    expect(getItem(ctx.db, item.id)!.currentQuantity).toBe(FIXTURES.gauze.quantity);
  });
});

// --- §5.3: поиск и фильтры --------------------------------------------------

describe('Поиск и фильтры списка предметов (§5.3, §5.11)', () => {
  function seed() {
    const ctx = setupTestDb();
    const gauze = expectSuccess<{ itemId: number; internalCode: string }>(
      createItemAction(ctx.db, ctx.admin, {
        name: 'Gauze 4x4',
        costPerUnit: '3.00',
        unitOfMeasurement: 'each',
        initialQuantity: '10',
        sku: 'GZ-4X4',
        referenceNumber: 'REF-11223',
        category: 'Dressings',
        storageLocation: 'Shelf A',
        lowStockThreshold: '20',
      }),
    ).data;

    const gloves = expectSuccess<{ itemId: number; internalCode: string }>(
      createItemAction(ctx.db, ctx.admin, {
        name: 'Gloves L',
        costPerUnit: '0.50',
        unitOfMeasurement: 'pair',
        initialQuantity: '0',
        sku: 'GLV-L',
        referenceNumber: 'REF-99887',
        category: 'PPE',
        storageLocation: 'Shelf B',
      }),
    ).data;

    return { ctx, gauze, gloves };
  }

  it('находит по названию', () => {
    const { ctx } = seed();
    const found = listItemsForActor(ctx.db, ctx.admin, { q: 'Gloves' }).items;
    expect(found.map((item) => item.name)).toEqual(['Gloves L']);
  });

  it('находит по внутреннему коду', () => {
    const { ctx, gauze } = seed();
    const found = listItemsForActor(ctx.db, ctx.admin, { q: gauze.internalCode }).items;
    expect(found.map((item) => item.id)).toEqual([gauze.itemId]);
  });

  it('находит по SKU', () => {
    const { ctx, gauze } = seed();
    const found = listItemsForActor(ctx.db, ctx.admin, { q: 'GZ-4X4' }).items;
    expect(found.map((item) => item.id)).toEqual([gauze.itemId]);
  });

  it('находит по reference / catalog number', () => {
    const { ctx, gloves } = seed();
    const found = listItemsForActor(ctx.db, ctx.admin, { q: 'REF-99887' }).items;
    expect(found.map((item) => item.id)).toEqual([gloves.itemId]);
  });

  it('поиск работает и под Staff, но без стоимости', () => {
    const { ctx, gauze } = seed();
    const found = listItemsForActor(ctx.db, ctx.staff, { q: 'GZ-4X4' }).items;
    expect(found.map((item) => item.id)).toEqual([gauze.itemId]);
    expect('unitCostCents' in found[0]!).toBe(false);
  });

  it('фильтрует по категории и месту хранения', () => {
    const { ctx, gauze, gloves } = seed();

    expect(
      listItemsForActor(ctx.db, ctx.admin, { category: 'PPE' }).items.map((i) => i.id),
    ).toEqual([gloves.itemId]);

    expect(
      listItemsForActor(ctx.db, ctx.admin, { location: 'Shelf A' }).items.map((i) => i.id),
    ).toEqual([gauze.itemId]);
  });

  it('фильтрует по наличию', () => {
    const { ctx, gauze, gloves } = seed();

    expect(
      listItemsForActor(ctx.db, ctx.admin, { availability: 'in_stock' }).items.map((i) => i.id),
    ).toEqual([gauze.itemId]);

    expect(
      listItemsForActor(ctx.db, ctx.admin, { availability: 'out_of_stock' }).items.map((i) => i.id),
    ).toEqual([gloves.itemId]);
  });

  it('фильтр Low Stock показывает предмет на пороге и ниже (§5.11)', () => {
    const { ctx, gauze } = seed();
    const result = listItemsForActor(ctx.db, ctx.admin, { lowStock: true });

    // Порог 20, остаток 10 → предмет считается низким и выделяется.
    expect(result.items.map((i) => i.id)).toEqual([gauze.itemId]);
    expect(result.items[0]!.isLowStock).toBe(true);
    expect(result.lowStockCount).toBe(1);

    // Ровно на пороге — тоже низкий остаток.
    receiveStockAction(ctx.db, ctx.admin, {
      itemId: gauze.itemId,
      quantity: '10',
      clientEventId: nextClientEventId('recv'),
    });
    expect(listItemsForActor(ctx.db, ctx.admin, { lowStock: true }).items).toHaveLength(1);

    // На единицу выше порога — уже нет.
    receiveStockAction(ctx.db, ctx.admin, {
      itemId: gauze.itemId,
      quantity: '1',
      clientEventId: nextClientEventId('recv'),
    });
    expect(listItemsForActor(ctx.db, ctx.admin, { lowStock: true }).items).toHaveLength(0);
  });

  it('служебные символы LIKE не превращаются в шаблон', () => {
    const ctx = setupTestDb();
    createItemAction(ctx.db, ctx.admin, {
      name: 'Alcohol 70%',
      costPerUnit: '1.00',
      unitOfMeasurement: 'bottle',
      initialQuantity: '5',
    });
    createItemAction(ctx.db, ctx.admin, {
      name: 'Tape',
      costPerUnit: '1.00',
      unitOfMeasurement: 'roll',
      initialQuantity: '5',
    });

    expect(listItemsForActor(ctx.db, ctx.admin, { q: '%' }).items).toHaveLength(1);
  });

  it('неактивные предметы скрыты по умолчанию и не показываются Staff', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);
    updateItemAction(ctx.db, ctx.admin, item.id, {
      name: FIXTURES.gauze.name,
      costPerUnit: '3.00',
      unitOfMeasurement: 'each',
      status: 'inactive',
    });

    expect(listItemsForActor(ctx.db, ctx.admin, {}).items).toHaveLength(0);
    expect(listItemsForActor(ctx.db, ctx.admin, { includeInactive: true }).items).toHaveLength(1);
    // Staff административный срез не получает, даже если попросит.
    expect(listItemsForActor(ctx.db, ctx.staff, { includeInactive: true }).items).toHaveLength(0);
  });
});

// --- Дополнение заказчика: internal code постоянен, barcode следует за SKU ----

describe('Редактирование сохраняет внутренний код и синхронизирует штрихкод', () => {
  it('после смены SKU внутренний код тот же, а barcode использует новый SKU', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze, { sku: 'OLD', referenceNumber: 'OLD-REF' });
    const before = getItem(ctx.db, item.id)!;

    expectSuccess(
      updateItemAction(ctx.db, ctx.admin, item.id, {
        name: 'Gauze sterile',
        costPerUnit: '4.25',
        unitOfMeasurement: 'each',
        sku: 'NEW',
        referenceNumber: 'NEW-REF',
      }),
    );

    const after = getItem(ctx.db, item.id)!;
    expect(after.internalCode).toBe(before.internalCode);
    expect(after.barcodeValue).toBe('NEW');
    expect(after.name).toBe('Gauze sterile');
    expect(after.currentUnitCostCents).toBe(425);
    // Остаток формой редактирования не трогается (§10.4).
    expect(after.currentQuantity).toBe(before.currentQuantity);
  });

  it('настройка режима нехватки остатка сохраняется Admin', () => {
    const ctx = setupTestDb();
    setSetting(ctx.db, SETTING_KEYS.negativeStockMode, 'warn');

    expectSuccess(
      updateSettingsAction(ctx.db, ctx.admin, {
        staffCanSeeCost: 'false',
        negativeStockMode: 'block',
      }),
    );

    expect(getNegativeStockMode(ctx.db)).toBe('block');
  });
});
