/**
 * AC-4 / §11 / §18.15–§18.16 — фиксация себестоимости.
 * Канонический пример: $3.00 в истории при текущей цене $4.25.
 */
import { describe, expect, it } from 'vitest';
import { getItem, updateItem } from '@/domain/items';
import { formatCents, parseDollarsToCents } from '@/domain/money';
import {
  addItemToOperation,
  finishOperation,
  listOperationLines,
  operationTotalCents,
  removeOperationLine,
  startOperation,
} from '@/domain/operations';
import { getOperation } from '@/domain/operations';
import { FIXTURES, makeItem, nextClientEventId, setupTestDb } from './helpers';

describe('AC-4.1: снимок стоимости в завершённой операции', () => {
  it('завершённая операция показывает $3.00 после смены цены на $4.25', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze, { referenceNumber: 'REF-1' });

    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id });
    addItemToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      itemId: gauze.id,
      quantity: 2,
      clientEventId: nextClientEventId('scan'),
    });

    const line = listOperationLines(ctx.db, operation.id)[0]!;
    expect(line.unitCostSnapshotCents).toBe(300);
    expect(line.quantity).toBe(2);
    expect(line.lineTotalCents).toBe(600);
    // Снимки названия, Item Code и reference number.
    expect(line.itemNameSnapshot).toBe('Gauze 4x4');
    expect(line.internalCodeSnapshot).toBe(gauze.internalCode);
    expect(line.referenceNumberSnapshot).toBe('REF-1');
    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(8);

    const finished = finishOperation(ctx.db, ctx.staff, operation.id);
    expect(finished.totalCostSnapshotCents).toBe(600);

    // Admin меняет цену на $4.25.
    updateItem(ctx.db, ctx.admin, gauze.id, { currentUnitCostCents: parseDollarsToCents('4.25') });
    expect(getItem(ctx.db, gauze.id)!.currentUnitCostCents).toBe(425);

    // Завершённая операция не пересчиталась.
    const historicLine = listOperationLines(ctx.db, operation.id)[0]!;
    expect(historicLine.unitCostSnapshotCents).toBe(300);
    expect(historicLine.lineTotalCents).toBe(600);
    expect(formatCents(historicLine.lineTotalCents)).toBe('$6.00');
    expect(operationTotalCents(ctx.db, getOperation(ctx.db, operation.id)!)).toBe(600);
    expect(operationTotalCents(ctx.db, getOperation(ctx.db, operation.id)!)).not.toBe(850);

    // Новая операция берёт уже $4.25.
    const next = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id });
    addItemToOperation(ctx.db, ctx.staff, {
      operationId: next.id,
      itemId: gauze.id,
      quantity: 2,
      clientEventId: nextClientEventId('scan'),
    });
    const newLine = listOperationLines(ctx.db, next.id)[0]!;
    expect(newLine.unitCostSnapshotCents).toBe(425);
    expect(newLine.lineTotalCents).toBe(850);
  });
});

describe('AC-4.2: изменение цены не трогает строки активной операции', () => {
  it('уже добавленная строка сохраняет $3.00, повторное добавление берёт $4.25', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);

    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id });
    const added = addItemToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      itemId: gauze.id,
      clientEventId: nextClientEventId('scan'),
    });
    expect(added.lines[0]!.unitCostSnapshotCents).toBe(300);

    updateItem(ctx.db, ctx.admin, gauze.id, { currentUnitCostCents: 425 });

    // Операция всё ещё Active — строка не изменилась сама.
    const stillOld = listOperationLines(ctx.db, operation.id)[0]!;
    expect(stillOld.unitCostSnapshotCents).toBe(300);
    expect(stillOld.lineTotalCents).toBe(300);

    // Удалить и добавить заново → применяется актуальная цена.
    removeOperationLine(ctx.db, ctx.staff, {
      operationId: operation.id,
      operationItemId: stillOld.id,
      clientEventId: nextClientEventId('rm'),
    });
    expect(listOperationLines(ctx.db, operation.id)).toHaveLength(0);
    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(10);

    addItemToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      itemId: gauze.id,
      clientEventId: nextClientEventId('scan'),
    });
    const reAdded = listOperationLines(ctx.db, operation.id)[0]!;
    expect(reAdded.unitCostSnapshotCents).toBe(425);
    expect(reAdded.lineTotalCents).toBe(425);
  });

  it('добавление после смены цены создаёт отдельную строку, старая не переписывается', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);
    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id });

    addItemToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      itemId: gauze.id,
      clientEventId: nextClientEventId('scan'),
    });
    updateItem(ctx.db, ctx.admin, gauze.id, { currentUnitCostCents: 425 });
    addItemToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      itemId: gauze.id,
      clientEventId: nextClientEventId('scan'),
    });

    const lines = listOperationLines(ctx.db, operation.id);
    // §11.4 «применяется стоимость на момент нового добавления» + §18.15
    // «снимок не меняется» одновременно выполнимы только двумя строками.
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.unitCostSnapshotCents).sort()).toEqual([300, 425]);
    expect(operationTotalCents(ctx.db, getOperation(ctx.db, operation.id)!)).toBe(725);
  });

  it('повторный скан при неизменной цене наращивает ту же строку (§7.6)', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);
    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id });

    for (let i = 0; i < 3; i += 1) {
      addItemToOperation(ctx.db, ctx.staff, {
        operationId: operation.id,
        itemId: gauze.id,
        clientEventId: nextClientEventId('scan'),
      });
    }

    const lines = listOperationLines(ctx.db, operation.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.quantity).toBe(3);
    expect(lines[0]!.lineTotalCents).toBe(900);
    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(7);
  });
});

describe('AC-4.3: изменение атрибутов предмета не пересчитывает историю', () => {
  it('строка завершённой операции хранит старые name и reference', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze, { referenceNumber: 'REF-1' });
    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id });
    addItemToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      itemId: gauze.id,
      quantity: 2,
      clientEventId: nextClientEventId('scan'),
    });
    finishOperation(ctx.db, ctx.staff, operation.id);

    updateItem(ctx.db, ctx.admin, gauze.id, {
      name: 'Gauze 4x4 sterile',
      referenceNumber: 'REF-999',
      currentUnitCostCents: 425,
    });

    const line = listOperationLines(ctx.db, operation.id)[0]!;
    expect(line.itemNameSnapshot).toBe('Gauze 4x4');
    expect(line.referenceNumberSnapshot).toBe('REF-1');
    expect(line.unitCostSnapshotCents).toBe(300);
    expect(line.lineTotalCents).toBe(600);
  });
});

describe('Деньги — целые центы', () => {
  it('парсинг и форматирование не теряют точность', () => {
    expect(parseDollarsToCents('3.25')).toBe(325);
    expect(parseDollarsToCents('$4.25')).toBe(425);
    expect(parseDollarsToCents('3')).toBe(300);
    expect(parseDollarsToCents('0.05')).toBe(5);
    expect(formatCents(870)).toBe('$8.70');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(1120)).toBe('$11.20');
  });

  it('отвергает дробные центы вместо молчаливого округления', () => {
    expect(() => parseDollarsToCents('3.255')).toThrow();
    expect(() => parseDollarsToCents('abc')).toThrow();
  });

  it('сумма 0.1 + 0.2 в центах точна', () => {
    expect(parseDollarsToCents('0.10') + parseDollarsToCents('0.20')).toBe(30);
    expect(formatCents(30)).toBe('$0.30');
  });
});
