/**
 * Слой действий операций (`src/actions/operations.ts`) — спринт 4.
 *
 * Действия вызываются НАПРЯМУЮ, минуя HTTP и экран сканирования: именно так
 * выглядит и ретрай сканера, и попытка Staff выполнить Admin-действие вручную
 * (AC-6.2, шаг 11). Доменные правила проверены отдельно в `operations.test.ts`,
 * `void.test.ts` и `cost-snapshot.test.ts` — здесь проверяется, что слой,
 * которым пользуется интерфейс, эти правила не обходит.
 */
import { describe, expect, it } from 'vitest';
import {
  addItemToOperationAction,
  changeLineQuantityAction,
  deleteVoidedOperationAction,
  finishOperationAction,
  getOperationState,
  listOperationsForActor,
  scanIntoOperationAction,
  searchItemsForOperationAction,
  startOperationAction,
  undoLastScanAction,
  voidOperationAction,
} from '@/actions/operations';
import { auditLog, inventoryMovements, operationEvents, operationItems, operations } from '@/db/schema';
import { getItem, updateItem } from '@/domain/items';
import { findStockInvariantMismatches, listMovementsForOperation } from '@/domain/movements';
import { FIXTURES, makeBasicPack, makeDoctor, makeItem, nextClientEventId, setNegativeStockMode, setupTestDb, type TestContext } from './helpers';

function expectSuccess<T>(result: { ok: boolean }): { ok: true; data: T } {
  if (!result.ok) throw new Error(`Expected success, got: ${JSON.stringify(result)}`);
  return result as unknown as { ok: true; data: T };
}

function expectFailure(result: { ok: boolean }) {
  expect(result.ok).toBe(false);
  return result as { ok: false; error: string; code: string };
}

function startOperation(ctx: TestContext, actor = ctx.staff, doctorId = ctx.doctor.id) {
  return expectSuccess<{ operationId: number; caseCode: string }>(
    startOperationAction(ctx.db, actor, { doctorId }),
  ).data;
}

function stockOf(ctx: TestContext, itemId: number): number {
  return getItem(ctx.db, itemId)?.currentQuantity ?? -1;
}

function expectStockInvariant(ctx: TestContext) {
  expect(findStockInvariantMismatches(ctx.db)).toEqual([]);
}

// --- §10.4, §16: идемпотентность скана --------------------------------------

describe('Скан: повтор того же clientEventId не списывает дважды', () => {
  it('второй запрос с тем же ключом возвращает результат первой попытки', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze); // 10 шт.
    const operation = startOperation(ctx);
    const clientEventId = nextClientEventId('scan');

    const first = expectSuccess<{ applied: boolean; state: { lines: { quantity: number }[] } }>(
      scanIntoOperationAction(ctx.db, ctx.admin, {
        operationId: operation.operationId,
        barcode: gauze.barcodeValue,
        clientEventId,
      }),
    ).data;

    // Ретрай после сетевого таймаута: тот же ключ, тот же запрос.
    const replay = expectSuccess<{
      applied: boolean;
      message: string;
      state: { lines: { quantity: number }[]; unitCount: number };
    }>(
      scanIntoOperationAction(ctx.db, ctx.admin, {
        operationId: operation.operationId,
        barcode: gauze.barcodeValue,
        clientEventId,
      }),
    ).data;

    expect(first.applied).toBe(true);
    expect(replay.applied).toBe(false);
    // Результат первой попытки, а не ошибка: персонал не должен решить,
    // что скан не прошёл, и отсканировать предмет ещё раз.
    expect(replay.state.lines).toHaveLength(1);
    expect(replay.state.lines[0]?.quantity).toBe(1);
    expect(replay.state.unitCount).toBe(1);

    expect(stockOf(ctx, gauze.id)).toBe(9);
    expect(
      listMovementsForOperation(ctx.db, operation.operationId).filter(
        (movement) => movement.movementType === 'used_in_operation',
      ),
    ).toHaveLength(1);
    expectStockInvariant(ctx);
  });

  it('разные ключи для одного предмета наращивают количество (§7.6)', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);
    const operation = startOperation(ctx);

    for (let i = 0; i < 3; i += 1) {
      expectSuccess(
        scanIntoOperationAction(ctx.db, ctx.admin, {
          operationId: operation.operationId,
          barcode: gauze.barcodeValue,
          clientEventId: nextClientEventId('scan'),
        }),
      );
    }

    const state = getOperationState(ctx.db, ctx.admin, operation.operationId);
    expect(state?.lines).toHaveLength(1);
    expect(state?.lines[0]?.quantity).toBe(3);
    expect(stockOf(ctx, gauze.id)).toBe(7);
    expectStockInvariant(ctx);
  });

  it('неизвестный штрихкод — «Barcode not found», ничего не добавлено', () => {
    const ctx = setupTestDb();
    const operation = startOperation(ctx);

    const failure = expectFailure(
      scanIntoOperationAction(ctx.db, ctx.staff, {
        operationId: operation.operationId,
        barcode: 'ITM-999999',
        clientEventId: nextClientEventId('scan'),
      }),
    );

    expect(failure.error).toBe('Barcode not found');
    expect(getOperationState(ctx.db, ctx.staff, operation.operationId)?.lines).toHaveLength(0);
  });
});

