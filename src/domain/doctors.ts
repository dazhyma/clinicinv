/**
 * Справочник врачей (новое дополнение к ТЗ).
 *
 * Врач — это префикс кода операции и подпись в её карточке. Ведёт справочник
 * только Admin (§3.2, §18.22); роль проверяется здесь, в домене, а не только в
 * маршруте — защита в глубину (D-10).
 *
 * Ключевые правила:
 *  - код врача уникален и приводится к A–Z верхнего регистра; уникальность —
 *    ограничение БД, а не проверка в коде;
 *  - изменение кода НЕ переписывает уже выданные коды операций: они хранят свои
 *    снимки, и «CH00001» остаётся «CH00001» навсегда;
 *  - врач, у которого есть операции, не удаляется физически, а архивируется —
 *    ровно как Item (D-63): удаление строки унесло бы с собой историю.
 */
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { AppDatabase, DbLike } from '@/db/client';
import { doctors, operations, type DoctorRow } from '@/db/schema';
import { assertAdmin, type Actor } from './actor';
import { AUDIT_ACTIONS, writeAudit } from './audit';
import {
  DOCTOR_CODE_MAX_LENGTH,
  DOCTOR_CODE_MIN_LENGTH,
  isValidDoctorCode,
  normalizeDoctorCode,
  suggestDoctorCode,
} from './codes';
import { errors } from './errors';
import { runInTransaction } from './movements';

export interface ListDoctorsFilters {
  includeArchived?: boolean;
}

export function listDoctors(tx: DbLike, filters: ListDoctorsFilters = {}): DoctorRow[] {
  return tx
    .select()
    .from(doctors)
    .where(filters.includeArchived ? undefined : isNull(doctors.archivedAt))
    .orderBy(asc(doctors.lastName), asc(doctors.code))
    .all();
}

export function getDoctor(tx: DbLike, doctorId: number): DoctorRow | undefined {
  return tx.select().from(doctors).where(eq(doctors.id, doctorId)).get();
}

/** Сколько операций уже привязано к врачу — от этого зависит удаление. */
export function countOperationsForDoctor(tx: DbLike, doctorId: number): number {
  const row = tx
    .select({ total: sql<number>`count(*)` })
    .from(operations)
    .where(eq(operations.doctorId, doctorId))
    .get();
  return row?.total ?? 0;
}

function assertUsableCode(code: string): string {
  const normalized = normalizeDoctorCode(code);
  if (!isValidDoctorCode(normalized)) {
    throw errors.validationFailed(
      `Doctor code must be ${DOCTOR_CODE_MIN_LENGTH}–${DOCTOR_CODE_MAX_LENGTH} letters (A–Z)`,
      { field: 'code' },
    );
  }
  return normalized;
}

function assertCodeIsFree(tx: DbLike, code: string, exceptDoctorId?: number): void {
  const clash = tx
    .select({ id: doctors.id, lastName: doctors.lastName })
    .from(doctors)
    .where(
      exceptDoctorId == null
        ? eq(doctors.code, code)
        : and(eq(doctors.code, code), ne(doctors.id, exceptDoctorId)),
    )
    .get();
  if (clash) {
    throw errors.validationFailed(`Code ${code} is already used by ${clash.lastName}`, {
      field: 'code',
    });
  }
}

export interface CreateDoctorInput {
  lastName: string;
  fullName?: string | null;
  /** Пусто — код предлагается по фамилии. Поле формы остаётся редактируемым. */
  code?: string | null;
}

