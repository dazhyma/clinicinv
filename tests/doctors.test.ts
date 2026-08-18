/**
 * Справочник врачей и обозначение операции «CH00001» (новое дополнение к ТЗ).
 *
 * Проверяются свойства, которые нельзя увидеть глазами в интерфейсе: сквозная
 * нумерация по каждому врачу, отсутствие переиспользования номеров после
 * удаления врача и неизменность уже выданных кодов.
 */
import { describe, expect, it } from 'vitest';
import { operations } from '@/db/schema';
import { createDoctor, deleteDoctor, listDoctors, updateDoctor } from '@/domain/doctors';
import { suggestDoctorCode } from '@/domain/doctor-code';
import {
  countActiveOperations,
  finishOperation,
  listOperations,
  OPERATING_ROOMS,
  setOperationDoctor,
  startOperation,
  voidOperation,
} from '@/domain/operations';
import { makeDoctor, setupTestDb } from './helpers';

describe('Код врача', () => {
  it('предлагается по первым двум буквам фамилии', () => {
    expect(suggestDoctorCode('Chen')).toBe('CH');
    expect(suggestDoctorCode('  wong ')).toBe('WO');
  });

  it('транслитерирует кириллицу: «Чен» и «Chen» дают один префикс', () => {
    expect(suggestDoctorCode('Чен')).toBe('CH');
  });

  it('задаётся вручную, когда фамилии начинаются одинаково', () => {
    const ctx = setupTestDb();
    const chan = createDoctor(ctx.db, ctx.admin, { lastName: 'Chan', code: 'CN' });
    expect(chan.code).toBe('CN');
  });

  it('не может повторяться', () => {
    const ctx = setupTestDb();
    // ctx.doctor — уже заведённый Chen с кодом CH.
    expect(() => createDoctor(ctx.db, ctx.admin, { lastName: 'Chapman' })).toThrow(/already used/i);
  });

  it('ведётся только Admin', () => {
    const ctx = setupTestDb();
    expect(() => createDoctor(ctx.db, ctx.staff, { lastName: 'Wong' })).toThrow(/permission/i);
  });
});

describe('Обозначение операции', () => {
  it('складывается из кода врача и сквозного номера', () => {
    const ctx = setupTestDb();
    const first = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    finishOperation(ctx.db, ctx.staff, first.id);
    const second = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });

    expect(first.caseCode).toBe('CH00001');
    expect(second.caseCode).toBe('CH00002');
  });

  it('нумерует каждого врача независимо', () => {
    const ctx = setupTestDb();
    const wong = makeDoctor(ctx, 'Wong');

    const chenFirst = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    const wongFirst = startOperation(ctx.db, ctx.staff, { doctorId: wong.id, patientId: "000123" });
    finishOperation(ctx.db, ctx.staff, chenFirst.id);
    const chenSecond = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });

    expect(wongFirst.caseCode).toBe('WO00001');
    expect(chenSecond.caseCode).toBe('CH00002');
  });

  it('сохраняет снимок врача и внутренний случайный код', () => {
    const ctx = setupTestDb();
    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });

    expect(operation.doctorCodeSnapshot).toBe('CH');
    expect(operation.doctorNameSnapshot).toBe('Chen');
    // §7.3/§18.4: идентификатор, не выводимый из данных, остаётся на месте.
    expect(operation.randomCaseCode).toMatch(/^[2-9A-Z]{6}$/);
    expect(operation.randomCaseCode).not.toBe(operation.caseCode);
  });

  it('не создаётся без врача', () => {
    const ctx = setupTestDb();
    expect(() => startOperation(ctx.db, ctx.staff, { doctorId: 0, patientId: "000123" })).toThrow(/select a doctor/i);
  });

  it('не создаётся у архивированного врача', () => {
    const ctx = setupTestDb();
    startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    deleteDoctor(ctx.db, ctx.admin, ctx.doctor.id);

    expect(() => startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" })).toThrow(
      /archived/i,
    );
  });

  it('не меняется, когда врачу правят код', () => {
    const ctx = setupTestDb();
    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    updateDoctor(ctx.db, ctx.admin, { doctorId: ctx.doctor.id, lastName: 'Chen', code: 'CX' });

    const stored = ctx.db.select().from(operations).all()[0];
    expect(stored?.caseCode).toBe(operation.caseCode);
    expect(stored?.doctorCodeSnapshot).toBe('CH');
  });
});

