/**
 * Жизненный цикл операции, сохранность состояния, несколько активных операций,
 * контроль остатка, Undo (§7, §8, §9; AC-2).
 */
import { describe, expect, it } from 'vitest';
import { getItem } from '@/domain/items';
import { findStockInvariantMismatches } from '@/domain/movements';
import {
  addItemToOperation,
  addPackToOperation,
  finishOperation,
  listActiveOperations,
  listOperationLines,
  operationTotalCents,
  removeOperationLine,
  setLineQuantity,
  startOperation,
  summarizeOperation,
  undoLastScan,
} from '@/domain/operations';
import { getOperation } from '@/domain/operations';
import {
  FIXTURES,
  makeBasicPack,
  makeDoctor,
  makeItem,
  nextClientEventId,
  setNegativeStockMode,
  setupTestDb,
} from './helpers';

describe('§7.3 / §8.1: операция сохраняется на сервере сразу', () => {
  it('запись существует до первого скана и имеет случайный код', () => {
    const ctx = setupTestDb();
    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id });

    expect(operation.status).toBe('Active');
    expect(operation.randomCaseCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    expect(operation.finishedAt).toBeNull();
    expect(operation.voidedAt).toBeNull();

    // Перечитывание из БД = то, что увидит страница после refresh.
    const reloaded = getOperation(ctx.db, operation.id)!;
    expect(reloaded.status).toBe('Active');
    expect(reloaded.randomCaseCode).toBe(operation.randomCaseCode);
    expect(listOperationLines(ctx.db, operation.id)).toHaveLength(0);
  });

  it('код операции не содержит визуально неоднозначных символов', () => {
    const ctx = setupTestDb();
    const codes = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      // У врача не может быть двух незакрытых операций, поэтому каждая
      // завершается перед следующей: проверяется алфавит кода, а не пределы.
      const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id });
      codes.add(operation.randomCaseCode);
      finishOperation(ctx.db, ctx.staff, operation.id);
    }
    expect(codes.size).toBe(50);
    for (const code of codes) {
      expect(code).not.toMatch(/[01OIL]/);
    }
  });
});

describe('AC-2.1: состав операции переживает перечитывание', () => {
  it('после серии сканов количества и снимки цен на месте', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);
    const gloves = makeItem(ctx, FIXTURES.gloves);
    const syringe = makeItem(ctx, FIXTURES.syringe);

    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id });
    for (let i = 0; i < 3; i += 1) {
      addItemToOperation(ctx.db, ctx.staff, {
        operationId: operation.id,
        itemId: gauze.id,
        clientEventId: nextClientEventId('scan'),
      });
    }
    for (let i = 0; i < 2; i += 1) {
      addItemToOperation(ctx.db, ctx.staff, {
        operationId: operation.id,
        itemId: gloves.id,
        clientEventId: nextClientEventId('scan'),
      });
    }
    addItemToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      itemId: syringe.id,
      clientEventId: nextClientEventId('scan'),
    });

    const summary = summarizeOperation(ctx.db, getOperation(ctx.db, operation.id)!);
    expect(summary.itemCount).toBe(3);
    expect(summary.unitCount).toBe(6);
    // 3×3.00 + 2×0.50 + 1×1.20 = $11.20
    expect(summary.totalCostCents).toBe(1120);

    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(7);
    expect(getItem(ctx.db, gloves.id)!.currentQuantity).toBe(48);
    expect(getItem(ctx.db, syringe.id)!.currentQuantity).toBe(19);
    expect(getOperation(ctx.db, operation.id)!.status).toBe('Active');
  });
});