export function createDoctor(db: AppDatabase, actor: Actor, input: CreateDoctorInput): DoctorRow {
  assertAdmin(actor, 'manage doctors');

  const lastName = input.lastName?.trim() ?? '';
  if (!lastName) throw errors.validationFailed('Last name is required', { field: 'lastName' });

  const requested = input.code?.trim() ? input.code : suggestDoctorCode(lastName);
  const code = assertUsableCode(requested);

  return runInTransaction(db, (tx) => {
    assertCodeIsFree(tx, code);
    const now = new Date();
    const created = tx
      .insert(doctors)
      .values({
        code,
        lastName,
        fullName: input.fullName?.trim() || null,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    writeAudit(tx, {
      action: AUDIT_ACTIONS.doctorCreated,
      actorAccountId: actor.accountId,
      actorRole: actor.role,
      entityType: 'doctor',
      entityId: created.id,
      summary: `${code} "${lastName}"`,
    });

    return created;
  });
}

export interface UpdateDoctorInput {
  doctorId: number;
  lastName: string;
  fullName?: string | null;
  code: string;
}

/**
 * Изменение врача. Код операции, уже выданный этим врачом, не меняется:
 * `operations.case_code` и снимки — постоянные значения (§18.5).
 */
export function updateDoctor(db: AppDatabase, actor: Actor, input: UpdateDoctorInput): DoctorRow {
  assertAdmin(actor, 'manage doctors');

  const lastName = input.lastName?.trim() ?? '';
  if (!lastName) throw errors.validationFailed('Last name is required', { field: 'lastName' });
  const code = assertUsableCode(input.code ?? '');

  return runInTransaction(db, (tx) => {
    const existing = getDoctor(tx, input.doctorId);
    if (!existing) throw errors.doctorNotFound(input.doctorId);
    if (existing.archivedAt) {
      throw errors.validationFailed(`${existing.lastName} is archived and cannot be edited`);
    }
    assertCodeIsFree(tx, code, existing.id);

    const updated = tx
      .update(doctors)
      .set({ code, lastName, fullName: input.fullName?.trim() || null, updatedAt: new Date() })
      .where(eq(doctors.id, existing.id))
      .returning()
      .get();

    writeAudit(tx, {
      action: AUDIT_ACTIONS.doctorUpdated,
      actorAccountId: actor.accountId,
      actorRole: actor.role,
      entityType: 'doctor',
      entityId: existing.id,
      summary:
        existing.code === code
          ? `${code} "${lastName}"`
          : `${existing.code} -> ${code} "${lastName}"`,
    });

    return updated;
  });
}

export interface DeleteDoctorResult {
  disposition: 'deleted' | 'archived';
  doctor: DoctorRow | null;
  operationCount: number;
}

/**
 * Delete Doctor.
 *
 * Врач без единой операции удаляется физически. Врач с операциями переводится в
 * архив: пропадает из выбора, но его код и фамилия остаются в старых операциях.
 * Счётчик номеров при этом не сбрасывается — он живёт в `code_sequences`,
 * поэтому заново заведённый «CH» продолжит нумерацию, а не выдаст CH00001 второй раз.
 */
export function deleteDoctor(
  db: AppDatabase,
  actor: Actor,
  doctorId: number,
): DeleteDoctorResult {
  assertAdmin(actor, 'manage doctors');

  return runInTransaction(db, (tx) => {
    const doctor = getDoctor(tx, doctorId);
    if (!doctor) throw errors.doctorNotFound(doctorId);
    if (doctor.archivedAt) {
      throw errors.validationFailed(`${doctor.lastName} has already been archived`);
    }

    const operationCount = countOperationsForDoctor(tx, doctor.id);

    if (operationCount === 0) {
      tx.delete(doctors).where(eq(doctors.id, doctor.id)).run();
      writeAudit(tx, {
        action: AUDIT_ACTIONS.doctorDeleted,
        actorAccountId: actor.accountId,
        actorRole: actor.role,
        entityType: 'doctor',
        entityId: doctor.id,
        summary: `${doctor.code} "${doctor.lastName}" deleted`,
      });
      return { disposition: 'deleted', doctor: null, operationCount };
    }

    const now = new Date();
    const archived = tx
      .update(doctors)
      .set({
        status: 'inactive',
        archivedAt: now,
        archivedByAccountId: actor.accountId,
        updatedAt: now,
      })
      .where(eq(doctors.id, doctor.id))
      .returning()
      .get();

    writeAudit(tx, {
      action: AUDIT_ACTIONS.doctorArchived,
      actorAccountId: actor.accountId,
      actorRole: actor.role,
      entityType: 'doctor',
      entityId: doctor.id,
      summary: `${doctor.code} "${doctor.lastName}" archived, ${operationCount} operation(s) kept`,
    });

    return { disposition: 'archived', doctor: archived, operationCount };
  });
}

/** Врач, пригодный для новой операции. Архивированный выбран быть не может. */
export function loadSelectableDoctor(tx: DbLike, doctorId: number): DoctorRow {
  const doctor = getDoctor(tx, doctorId);
  if (!doctor) throw errors.doctorNotFound(doctorId);
  if (doctor.archivedAt || doctor.status !== 'active') {
    throw errors.doctorInactive(doctor.lastName);
  }
  return doctor;
}
