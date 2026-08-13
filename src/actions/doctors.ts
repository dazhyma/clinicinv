/**
 * Действия над справочником врачей.
 *
 * Границы слоя те же, что в `items.ts`: роль (§3.2, §18.22) → валидация ввода →
 * вызов домена → конкретное сообщение (§14.4). Роль проверяется и здесь, и в
 * домене (D-10): прямой POST из-под Staff получает отказ, даже если кнопки в
 * интерфейсе он не видел.
 */
import type { AppDatabase } from '@/db/client';
import { isAdmin, type Actor } from '@/domain/actor';
import { suggestDoctorCode } from '@/domain/codes';
import {
  countOperationsForDoctor,
  createDoctor,
  deleteDoctor,
  listDoctors,
  updateDoctor,
} from '@/domain/doctors';
import {
  countActiveOperations,
  displayCaseCode,
  findActiveOperationForDoctor,
  OPERATING_ROOMS,
} from '@/domain/operations';
import { FieldValidator, type RawFormValue } from './parse';
import { failFields, forbidden, runAction, type ActionResult } from './result';

export interface DoctorView {
  id: number;
  code: string;
  lastName: string;
  fullName: string | null;
  archived: boolean;
  /** Сколько операций уже привязано — от этого зависит текст кнопки Delete. */
  operationCount: number;
  /**
   * Незакрытая операция врача, если она есть. Пока она не завершена, начать у
   * этого врача следующую нельзя — поле нужно интерфейсу, чтобы объяснить это
   * до нажатия, а не отказом после.
   */
  activeOperation: { id: number; caseCode: string } | null;
}

/**
 * Список врачей для выбора и для экрана настроек.
 *
 * Читать справочник может любой аутентифицированный пользователь: без него
 * Staff не сможет начать операцию. Изменять — только Admin.
 */
export function listDoctorsAction(
  db: AppDatabase,
  _actor: Actor,
  options: { includeArchived?: boolean } = {},
): DoctorView[] {
  // Архивные нужны и Staff — иначе фильтр истории по такому врачу пропадёт.
  return listDoctors(db, { includeArchived: options.includeArchived === true }).map((doctor) => {
    const active = findActiveOperationForDoctor(db, doctor.id);
    return {
      id: doctor.id,
      code: doctor.code,
      lastName: doctor.lastName,
      fullName: doctor.fullName,
      archived: doctor.archivedAt != null,
      operationCount: countOperationsForDoctor(db, doctor.id),
      activeOperation: active
        ? { id: active.id, caseCode: displayCaseCode(active) }
        : null,
    };
  });
}

/** Заняты ли все операционные кабинеты. Читают экран операций и диалог создания. */
export function operatingRoomsStatus(db: AppDatabase): {
  activeCount: number;
  rooms: number;
  allBusy: boolean;
} {
  const activeCount = countActiveOperations(db);
  return { activeCount, rooms: OPERATING_ROOMS, allBusy: activeCount >= OPERATING_ROOMS };
}

/** Подсказка кода для формы: две буквы фамилии. Поле остаётся редактируемым. */
export function suggestDoctorCodeAction(lastName: string): string {
  return suggestDoctorCode(lastName ?? '');
}

export interface DoctorInput {
  lastName?: RawFormValue;
  fullName?: RawFormValue;
  code?: RawFormValue;
}

export function createDoctorAction(
  db: AppDatabase,
  actor: Actor,
  input: DoctorInput,
): ActionResult<DoctorView> {
  if (!isAdmin(actor)) return forbidden('manage doctors');

  const v = new FieldValidator();
  const lastName = v.requiredText('lastName', input.lastName, 'Last name', 120);
  const fullName = v.optionalText('fullName', input.fullName, 200);
  // Код необязателен: пустое поле означает «предложи по фамилии».
  const code = v.optionalText('code', input.code, 4);
  if (v.hasErrors) return failFields(v.errors);

  return runAction(() => {
    const doctor = createDoctor(db, actor, { lastName, fullName, code });
    return {
      id: doctor.id,
      code: doctor.code,
      lastName: doctor.lastName,
      fullName: doctor.fullName,
      archived: false,
      operationCount: 0,
      activeOperation: null,
    };
  });
}

export function updateDoctorAction(
  db: AppDatabase,
  actor: Actor,
  input: DoctorInput & { doctorId?: RawFormValue },
): ActionResult<DoctorView> {
  if (!isAdmin(actor)) return forbidden('manage doctors');

  const v = new FieldValidator();
  const doctorId = v.requiredInteger('doctorId', input.doctorId, 'Doctor', { min: 1 });
  const lastName = v.requiredText('lastName', input.lastName, 'Last name', 120);
  const fullName = v.optionalText('fullName', input.fullName, 200);
  const code = v.requiredText('code', input.code, 'Doctor code', 4);
  if (v.hasErrors) return failFields(v.errors);

  return runAction(() => {
    const doctor = updateDoctor(db, actor, { doctorId, lastName, fullName, code });
    return {
      id: doctor.id,
      code: doctor.code,
      lastName: doctor.lastName,
      fullName: doctor.fullName,
      archived: doctor.archivedAt != null,
      operationCount: countOperationsForDoctor(db, doctor.id),
      activeOperation: (() => {
        const active = findActiveOperationForDoctor(db, doctor.id);
        return active ? { id: active.id, caseCode: displayCaseCode(active) } : null;
      })(),
    };
  });
}

export interface DeletedDoctor {
  doctorId: number;
  lastName: string;
  disposition: 'deleted' | 'archived';
  operationCount: number;
}

export function deleteDoctorAction(
  db: AppDatabase,
  actor: Actor,
  doctorId: RawFormValue,
): ActionResult<DeletedDoctor> {
  if (!isAdmin(actor)) return forbidden('manage doctors');

  const v = new FieldValidator();
  const id = v.requiredInteger('doctorId', doctorId, 'Doctor', { min: 1 });
  if (v.hasErrors) return failFields(v.errors);

  return runAction(() => {
    const before = listDoctors(db, { includeArchived: true }).find((row) => row.id === id);
    const result = deleteDoctor(db, actor, id);
    return {
      doctorId: id,
      lastName: result.doctor?.lastName ?? before?.lastName ?? 'Doctor',
      disposition: result.disposition,
      operationCount: result.operationCount,
    };
  });
}