// --- §16, §7.7: пак добавляется целиком или никак ---------------------------

describe('Скан пака: либо все позиции, либо ни одной', () => {
  it('режим block и нехватка остатка по второй позиции отменяют весь пак', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze); // 10
    const gloves = makeItem(ctx, { ...FIXTURES.gloves, quantity: 1 }); // 1
    const pack = makeBasicPack(ctx, [
      { itemId: gauze.id, quantity: 2 },
      { itemId: gloves.id, quantity: 3 },
    ]);
    setNegativeStockMode(ctx, 'block');

    const operation = startOperation(ctx);
    const failure = expectFailure(
      scanIntoOperationAction(ctx.db, ctx.staff, {
        operationId: operation.operationId,
        barcode: pack.barcodeValue,
        clientEventId: nextClientEventId('pack'),
      }),
    );

    expect(failure.error).toBe('Only 1 unit remain in inventory');
    expect(getOperationState(ctx.db, ctx.admin, operation.operationId)?.lines).toHaveLength(0);
    // Первая позиция не списана: половина пака невозможна.
    expect(stockOf(ctx, gauze.id)).toBe(10);
    expect(stockOf(ctx, gloves.id)).toBe(1);
    expect(listMovementsForOperation(ctx.db, operation.operationId)).toHaveLength(0);
    expectStockInvariant(ctx);
  });

  it('сбой БД на второй позиции откатывает уже сделанное списание первой', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze); // 10
    const gloves = makeItem(ctx, FIXTURES.gloves); // 50
    const pack = makeBasicPack(ctx, [
      { itemId: gauze.id, quantity: 2 },
      { itemId: gloves.id, quantity: 3 },
    ]);

    // Искусственный сбой ровно в середине пака: вторая строка операции не
    // запишется. Первая позиция к этому моменту уже списана — проверяем, что
    // транзакция откатит и её (§16, FR-79).
    ctx.sqlite.exec(`
      CREATE TRIGGER fail_second_pack_line BEFORE INSERT ON operation_items
      WHEN NEW.item_id = ${gloves.id}
      BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;
    `);

    const operation = startOperation(ctx);
    const failure = expectFailure(
      scanIntoOperationAction(ctx.db, ctx.staff, {
        operationId: operation.operationId,
        barcode: pack.barcodeValue,
        clientEventId: nextClientEventId('pack'),
      }),
    );

    // §14.4: сообщение говорит, что произошло с данными, а не «Error 500».
    expect(failure.code).toBe('UNEXPECTED');
    expect(failure.error).toMatch(/not saved/i);

    ctx.sqlite.exec('DROP TRIGGER fail_second_pack_line;');

    expect(getOperationState(ctx.db, ctx.admin, operation.operationId)?.lines).toHaveLength(0);
    expect(stockOf(ctx, gauze.id)).toBe(10);
    expect(stockOf(ctx, gloves.id)).toBe(50);
    expect(listMovementsForOperation(ctx.db, operation.operationId)).toHaveLength(0);
    expectStockInvariant(ctx);
  });

  it('позиции пака помечены source_type и отличимы от добавленных поштучно', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);
    const gloves = makeItem(ctx, FIXTURES.gloves);
    const pack = makeBasicPack(ctx, [
      { itemId: gauze.id, quantity: 2 },
      { itemId: gloves.id, quantity: 3 },
    ]);

    const operation = startOperation(ctx);
    const scan = expectSuccess<{ message: string }>(
      scanIntoOperationAction(ctx.db, ctx.admin, {
        operationId: operation.operationId,
        barcode: pack.barcodeValue,
        clientEventId: nextClientEventId('pack'),
      }),
    ).data;

    // §7.5: подтверждение называет пак и его объём.
    expect(scan.message).toContain('Basic Pack added');

    // Тот же предмет отдельным сканом — отдельная строка (§6.5, §7.7).
    expectSuccess(
      scanIntoOperationAction(ctx.db, ctx.admin, {
        operationId: operation.operationId,
        barcode: gauze.barcodeValue,
        clientEventId: nextClientEventId('scan'),
      }),
    );

    const state = getOperationState(ctx.db, ctx.admin, operation.operationId);
    const fromPack = state?.lines.filter((line) => line.sourceType === 'pack') ?? [];
    const individual = state?.lines.filter((line) => line.sourceType === 'individual') ?? [];

    expect(fromPack).toHaveLength(2);
    expect(individual).toHaveLength(1);
    expect(fromPack.every((line) => line.sourcePackId === pack.id)).toBe(true);
    // Интерфейс обязан показать, откуда позиция взялась (§7.7, FR-80).
    expect(fromPack.every((line) => line.sourcePackName === 'Basic Pack')).toBe(true);
    expect(individual[0]?.sourcePackId).toBeNull();

    expect(stockOf(ctx, gauze.id)).toBe(7); // 10 − 2 (пак) − 1 (скан)
    expect(stockOf(ctx, gloves.id)).toBe(47);
    expectStockInvariant(ctx);
  });

  it('количество позиции, добавленной паком, можно скорректировать (§7.7)', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);
    const pack = makeBasicPack(ctx, [{ itemId: gauze.id, quantity: 2 }]);
    const operation = startOperation(ctx);

    expectSuccess(
      scanIntoOperationAction(ctx.db, ctx.staff, {
        operationId: operation.operationId,
        barcode: pack.barcodeValue,
        clientEventId: nextClientEventId('pack'),
      }),
    );

    const line = getOperationState(ctx.db, ctx.admin, operation.operationId)!.lines[0]!;
    expectSuccess(
      changeLineQuantityAction(ctx.db, ctx.staff, {
        operationId: operation.operationId,
        lineId: line.id,
        quantity: 1,
        clientEventId: nextClientEventId('qty'),
      }),
    );

    expect(stockOf(ctx, gauze.id)).toBe(9);
    const state = getOperationState(ctx.db, ctx.admin, operation.operationId);
    expect(state?.lines[0]?.quantity).toBe(1);
    expect(state?.lines[0]?.sourceType).toBe('pack');
    expectStockInvariant(ctx);
  });
});

