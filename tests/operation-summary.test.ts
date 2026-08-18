/**
 * §12 — история, карточка завершённой операции и сводка для Symplast (спринт 5).
 *
 * Проверяется свойство, ради которого §11.3 и §18.16 вообще написаны: карточка и
 * сводка читают СНИМКИ строки операции, а не текущую цену предмета. Тест меняет
 * цену уже после Finish и требует, чтобы ни одна цифра на экране не сдвинулась.
 *
 * Отдельно проверяется приватность (§2.4, §18.3, FR-125): в сводке, из которой
 * данные переносят в Symplast руками, не должно быть ни одного поля, куда можно
 * вписать пациента.
 */
import { describe, expect, it } from 'vitest';
import {
  finishOperationAction,
  getOperationState,
  getOperationSummary,
  listOperationsForActor,
  scanIntoOperationAction,
  startOperationAction,
  voidOperationAction,
} from '@/actions/operations';
import { getItem, updateItem } from '@/domain/items';
import { setSetting, SETTING_KEYS } from '@/domain/settings';
import {
  FIXTURES,
  makeBasicPack,
  makeItem,
  nextClientEventId,
  setupTestDb,
  type TestContext,
} from './helpers';

function expectSuccess<T>(result: { ok: boolean }): { ok: true; data: T } {
  if (!result.ok) throw new Error(`Expected success, got: ${JSON.stringify(result)}`);
  return result as unknown as { ok: true; data: T };
}

function startOperation(ctx: TestContext, actor = ctx.staff) {
  return expectSuccess<{ operationId: number; caseCode: string }>(
    startOperationAction(ctx.db, actor, { doctorId: ctx.doctor.id, patientId: '000123' }),
  ).data;
}

function scan(ctx: TestContext, operationId: number, barcode: string, actor = ctx.staff) {
  return expectSuccess(
    scanIntoOperationAction(ctx.db, actor, {
      operationId,
      barcode,
      clientEventId: nextClientEventId('scan'),
    }),
  );
}

// --- §12.2: карточка завершённой операции -----------------------------------

describe('§12.2: карточка завершённой операции показывает снимки', () => {
  it('изменение текущей цены предмета после Finish не меняет ни строки, ни итог', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze, { referenceNumber: 'REF-1' }); // $3.00

    const operation = startOperation(ctx);
    scan(ctx, operation.operationId, gauze.barcodeValue);
    scan(ctx, operation.operationId, gauze.barcodeValue);
    expectSuccess(finishOperationAction(ctx.db, ctx.admin, operation.operationId));

    const before = getOperationState(ctx.db, ctx.admin, operation.operationId)!;
    expect(before.status).toBe('Finished');
    expect(before.lines[0]!.quantity).toBe(2);
    expect(before.lines[0]!.unitCostFormatted).toBe('$3.00');
    expect(before.lines[0]!.lineTotalFormatted).toBe('$6.00');
    expect(before.totalCostFormatted).toBe('$6.00');

    // Admin меняет всё, что §11.4 и §18.15 запрещают протаскивать в историю.
    updateItem(ctx.db, ctx.admin, gauze.id, {
      currentUnitCostCents: 425,
      name: 'Gauze 4x4 sterile',
      referenceNumber: 'REF-NEW',
    });
    expect(getItem(ctx.db, gauze.id)!.currentUnitCostCents).toBe(425);

    const after = getOperationState(ctx.db, ctx.admin, operation.operationId)!;
    expect(after.lines[0]!.name).toBe('Gauze 4x4');
    expect(after.lines[0]!.referenceNumber).toBe('REF-1');
    expect(after.lines[0]!.unitCostFormatted).toBe('$3.00');
    expect(after.lines[0]!.lineTotalFormatted).toBe('$6.00');
    expect(after.totalCostFormatted).toBe('$6.00');
    expect(after.totalCostFormatted).not.toBe('$8.50');

    // Сводка §12.3 читает те же снимки.
    const summary = getOperationSummary(ctx.db, ctx.admin, operation.operationId)!;
    expect(summary.lines[0]!.name).toBe('Gauze 4x4');
    expect(summary.lines[0]!.reference).toBe('REF-1');
    expect(summary.lines[0]!.unitCostFormatted).toBe('$3.00');
    expect(summary.totalCostFormatted).toBe('$6.00');
  });

  it('источник добавления виден построчно: отдельный скан и пак не смешиваются', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);
    const gloves = makeItem(ctx, FIXTURES.gloves);
    const pack = makeBasicPack(ctx, [
      { itemId: gauze.id, quantity: 2 },
      { itemId: gloves.id, quantity: 1 },
    ]);

    const operation = startOperation(ctx);
    scan(ctx, operation.operationId, gauze.barcodeValue);
    scan(ctx, operation.operationId, pack.barcodeValue);
    expectSuccess(finishOperationAction(ctx.db, ctx.admin, operation.operationId));

    const state = getOperationState(ctx.db, ctx.admin, operation.operationId)!;
    const individual = state.lines.filter((line) => line.sourceType === 'individual');
    const fromPack = state.lines.filter((line) => line.sourceType === 'pack');

    expect(individual).toHaveLength(1);
    expect(individual[0]!.quantity).toBe(1);
    expect(fromPack).toHaveLength(2);
    expect(fromPack[0]!.sourcePackName).toBe('Basic Pack');

    // §12.3: в сводке для ручного переноса важно «сколько единиц предмета
    // израсходовано», поэтому позиции одного предмета объединяются.
    const summary = getOperationSummary(ctx.db, ctx.admin, operation.operationId)!;
    const gauzeLine = summary.lines.find((line) => line.itemId === gauze.id)!;
    expect(summary.lines).toHaveLength(2);
    expect(gauzeLine.quantity).toBe(3);
    expect(gauzeLine.lineTotalFormatted).toBe('$9.00');
    expect(summary.unitCount).toBe(4);
  });
});

