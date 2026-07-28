/**
 * Ограничения уровня БД (docs/data-model.md §10, NFR-23) и приватность схемы
 * (§2.4, §18.3). Проверяется именно база, а не логика приложения: §21.1 и §16
 * требуют, чтобы дубликат нельзя было записать даже прямой вставкой.
 */
import { describe, expect, it } from 'vitest';
import { getTableName, getTableColumns } from 'drizzle-orm';
import { allTables } from '@/db/schema';
import { renderBarcodeSvg } from '@/domain/barcode';
import { createItem } from '@/domain/items';
import { formatInternalCode, generateCaseCode, isInternalCode } from '@/domain/codes';
import { createPack } from '@/domain/packs';
import { FIXTURES, makeItem, setupTestDb } from './helpers';

describe('Схема соответствует объявленной в Drizzle', () => {
  it('каждый столбец из schema.ts существует в БД', () => {
    const ctx = setupTestDb();

    for (const table of Object.values(allTables)) {
      const tableName = getTableName(table);
      const actual = (
        ctx.sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[]
      ).map((c) => c.name);

      expect(actual.length, `таблица ${tableName} отсутствует в БД`).toBeGreaterThan(0);

      for (const column of Object.values(getTableColumns(table))) {
        expect(actual, `${tableName}.${column.name}`).toContain(column.name);
      }
    }
  });
});

describe('Уникальность обеспечена БД, а не приложением', () => {
  it('дубликат idempotency_key отклоняется базой (AC-7.3)', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    const insert = ctx.sqlite.prepare(
      `INSERT INTO inventory_movements (item_id, movement_type, quantity_delta, idempotency_key, created_at)
       VALUES (?, 'received', 1, 'dup-key', ?)`,
    );
    insert.run(item.id, Date.now());
    expect(() => insert.run(item.id, Date.now())).toThrow(/UNIQUE constraint failed/i);
  });

  it('дубликат internal_code предмета отклоняется базой (AC-1.5)', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    expect(() =>
      ctx.sqlite
        .prepare(
          `INSERT INTO items (internal_code, barcode_value, name, current_unit_cost_cents,
                              unit_of_measurement, current_quantity, status, created_at, updated_at)
           VALUES (?, 'OTHER-1', 'Clone', 100, 'each', 0, 'active', ?, ?)`,
        )
        .run(item.internalCode, Date.now(), Date.now()),
    ).toThrow(/UNIQUE constraint failed/i);
  });

  it('пак не может занять штрихкод предмета — реестр общий (§16)', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);

    expect(() =>
      ctx.sqlite
        .prepare(
          `INSERT INTO barcode_registry (barcode_value, owner_type, owner_id, created_at)
           VALUES (?, 'pack', 1, ?)`,
        )
        .run(item.barcodeValue, Date.now()),
    ).toThrow(/UNIQUE constraint failed/i);
  });

  it('дубликат random_case_code отклоняется базой', () => {
    const ctx = setupTestDb();
    const insert = ctx.sqlite.prepare(
      `INSERT INTO operations (random_case_code, status, created_at, updated_at)
       VALUES ('ABC234', 'Active', ?, ?)`,
    );
    insert.run(Date.now(), Date.now());
    expect(() => insert.run(Date.now(), Date.now())).toThrow(/UNIQUE constraint failed/i);
  });
});

describe('CHECK-констрейнты держат инварианты движений', () => {
  it('quantity_delta = 0 отклоняется (I-3)', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);
    expect(() =>
      ctx.sqlite
        .prepare(
          `INSERT INTO inventory_movements (item_id, movement_type, quantity_delta, idempotency_key, created_at)
           VALUES (?, 'received', 0, 'zero-delta', ?)`,
        )
        .run(item.id, Date.now()),
    ).toThrow(/CHECK constraint failed/i);
  });

  it('used_in_operation без operation_id отклоняется (I-4)', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);
    expect(() =>
      ctx.sqlite
        .prepare(
          `INSERT INTO inventory_movements (item_id, movement_type, quantity_delta, idempotency_key, created_at)
           VALUES (?, 'used_in_operation', -1, 'no-op-id', ?)`,
        )
        .run(item.id, Date.now()),
    ).toThrow(/CHECK constraint failed/i);
  });

  it('manual_adjustment без причины отклоняется (I-5)', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);
    expect(() =>
      ctx.sqlite
        .prepare(
          `INSERT INTO inventory_movements (item_id, movement_type, quantity_delta, idempotency_key, created_at)
           VALUES (?, 'manual_adjustment', -1, 'no-reason', ?)`,
        )
        .run(item.id, Date.now()),
    ).toThrow(/CHECK constraint failed/i);
  });

  it('line_total <> quantity × unit_cost отклоняется (§11.2)', () => {
    const ctx = setupTestDb();
    const item = makeItem(ctx, FIXTURES.gauze);
    ctx.sqlite
      .prepare(
        `INSERT INTO operations (id, random_case_code, status, created_at, updated_at)
         VALUES (1, 'ZZZ234', 'Active', ?, ?)`,
      )
      .run(Date.now(), Date.now());

    expect(() =>
      ctx.sqlite
        .prepare(
          `INSERT INTO operation_items
             (operation_id, item_id, source_type, item_name_snapshot, internal_code_snapshot,
              unit_of_measurement_snapshot, quantity, unit_cost_snapshot_cents, line_total_cents,
              created_at, updated_at)
           VALUES (1, ?, 'individual', 'x', 'ITM-000001', 'each', 2, 300, 999, ?, ?)`,
        )
        .run(item.id, Date.now(), Date.now()),
    ).toThrow(/CHECK constraint failed/i);
  });

  it('Active-операция с заполненным finished_at отклоняется', () => {
    const ctx = setupTestDb();
    expect(() =>
      ctx.sqlite
        .prepare(
          `INSERT INTO operations (random_case_code, status, created_at, updated_at, finished_at)
           VALUES ('QQQ234', 'Active', ?, ?, ?)`,
        )
        .run(Date.now(), Date.now(), Date.now()),
    ).toThrow(/CHECK constraint failed/i);
  });
});