// --- §7.9, §10.2: исправления возвращают остаток ----------------------------

describe('Исправления: уменьшение и удаление возвращают остаток на склад', () => {
  it('3 → 1 возвращает 2, удаление возвращает оставшееся', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze); // 10, $3.00
    const operation = startOperation(ctx);

    expectSuccess(
      addItemToOperationAction(ctx.db, ctx.staff, {
        operationId: operation.operationId,
        itemId: gauze.id,
        quantity: 3,
        clientEventId: nextClientEventId('manual'),
      }),
    );
    expect(stockOf(ctx, gauze.id)).toBe(7);

    const line = getOperationState(ctx.db, ctx.admin, operation.operationId)!.lines[0]!;

    const decreased = expectSuccess<{ state: { totalCostFormatted?: string } }>(
      changeLineQuantityAction(ctx.db, ctx.admin, {
        operationId: operation.operationId,
        lineId: line.id,
        quantity: 1,
        clientEventId: nextClientEventId('qty'),
      }),
    ).data;

    expect(stockOf(ctx, gauze.id)).toBe(9);
    // §7.9: пересчитывается и стоимость активной операции.
    expect(decreased.state.totalCostFormatted).toBe('$3.00');
    expect(
      listMovementsForOperation(ctx.db, operation.operationId).some(
        (movement) => movement.movementType === 'returned_from_operation' && movement.quantityDelta === 2,
      ),
    ).toBe(true);

    expectSuccess(
      changeLineQuantityAction(ctx.db, ctx.admin, {
        operationId: operation.operationId,
        lineId: line.id,
        quantity: 0,
        clientEventId: nextClientEventId('qty'),
      }),
    );

    expect(stockOf(ctx, gauze.id)).toBe(10);
    const state = getOperationState(ctx.db, ctx.admin, operation.operationId);
    expect(state?.lines).toHaveLength(0);
    expect(state?.totalCostFormatted).toBe('$0.00');
    expectStockInvariant(ctx);
  });
});