// --- §12.3: сводка для Symplast ---------------------------------------------

describe('§12.3: сводка для Symplast', () => {
  it('сводка не содержит полей стоимости при выключенном staff_can_see_cost', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze, { referenceNumber: 'REF-1' });

    const operation = startOperation(ctx);
    scan(ctx, operation.operationId, gauze.barcodeValue);
    expectSuccess(finishOperationAction(ctx.db, ctx.staff, operation.operationId));

    // Значение по умолчанию — не показывать (Q-1).
    const staffSummary = getOperationSummary(ctx.db, ctx.staff, operation.operationId)!;
    expect(staffSummary.showCost).toBe(false);
    expect('totalCostFormatted' in staffSummary).toBe(false);
    expect('unitCostFormatted' in staffSummary.lines[0]!).toBe(false);
    expect('lineTotalFormatted' in staffSummary.lines[0]!).toBe(false);
    // D-18: поля нет в ответе — значит, его нет ни в разметке, ни в буфере обмена.
    expect(staffSummary.text).not.toContain('$');
    expect(staffSummary.text).not.toContain('Total');
    // Рабочие данные при этом на месте: §12.3 адресован в первую очередь Staff.
    expect(staffSummary.lines[0]!.name).toBe('Gauze 4x4');
    expect(staffSummary.lines[0]!.reference).toBe('REF-1');
    expect(staffSummary.lines[0]!.quantity).toBe(1);

    // Admin видит стоимость всегда.
    const adminSummary = getOperationSummary(ctx.db, ctx.admin, operation.operationId)!;
    expect(adminSummary.showCost).toBe(true);
    expect(adminSummary.totalCostFormatted).toBe('$3.00');
    expect(adminSummary.text).toContain('$3.00');

    // Admin включил настройку — стоимость появляется и у Staff.
    setSetting(ctx.db, SETTING_KEYS.staffCanSeeCost, 'true');
    const enabled = getOperationSummary(ctx.db, ctx.staff, operation.operationId)!;
    expect(enabled.showCost).toBe(true);
    expect(enabled.totalCostFormatted).toBe('$3.00');
  });

  it('сводка не содержит ни одного поля, связанного с пациентом', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze, { referenceNumber: 'REF-1' });

    const operation = startOperation(ctx);
    scan(ctx, operation.operationId, gauze.barcodeValue);
    expectSuccess(finishOperationAction(ctx.db, ctx.admin, operation.operationId));

    const summary = getOperationSummary(ctx.db, ctx.admin, operation.operationId)!;

    // §2.4 и §18.3: запретный список.
    const forbidden = [
      'patient',
      'birth',
      'dob',
      'phone',
      'address',
      'chart',
      'mrn',
      'record',
      'insurance',
      'diagnos',
      'procedure',
      'symplast',
    ];

    const keys = [...Object.keys(summary), ...summary.lines.flatMap((line) => Object.keys(line))];
    for (const key of keys) {
      for (const banned of forbidden) {
        expect(key.toLowerCase()).not.toContain(banned);
      }
    }

    // Тот же запрет для текста, который уходит в буфер обмена и на печать.
    for (const banned of forbidden) {
      expect(summary.text.toLowerCase()).not.toContain(banned);
    }

    // §18.4: код операции случайный и не выводится из данных пациента.
    expect(summary.text).toContain(summary.caseCode);
  });

  it('у аннулированной операции сводки нет: материалы возвращены на склад', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);

    const operation = startOperation(ctx);
    scan(ctx, operation.operationId, gauze.barcodeValue);
    expectSuccess(finishOperationAction(ctx.db, ctx.admin, operation.operationId));
    expect(getOperationSummary(ctx.db, ctx.admin, operation.operationId)).toBeDefined();

    expectSuccess(voidOperationAction(ctx.db, ctx.admin, operation.operationId, 'wrong case'));
    expect(getOperationSummary(ctx.db, ctx.admin, operation.operationId)).toBeUndefined();
  });

  it('активная операция сводки не имеет: переносить в Symplast ещё нечего', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);
    const operation = startOperation(ctx);
    scan(ctx, operation.operationId, gauze.barcodeValue);

    expect(getOperationSummary(ctx.db, ctx.admin, operation.operationId)).toBeUndefined();
  });

  it('один предмет по разной цене: сумма строки есть, «средней» стоимости единицы нет', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze); // $3.00

    const operation = startOperation(ctx);
    scan(ctx, operation.operationId, gauze.barcodeValue);
    // §11.4: новая цена применяется к новому добавлению, старая строка не меняется (D-5).
    updateItem(ctx.db, ctx.admin, gauze.id, { currentUnitCostCents: 425 });
    scan(ctx, operation.operationId, gauze.barcodeValue);
    expectSuccess(finishOperationAction(ctx.db, ctx.admin, operation.operationId));

    const summary = getOperationSummary(ctx.db, ctx.admin, operation.operationId)!;
    expect(summary.lines).toHaveLength(1);
    expect(summary.lines[0]!.quantity).toBe(2);
    expect(summary.lines[0]!.lineTotalFormatted).toBe('$7.25');
    expect(summary.lines[0]!.unitCostFormatted).toBeUndefined();
    expect(summary.totalCostFormatted).toBe('$7.25');
  });
});