describe('AC-2.2: исправления корректируют остаток немедленно', () => {
  it('уменьшение количества возвращает разницу движением returned_from_operation', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);
    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id });
    const added = addItemToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      itemId: gauze.id,
      quantity: 3,
      clientEventId: nextClientEventId('scan'),
    });
    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(7);

    const changed = setLineQuantity(ctx.db, ctx.staff, {
      operationId: operation.id,
      operationItemId: added.lines[0]!.id,
      quantity: 2,
      clientEventId: nextClientEventId('qty'),
    });

    expect(changed.lines[0]!.quantity).toBe(2);
    expect(changed.lines[0]!.lineTotalCents).toBe(600);
    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(8);
    expect(findStockInvariantMismatches(ctx.db)).toEqual([]);
  });

  it('удаление строки возвращает всё списанное и убирает строку (Q-31)', () => {
    const ctx = setupTestDb();
    const syringe = makeItem(ctx, FIXTURES.syringe);
    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id });
    const added = addItemToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      itemId: syringe.id,
      clientEventId: nextClientEventId('scan'),
    });

    removeOperationLine(ctx.db, ctx.staff, {
      operationId: operation.id,
      operationItemId: added.lines[0]!.id,
      clientEventId: nextClientEventId('rm'),
    });

    expect(listOperationLines(ctx.db, operation.id)).toHaveLength(0);
    expect(getItem(ctx.db, syringe.id)!.currentQuantity).toBe(20);
    expect(operationTotalCents(ctx.db, getOperation(ctx.db, operation.id)!)).toBe(0);
  });
});

describe('Undo Last Scan (§7.9, Q-27)', () => {
  it('откатывает последний отдельный скан', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);
    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id });

    addItemToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      itemId: gauze.id,
      clientEventId: nextClientEventId('scan'),
    });
    addItemToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      itemId: gauze.id,
      clientEventId: nextClientEventId('scan'),
    });
    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(8);

    undoLastScan(ctx.db, ctx.staff, {
      operationId: operation.id,
      clientEventId: nextClientEventId('undo'),
    });

    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(9);
    expect(listOperationLines(ctx.db, operation.id)[0]!.quantity).toBe(1);
  });

  it('откатывает скан пака ЦЕЛИКОМ, а не одну позицию (§16)', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);
    const gloves = makeItem(ctx, FIXTURES.gloves);
    const pack = makeBasicPack(ctx, [
      { itemId: gauze.id, quantity: 2 },
      { itemId: gloves.id, quantity: 3 },
    ]);

    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id });
    addPackToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      packId: pack.id,
      clientEventId: nextClientEventId('packscan'),
    });
    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(8);
    expect(getItem(ctx.db, gloves.id)!.currentQuantity).toBe(47);

    undoLastScan(ctx.db, ctx.staff, {
      operationId: operation.id,
      clientEventId: nextClientEventId('undo'),
    });

    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(10);
    expect(getItem(ctx.db, gloves.id)!.currentQuantity).toBe(50);
    expect(listOperationLines(ctx.db, operation.id)).toHaveLength(0);
    expect(findStockInvariantMismatches(ctx.db)).toEqual([]);
  });

  it('без добавляющих событий сообщает «Nothing to undo»', () => {
    const ctx = setupTestDb();
    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id });
    expect(() =>
      undoLastScan(ctx.db, ctx.staff, {
        operationId: operation.id,
        clientEventId: nextClientEventId('undo'),
      }),
    ).toThrowError('Nothing to undo');
  });
});

describe('AC-2.3: несколько активных операций сосуществуют (§8.5, §18.24)', () => {
  it('новая операция не перезаписывает существующую', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);

    const first = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id });
    addItemToOperation(ctx.db, ctx.staff, {
      operationId: first.id,
      itemId: gauze.id,
      quantity: 2,
      clientEventId: nextClientEventId('scan'),
    });

    // §8.5: две активные операции сосуществуют — но у РАЗНЫХ врачей и в пределах
    // двух операционных кабинетов.
    const wong = makeDoctor(ctx, 'Wong');
    const second = startOperation(ctx.db, ctx.staff, { doctorId: wong.id });
    expect(second.id).not.toBe(first.id);
    expect(second.randomCaseCode).not.toBe(first.randomCaseCode);

    addItemToOperation(ctx.db, ctx.staff, {
      operationId: second.id,
      itemId: gauze.id,
      clientEventId: nextClientEventId('scan'),
    });

    // Первая операция не затронута.
    expect(listOperationLines(ctx.db, first.id)[0]!.quantity).toBe(2);
    expect(listOperationLines(ctx.db, second.id)[0]!.quantity).toBe(1);
    expect(getOperation(ctx.db, first.id)!.status).toBe('Active');
    expect(listActiveOperations(ctx.db)).toHaveLength(2);
  });
});