// --- Undo (§7.9, D-13) ------------------------------------------------------

describe('Undo Last Scan не возвращает больше, чем в строке осталось (D-13)', () => {
  it('после ручного уменьшения Undo возвращает только остаток строки', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze); // 10
    const operation = startOperation(ctx);

    expectSuccess(
      addItemToOperationAction(ctx.db, ctx.staff, {
        operationId: operation.operationId,
        itemId: gauze.id,
        quantity: 3,
        clientEventId: nextClientEventId('manual'),
      }),
    );
    const line = getOperationState(ctx.db, ctx.admin, operation.operationId)!.lines[0]!;

    // Часть уже вернули руками: на складе 9, в строке осталась 1 единица.
    expectSuccess(
      changeLineQuantityAction(ctx.db, ctx.staff, {
        operationId: operation.operationId,
        lineId: line.id,
        quantity: 1,
        clientEventId: nextClientEventId('qty'),
      }),
    );
    expect(stockOf(ctx, gauze.id)).toBe(9);

    expectSuccess(
      undoLastScanAction(ctx.db, ctx.staff, {
        operationId: operation.operationId,
        clientEventId: nextClientEventId('undo'),
      }),
    );

    // 10, а не 12: операция не может вернуть больше, чем реально забрала.
    expect(stockOf(ctx, gauze.id)).toBe(10);
    expect(getOperationState(ctx.db, ctx.admin, operation.operationId)?.lines).toHaveLength(0);
    expectStockInvariant(ctx);
  });

  it('без добавляющих событий сообщает «Nothing to undo»', () => {
    const ctx = setupTestDb();
    const operation = startOperation(ctx);

    const failure = expectFailure(
      undoLastScanAction(ctx.db, ctx.staff, {
        operationId: operation.operationId,
        clientEventId: nextClientEventId('undo'),
      }),
    );
    expect(failure.error).toBe('Nothing to undo');
  });
});

// --- Finish and Lock (§9.2, §11.3) ------------------------------------------