describe('Приватность схемы (§2.4, §18.3, AC-9.5)', () => {
  const FORBIDDEN = [
    'patient',
    'patient_id',
    'symplast',
    'first_name',
    'last_name',
    'birth',
    'dob',
    'phone',
    'address',
    'chart',
    'mrn',
    'ssn',
  ];

  it('ни в одной таблице нет столбцов, идентифицирующих пациента', () => {
    const ctx = setupTestDb();
    const tables = (
      ctx.sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all() as { name: string }[]
    ).map((t) => t.name);

    for (const table of tables) {
      const columns = (
        ctx.sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
      ).map((c) => c.name.toLowerCase());

      for (const column of columns) {
        for (const forbidden of FORBIDDEN) {
          expect(column.includes(forbidden), `${table}.${column} похоже на данные пациента`).toBe(
            false,
          );
        }
      }
    }
  });

  it('нет таблицы сопоставления операции с пациентом (§7.3)', () => {
    const ctx = setupTestDb();
    const tables = (
      ctx.sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all() as { name: string }[]
    ).map((t) => t.name.toLowerCase());

    expect(tables.some((t) => t.includes('patient'))).toBe(false);
  });
});

describe('Внутренние коды (§5.5, §18.5, §18.6)', () => {
  it('коды предметов и паков идут из независимых последовательностей и не пересекаются', () => {
    const ctx = setupTestDb();
    const first = makeItem(ctx, FIXTURES.gauze);
    const second = makeItem(ctx, FIXTURES.gloves);
    const pack = createPack(ctx.db, ctx.admin, {
      name: 'Basic Pack',
      composition: [{ itemId: first.id, quantity: 1 }],
    });

    expect(first.internalCode).toBe('ITM-000001');
    expect(second.internalCode).toBe('ITM-000002');
    expect(pack.internalCode).toBe('PCK-000001');
    expect(first.internalCode).not.toBe(pack.internalCode);
    expect(isInternalCode(first.internalCode)).toBe(true);
    expect(formatInternalCode('ITM', 127)).toBe('ITM-000127');
  });

  it('код не переиспользуется: 20 предметов подряд дают 20 разных кодов', () => {
    const ctx = setupTestDb();
    const codes = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      codes.add(
        createItem(ctx.db, ctx.admin, {
          name: `Item ${i}`,
          currentUnitCostCents: 100,
          unitOfMeasurement: 'each',
          initialQuantity: 0,
          status: i % 2 === 0 ? 'inactive' : 'active',
        }).internalCode,
      );
    }
    expect(codes.size).toBe(20);
  });

  it('generateCaseCode не выдаёт 0, O, 1, I, L', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateCaseCode()).not.toMatch(/[01OIL]/);
    }
  });
});

describe('Штрихкод Code 128 в SVG (§5.5, §5.6)', () => {
  it('генерирует SVG и печатает человекочитаемую строку под кодом', () => {
    const withText = renderBarcodeSvg('ITM-000127');
    expect(withText).toContain('<svg');
    expect(withText).toContain('</svg>');

    // bwip-js рисует подпись векторными глифами <path>, а не текстовым узлом,
    // поэтому наличие строки проверяется сравнением с отрисовкой без подписи:
    // при includetext=true в SVG появляется дополнительная графика и растёт высота.
    const withoutText = renderBarcodeSvg('ITM-000127', { includeText: false });
    expect(withText.length).toBeGreaterThan(withoutText.length);

    const height = (svg: string) => Number(/viewBox="0 0 [\d.]+ ([\d.]+)"/.exec(svg)![1]);
    expect(height(withText)).toBeGreaterThan(height(withoutText));
  });

  it('разные коды дают разную графику', () => {
    expect(renderBarcodeSvg('ITM-000127')).not.toBe(renderBarcodeSvg('ITM-000128'));
  });

  it('пустое значение отклоняется', () => {
    expect(() => renderBarcodeSvg('   ')).toThrow();
  });
});