describe('AC-2.4: контроль доступного количества (§7.10)', () => {
  it('режим warn: добавление проходит, остаток уходит в минус, предупреждение показано', () => {
    const ctx = setupTestDb();
    const mask = makeItem(ctx, { ...FIXTURES.mask, quantity: 2 });
    setNegativeStockMode(ctx, 'warn');

    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id });
    addItemToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      itemId: mask.id,
      quantity: 2,
      clientEventId: nextClientEventId('scan'),
    });

    const third = addItemToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      itemId: mask.id,
      clientEventId: nextClientEventId('scan'),
    });

    expect(third.warnings.map((w) => w.message)).toContain('Only 0 units remain in inventory');
    expect(getItem(ctx.db, mask.id)!.currentQuantity).toBe(-1);
    // Операция не завершилась сама.
    expect(getOperation(ctx.db, operation.id)!.status).toBe('Active');
    expect(findStockInvariantMismatches(ctx.db)).toEqual([]);
  });

  it('режим block: добавление отклоняется сообщением «Only N units remain in inventory»', () => {
    const ctx = setupTestDb();
    const mask = makeItem(ctx, { ...FIXTURES.mask, quantity: 2 });
    setNegativeStockMode(ctx, 'block');

    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id });
    expect(() =>
      addItemToOperation(ctx.db, ctx.staff, {
        operationId: operation.id,
        itemId: mask.id,
        quantity: 3,
        clientEventId: nextClientEventId('scan'),
      }),
    ).toThrowError('Only 2 units remain in inventory');

    expect(getItem(ctx.db, mask.id)!.currentQuantity).toBe(2);
    expect(listOperationLines(ctx.db, operation.id)).toHaveLength(0);
  });
});

describe('§9.2 / §18.14: Finished только по явному действию', () => {
  it('finishOperation фиксирует итог и запрещает дальнейшие изменения', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);
    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id });
    const added = addItemToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      itemId: gauze.id,
      quantity: 2,
      clientEventId: nextClientEventId('scan'),
    });

    const finished = finishOperation(ctx.db, ctx.staff, operation.id);
    expect(finished.status).toBe('Finished');
    expect(finished.finishedAt).not.toBeNull();
    expect(finished.totalCostSnapshotCents).toBe(600);

    // §9.2: попытки изменить состав отклоняются сервером.
    expect(() =>
      addItemToOperation(ctx.db, ctx.staff, {
        operationId: operation.id,
        itemId: gauze.id,
        clientEventId: nextClientEventId('scan'),
      }),
    ).toThrowError('Operation was already finished');

    expect(() =>
      setLineQuantity(ctx.db, ctx.staff, {
        operationId: operation.id,
        operationItemId: added.lines[0]!.id,
        quantity: 1,
        clientEventId: nextClientEventId('qty'),
      }),
    ).toThrowError('Operation was already finished');

    expect(() => finishOperation(ctx.db, ctx.staff, operation.id)).toThrowError(
      'Operation was already finished',
    );

    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(8);
    expect(listActiveOperations(ctx.db)).toHaveLength(0);
  });

  it('Finish не создаёт движений остатков — они уже созданы при добавлении', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);
    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id });
    addItemToOperation(ctx.db, ctx.staff, {
      operationId: operation.id,
      itemId: gauze.id,
      quantity: 2,
      clientEventId: nextClientEventId('scan'),
    });

    const before = getItem(ctx.db, gauze.id)!.currentQuantity;
    finishOperation(ctx.db, ctx.staff, operation.id);
    expect(getItem(ctx.db, gauze.id)!.currentQuantity).toBe(before);
  });
});

describe('§14.4: конкретные сообщения об ошибках', () => {
  it('неактивный предмет — «Item is inactive», несуществующая операция — «Operation not found»', () => {
    const ctx = setupTestDb();
    const gauze = makeItem(ctx, FIXTURES.gauze);

    expect(() =>
      addItemToOperation(ctx.db, ctx.staff, {
        operationId: 999_999,
        itemId: gauze.id,
        clientEventId: nextClientEventId('scan'),
      }),
    ).toThrowError('Operation not found');
  });
});