describe('Finish фиксирует итог, и он не меняется от последующей смены цены', () => {
  it('total_cost_snapshot остаётся $6.00 после подорожания предмета до $4.25', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze); // $3.00
    const operation = startOperation(ctx, ctx.admin);

    expectSuccess(
      addItemToOperationAction(ctx.db, ctx.admin, {
        operationId: operation.operationId,
        itemId: gauze.id,
        quantity: 2,
        clientEventId: nextClientEventId('manual'),
      }),
    );

    const finished = expectSuccess<{
      caseCode: string;
      itemCount: number;
      unitCount: number;
      totalCostFormatted?: string;
    }>(finishOperationAction(ctx.db, ctx.admin, operation.operationId)).data;

    expect(finished.totalCostFormatted).toBe('$6.00');
    expect(finished.itemCount).toBe(1);
    expect(finished.unitCount).toBe(2);

    const snapshotRow = ctx.db
      .select()
      .from(operations)
      .all()
      .find((row) => row.id === operation.operationId);
    expect(snapshotRow?.status).toBe('Finished');
    expect(snapshotRow?.totalCostSnapshotCents).toBe(600);

    // §5.7 / §11.3: новая цена действует только на будущие добавления.
    updateItem(ctx.db, ctx.admin, gauze.id, { currentUnitCostCents: 425 });

    const state = getOperationState(ctx.db, ctx.admin, operation.operationId)!;
    expect(state.totalCostFormatted).toBe('$6.00');
    expect(state.lines[0]?.unitCostFormatted).toBe('$3.00');
    expect(state.lines[0]?.lineTotalFormatted).toBe('$6.00');
    expect(state.canEdit).toBe(false);
  });

  it('изменить состав завершённой операции нельзя', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);
    const operation = startOperation(ctx, ctx.admin);
    expectSuccess(
      addItemToOperationAction(ctx.db, ctx.admin, {
        operationId: operation.operationId,
        itemId: gauze.id,
        clientEventId: nextClientEventId('manual'),
      }),
    );
    expectSuccess(finishOperationAction(ctx.db, ctx.admin, operation.operationId));

    const failure = expectFailure(
      scanIntoOperationAction(ctx.db, ctx.admin, {
        operationId: operation.operationId,
        barcode: gauze.barcodeValue,
        clientEventId: nextClientEventId('scan'),
      }),
    );
    expect(failure.error).toBe('Operation was already finished');
    expect(stockOf(ctx, gauze.id)).toBe(9);
  });

  /**
   * Регрессия к дефекту «Finish and Lock — тихий no-op».
   *
   * Причина дефекта была браузерной (страница прокручивалась между нажатием и
   * отпусканием кнопки, и `click` не доходил — см. D-48), но требование §14.4
   * «либо действие выполнено, либо конкретная ошибка» проверяемо и на сервере:
   * второе нажатие обязано дать «Operation was already finished», а не тихий
   * успех, из-за которого экран показал бы «завершено» дважды и увёл бы
   * пользователя со страницы при неизменившемся статусе.
   */
  it('повторный Finish отвечает конкретной ошибкой, а не тихим успехом', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);
    const operation = startOperation(ctx, ctx.admin);
    expectSuccess(
      addItemToOperationAction(ctx.db, ctx.admin, {
        operationId: operation.operationId,
        itemId: gauze.id,
        quantity: 2,
        clientEventId: nextClientEventId('manual'),
      }),
    );

    const first = expectSuccess<{ caseCode: string }>(
      finishOperationAction(ctx.db, ctx.admin, operation.operationId),
    ).data;
    // Обозначение операции — код врача плюс пять цифр, без разделителя.
    expect(first.caseCode).toMatch(/^[A-Z]{2,4}\d{5}$/);

    const second = expectFailure(finishOperationAction(ctx.db, ctx.admin, operation.operationId));
    expect(second.error).toBe('Operation was already finished');
    expect(second.code).toBe('OPERATION_ALREADY_FINISHED');

    // Второе нажатие не создало ни движений, ни второй отметки времени.
    const row = ctx.db
      .select()
      .from(operations)
      .all()
      .find((entry) => entry.id === operation.operationId)!;
    expect(row.status).toBe('Finished');
    expect(row.totalCostSnapshotCents).toBe(600);
    expect(stockOf(ctx, gauze.id)).toBe(8);
    expect(findStockInvariantMismatches(ctx.db)).toEqual([]);
  });

  /**
   * Отказ Finish не должен оставлять операцию в неопределённом состоянии:
   * аннулированная операция не завершается, статус не меняется, а сообщение
   * называет причину (§14.4).
   */
  it('Finish аннулированной операции отвечает «Operation was already voided»', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);
    const operation = startOperation(ctx, ctx.admin);
    expectSuccess(
      addItemToOperationAction(ctx.db, ctx.admin, {
        operationId: operation.operationId,
        itemId: gauze.id,
        clientEventId: nextClientEventId('manual'),
      }),
    );
    expectSuccess(voidOperationAction(ctx.db, ctx.admin, operation.operationId));

    const failure = expectFailure(
      finishOperationAction(ctx.db, ctx.admin, operation.operationId),
    );
    expect(failure.error).toBe('Operation was already voided');

    const row = ctx.db
      .select()
      .from(operations)
      .all()
      .find((entry) => entry.id === operation.operationId)!;
    expect(row.status).toBe('Voided');
    expect(row.finishedAt).toBeNull();
  });
});

// --- Void (§9.3, §18.21, §18.22) --------------------------------------------