describe('Пределы одновременно активных операций', () => {
  it('не даёт врачу вторую активную операцию', () => {
    const ctx = setupTestDb();
    const first = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });

    expect(() => startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" })).toThrow(
      new RegExp(`Chen already has an active surgery \\(${first.caseCode}\\)`),
    );
  });

  it('разрешает следующую операцию после Finish', () => {
    const ctx = setupTestDb();
    const first = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    finishOperation(ctx.db, ctx.staff, first.id);

    const second = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    expect(second.caseCode).toBe('CH00002');
  });

  it('разрешает следующую операцию после Void', () => {
    const ctx = setupTestDb();
    const first = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    voidOperation(ctx.db, ctx.admin, first.id);

    expect(() => startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" })).not.toThrow();
  });

  it('допускает две активные операции у разных врачей', () => {
    const ctx = setupTestDb();
    const wong = makeDoctor(ctx, 'Wong');

    expect(() => startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" })).not.toThrow();
    expect(() => startOperation(ctx.db, ctx.staff, { doctorId: wong.id, patientId: "000123" })).not.toThrow();
    expect(countActiveOperations(ctx.db)).toBe(2);
  });

  it('не допускает третью: кабинетов только два', () => {
    const ctx = setupTestDb();
    const wong = makeDoctor(ctx, 'Wong');
    const chapman = makeDoctor(ctx, 'Chapman', 'CP');

    startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    startOperation(ctx.db, ctx.staff, { doctorId: wong.id, patientId: "000123" });

    expect(() => startOperation(ctx.db, ctx.staff, { doctorId: chapman.id, patientId: "000123" })).toThrow(
      /All 2 operating rooms are in use/,
    );
    expect(OPERATING_ROOMS).toBe(2);
  });

  it('освобождает кабинет после завершения одной из двух', () => {
    const ctx = setupTestDb();
    const wong = makeDoctor(ctx, 'Wong');
    const chapman = makeDoctor(ctx, 'Chapman', 'CP');

    const first = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    startOperation(ctx.db, ctx.staff, { doctorId: wong.id, patientId: "000123" });
    finishOperation(ctx.db, ctx.staff, first.id);

    expect(() => startOperation(ctx.db, ctx.staff, { doctorId: chapman.id, patientId: "000123" })).not.toThrow();
  });

  it('запрещено и на уровне БД, в обход домена', () => {
    const ctx = setupTestDb();
    const wong = makeDoctor(ctx, 'Wong');
    startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    startOperation(ctx.db, ctx.staff, { doctorId: wong.id, patientId: "000123" });

    // §21.1: недопустимое состояние нельзя записать даже прямой вставкой.
    const insert = () =>
      ctx.sqlite
        .prepare(
          `INSERT INTO operations
             (random_case_code, case_code, status, doctor_id, created_at, updated_at)
           VALUES ('ZZZZZZ', 'CH09999', 'Active', ?, 1, 1)`,
        )
        .run(ctx.doctor.id);

    expect(insert).toThrow();
  });
});