// --- §12.1: история ---------------------------------------------------------

describe('§12.1: история операций', () => {
  it('количество уникальных предметов и общее количество единиц считаются верно', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);
    const gloves = makeItem(ctx, FIXTURES.gloves);
    const syringe = makeItem(ctx, FIXTURES.syringe);
    const pack = makeBasicPack(ctx, [
      { itemId: gauze.id, quantity: 2 },
      { itemId: gloves.id, quantity: 1 },
    ]);

    const operation = startOperation(ctx);
    scan(ctx, operation.operationId, gauze.barcodeValue); // +1 gauze (individual)
    scan(ctx, operation.operationId, pack.barcodeValue); // +2 gauze, +1 gloves (pack)
    scan(ctx, operation.operationId, syringe.barcodeValue); // +1 syringe
    expectSuccess(finishOperationAction(ctx.db, ctx.admin, operation.operationId));

    const history = listOperationsForActor(ctx.db, ctx.admin, { status: 'Finished' });
    const row = history.finished.find((entry) => entry.id === operation.operationId)!;

    // C-10: три уникальных предмета, пять использованных единиц — при четырёх
    // строках операции (gauze дважды: отдельно и из пака).
    expect(row.itemCount).toBe(3);
    expect(row.unitCount).toBe(5);
    expect(row.caseCode).toBe(operation.caseCode);
    expect(row.status).toBe('Finished');
    expect(row.createdAtMs).toBeGreaterThan(0);
    expect(row.finishedAtMs).not.toBeNull();
    expect(row.voidedAtMs).toBeNull();
    // Итог для Admin: 3×$3.00 + 1×$0.50 + 1×$1.20 = $10.70.
    expect(row.totalCostFormatted).toBe('$10.70');

    const state = getOperationState(ctx.db, ctx.admin, operation.operationId)!;
    expect(state.lines).toHaveLength(4);
    expect(state.itemCount).toBe(3);
    expect(state.unitCount).toBe(5);
  });

  it('итог истории не пересчитывается после изменения текущих цен', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);

    const operation = startOperation(ctx);
    scan(ctx, operation.operationId, gauze.barcodeValue);
    expectSuccess(finishOperationAction(ctx.db, ctx.admin, operation.operationId));

    updateItem(ctx.db, ctx.admin, gauze.id, { currentUnitCostCents: 425 });

    const history = listOperationsForActor(ctx.db, ctx.admin, { status: 'Finished' });
    expect(history.finished[0]!.totalCostFormatted).toBe('$3.00');
    expect(history.finishedTotalFormatted).toBe('$3.00');
  });

  it('для Staff в истории нет полей стоимости', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);

    const operation = startOperation(ctx);
    scan(ctx, operation.operationId, gauze.barcodeValue);
    expectSuccess(finishOperationAction(ctx.db, ctx.staff, operation.operationId));

    const history = listOperationsForActor(ctx.db, ctx.staff, {});
    expect(history.showCost).toBe(false);
    expect('totalCostCents' in history.finished[0]!).toBe(false);
    expect('finishedTotalFormatted' in history).toBe(false);
  });
});