describe('Void: только Admin, ровно один раз', () => {
  it('Staff получает отказ, Admin возвращает остатки, второй Void невозможен', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze); // 10
    const operation = startOperation(ctx, ctx.admin);

    expectSuccess(
      addItemToOperationAction(ctx.db, ctx.admin, {
        operationId: operation.operationId,
        itemId: gauze.id,
        quantity: 2,
        clientEventId: nextClientEventId('manual'),
      }),
    );
    expectSuccess(finishOperationAction(ctx.db, ctx.admin, operation.operationId));
    expect(stockOf(ctx, gauze.id)).toBe(8);

    // Прямой вызов из-под Staff в обход интерфейса (§18.22).
    const forbidden = expectFailure(
      voidOperationAction(ctx.db, ctx.staff, operation.operationId, 'staff attempt'),
    );
    expect(forbidden.code).toBe('FORBIDDEN');
    expect(stockOf(ctx, gauze.id)).toBe(8);
    expect(
      ctx.db
        .select()
        .from(operations)
        .all()
        .find((row) => row.id === operation.operationId)?.status,
    ).toBe('Finished');

    const voided = expectSuccess<{ returnedItems: number; returnedUnits: number }>(
      voidOperationAction(ctx.db, ctx.admin, operation.operationId, 'wrong case'),
    ).data;

    expect(voided.returnedItems).toBe(1);
    expect(voided.returnedUnits).toBe(2);
    expect(stockOf(ctx, gauze.id)).toBe(10);

    const second = expectFailure(
      voidOperationAction(ctx.db, ctx.admin, operation.operationId, 'again'),
    );
    // §14.4, эталонная формулировка.
    expect(second.error).toBe('Operation was already voided');
    expect(stockOf(ctx, gauze.id)).toBe(10);
    expect(
      listMovementsForOperation(ctx.db, operation.operationId).filter(
        (movement) => movement.movementType === 'void_reversal',
      ),
    ).toHaveLength(1);
    expectStockInvariant(ctx);
  });

  it('аннулированная операция не видна Staff ни списком, ни по прямой ссылке (Q-34)', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);
    const operation = startOperation(ctx, ctx.admin);
    expectSuccess(
      addItemToOperationAction(ctx.db, ctx.admin, {
        operationId: operation.operationId,
        itemId: gauze.id,
        clientEventId: nextClientEventId('manual'),
      }),
    );
    expectSuccess(voidOperationAction(ctx.db, ctx.admin, operation.operationId, null));

    expect(getOperationState(ctx.db, ctx.staff, operation.operationId)).toBeUndefined();
    expect(getOperationState(ctx.db, ctx.admin, operation.operationId)?.status).toBe('Voided');

    const staffList = listOperationsForActor(ctx.db, ctx.staff, {});
    expect(staffList.voided).toHaveLength(0);
    expect(staffList.canSeeVoided).toBe(false);

    const adminList = listOperationsForActor(ctx.db, ctx.admin, {});
    expect(adminList.voided).toHaveLength(1);
    expect(adminList.canSeeVoided).toBe(true);
  });
});

// --- §8.5, §18.24: несколько активных операций ------------------------------

describe('Новая операция не перезаписывает существующую активную', () => {
  it('обе операции живут независимо и обе видны в блоке активных', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);
    const gloves = makeItem(ctx, FIXTURES.gloves);

    const first = startOperation(ctx);
    expectSuccess(
      scanIntoOperationAction(ctx.db, ctx.staff, {
        operationId: first.operationId,
        barcode: gauze.barcodeValue,
        clientEventId: nextClientEventId('scan'),
      }),
    );

    // §8.5: две активные операции сосуществуют — у разных врачей, по одному кабинету на каждую.
    const second = startOperation(ctx, ctx.staff, makeDoctor(ctx, 'Wong').id);
    expectSuccess(
      scanIntoOperationAction(ctx.db, ctx.staff, {
        operationId: second.operationId,
        barcode: gloves.barcodeValue,
        clientEventId: nextClientEventId('scan'),
      }),
    );

    expect(second.operationId).not.toBe(first.operationId);
    expect(second.caseCode).not.toBe(first.caseCode);

    const firstState = getOperationState(ctx.db, ctx.admin, first.operationId)!;
    const secondState = getOperationState(ctx.db, ctx.admin, second.operationId)!;

    expect(firstState.status).toBe('Active');
    expect(firstState.lines).toHaveLength(1);
    expect(firstState.lines[0]?.name).toBe(FIXTURES.gauze.name);
    expect(secondState.lines[0]?.name).toBe(FIXTURES.gloves.name);

    const list = listOperationsForActor(ctx.db, ctx.staff, {});
    expect(list.active).toHaveLength(2);
    expect(list.active.map((row) => row.caseCode).sort()).toEqual(
      [first.caseCode, second.caseCode].sort(),
    );
    expectStockInvariant(ctx);
  });
});