describe('Смена врача у операции', () => {
  it('выдаёт код нового врача и не переиспользует прежний номер', () => {
    const ctx = setupTestDb();
    const wong = makeDoctor(ctx, 'Wong');
    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    expect(operation.caseCode).toBe('CH00001');

    const moved = setOperationDoctor(ctx.db, ctx.admin, operation.id, wong.id);
    expect(moved.caseCode).toBe('WO00001');
    expect(moved.doctorNameSnapshot).toBe('Wong');

    // CH00001 освободился, но повторно не выдаётся: счётчик только растёт.
    const next = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    expect(next.caseCode).toBe('CH00002');
  });

  it('не переносит операцию врачу, у которого уже есть незакрытая', () => {
    const ctx = setupTestDb();
    const wong = makeDoctor(ctx, 'Wong');
    const chen = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    const wongOperation = startOperation(ctx.db, ctx.staff, { doctorId: wong.id, patientId: "000123" });

    expect(() => setOperationDoctor(ctx.db, ctx.admin, chen.id, wong.id)).toThrow(
      new RegExp(`Wong already has an active surgery \\(${wongOperation.caseCode}\\)`),
    );
  });

  it('недоступна Staff', () => {
    const ctx = setupTestDb();
    const wong = makeDoctor(ctx, 'Wong');
    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });

    expect(() => setOperationDoctor(ctx.db, ctx.staff, operation.id, wong.id)).toThrow(
      /permission/i,
    );
  });
});

describe('Удаление врача', () => {
  it('удаляет физически врача без операций', () => {
    const ctx = setupTestDb();
    const wong = makeDoctor(ctx, 'Wong');

    const result = deleteDoctor(ctx.db, ctx.admin, wong.id);
    expect(result.disposition).toBe('deleted');
    expect(listDoctors(ctx.db, { includeArchived: true }).map((d) => d.code)).toEqual(['CH']);
  });

  it('архивирует врача с операциями и сохраняет их коды', () => {
    const ctx = setupTestDb();
    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });

    const result = deleteDoctor(ctx.db, ctx.admin, ctx.doctor.id);
    expect(result.disposition).toBe('archived');
    expect(result.operationCount).toBe(1);

    const stored = ctx.db.select().from(operations).all()[0];
    expect(stored?.caseCode).toBe(operation.caseCode);
    expect(listDoctors(ctx.db, {})).toHaveLength(0);
  });

  it('не сбрасывает нумерацию при повторном заведении того же кода', () => {
    const ctx = setupTestDb();
    const chenFirst = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    finishOperation(ctx.db, ctx.staff, chenFirst.id);
    const wong = makeDoctor(ctx, 'Wong');
    deleteDoctor(ctx.db, ctx.admin, wong.id);

    const wongAgain = makeDoctor(ctx, 'Wong');
    const first = startOperation(ctx.db, ctx.staff, { doctorId: wongAgain.id, patientId: "000123" });
    expect(first.caseCode).toBe('WO00001');

    // А у Chen номер продолжается, а не начинается заново.
    const chen = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    expect(chen.caseCode).toBe('CH00002');
  });
});

describe('Фильтры списка операций', () => {
  it('отбирают по врачу', () => {
    const ctx = setupTestDb();
    const wong = makeDoctor(ctx, 'Wong');
    startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    startOperation(ctx.db, ctx.staff, { doctorId: wong.id, patientId: "000123" });

    const rows = listOperations(ctx.db, { doctorId: wong.id });
    expect(rows.map((row) => row.caseCode)).toEqual(['WO00001']);
  });

  it('отбирают по диапазону дат создания', () => {
    const ctx = setupTestDb();
    const operation = startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });
    const createdMs = operation.createdAt.getTime();

    expect(
      listOperations(ctx.db, { createdFromMs: createdMs, createdToMs: createdMs }),
    ).toHaveLength(1);
    expect(listOperations(ctx.db, { createdFromMs: createdMs + 1 })).toHaveLength(0);
    expect(listOperations(ctx.db, { createdToMs: createdMs - 1 })).toHaveLength(0);
  });

  it('ищут по показываемому коду операции', () => {
    const ctx = setupTestDb();
    startOperation(ctx.db, ctx.staff, { doctorId: ctx.doctor.id, patientId: "000123" });

    expect(listOperations(ctx.db, { query: 'CH00001' })).toHaveLength(1);
    expect(listOperations(ctx.db, { query: 'WO' })).toHaveLength(0);
  });
});