// --- §7.8: ручной поиск и §3.2: видимость стоимости -------------------------

describe('Ручной поиск и видимость стоимости', () => {
  it('находит предмет по названию, Item Code и reference number', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze, { referenceNumber: 'REF-88' });

    for (const term of ['Gauze', gauze.internalCode, 'REF-88']) {
      const found = expectSuccess<{ itemId: number }[]>(
        searchItemsForOperationAction(ctx.db, ctx.staff, term),
      ).data;
      expect(found.map((row) => row.itemId)).toContain(gauze.id);
    }
  });

  it('Staff не получает полей стоимости, пока настройка выключена (D-18)', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);
    const operation = startOperation(ctx);
    expectSuccess(
      scanIntoOperationAction(ctx.db, ctx.staff, {
        operationId: operation.operationId,
        barcode: gauze.barcodeValue,
        clientEventId: nextClientEventId('scan'),
      }),
    );

    const staffState = getOperationState(ctx.db, ctx.staff, operation.operationId)!;
    expect(staffState.showCost).toBe(false);
    expect('totalCostCents' in staffState).toBe(false);
    expect('unitCostCents' in staffState.lines[0]!).toBe(false);

    const adminState = getOperationState(ctx.db, ctx.admin, operation.operationId)!;
    expect(adminState.lines[0]?.unitCostFormatted).toBe('$3.00');
  });
});

describe('Окончательное удаление Voided operation', () => {
  it('доступно только Admin, удаляет историю без повторного изменения остатка', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);
    const operation = startOperation(ctx, ctx.admin);
    expectSuccess(
      addItemToOperationAction(ctx.db, ctx.admin, {
        operationId: operation.operationId,
        itemId: item.id,
        clientEventId: nextClientEventId('delete-operation'),
      }),
    );
    expectSuccess(voidOperationAction(ctx.db, ctx.admin, operation.operationId, 'test cleanup'));
    const stockAfterVoid = stockOf(ctx, item.id);

    const forbidden = expectFailure(
      deleteVoidedOperationAction(ctx.db, ctx.staff, operation.operationId),
    );
    expect(forbidden.code).toBe('FORBIDDEN');
    expect(getOperationState(ctx.db, ctx.admin, operation.operationId)).toBeDefined();

    const deleted = expectSuccess<{ caseCode: string; deletedMovements: number }>(
      deleteVoidedOperationAction(ctx.db, ctx.admin, operation.operationId),
    ).data;
    expect(deleted.caseCode).toBe(operation.caseCode);
    expect(deleted.deletedMovements).toBeGreaterThan(0);
    expect(stockOf(ctx, item.id)).toBe(stockAfterVoid);
    expect(getOperationState(ctx.db, ctx.admin, operation.operationId)).toBeUndefined();

    for (const rows of [
      ctx.db.select().from(operationItems).all(),
      ctx.db.select().from(operationEvents).all(),
      ctx.db.select().from(inventoryMovements).all(),
    ]) {
      expect(rows.filter((row) => row.operationId === operation.operationId)).toEqual([]);
    }
    expect(
      ctx.db.select().from(auditLog).all().some(
        (row) =>
          row.action === 'operation.deleted' &&
          row.entityId === operation.operationId &&
          row.summary?.includes(operation.caseCode),
      ),
    ).toBe(true);
    expectStockInvariant(ctx);
  });

  it('не удаляет Active или Finished operation', () => {
    const ctx = setupTestDb();
    const operation = startOperation(ctx, ctx.admin);

    expect(expectFailure(
      deleteVoidedOperationAction(ctx.db, ctx.admin, operation.operationId),
    ).code).toBe('OPERATION_NOT_VOIDED');
    expectSuccess(finishOperationAction(ctx.db, ctx.admin, operation.operationId));
    expect(expectFailure(
      deleteVoidedOperationAction(ctx.db, ctx.admin, operation.operationId),
    ).code).toBe('OPERATION_NOT_VOIDED');
    expect(getOperationState(ctx.db, ctx.admin, operation.operationId)?.status).toBe('Finished');
  });
});
