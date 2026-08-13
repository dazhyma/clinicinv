'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { DoctorView } from '@/actions/doctors';
import { Alert, Button, buttonClassName, FieldLabel, Select } from '../../_components/ui';
import { startOperationFormAction } from '../actions';

/**
 * Окно «Create Operation» (новое дополнение к ТЗ).
 *
 * Кнопка остаётся ровно там же, где раньше стояла Start New Operation, и
 * подписывается так же при наличии активных операций (§8.5): диалог добавляет
 * один шаг выбора врача, а не переносит запуск операции в другое место.
 *
 * Операция создаётся серверным действием формы — не в клиентском обработчике:
 * запись обязана появиться на сервере ДО перехода на экран сканирования (§8.1),
 * а роль и существование врача проверяются на сервере в любом случае.
 */
export function CreateOperationDialog({
  doctors,
  hasActiveOperations,
  rooms,
}: {
  doctors: DoctorView[];
  hasActiveOperations: boolean;
  /** Сколько операционных кабинетов и сколько из них занято прямо сейчас. */
  rooms: { activeCount: number; rooms: number; allBusy: boolean };
}) {
  const [open, setOpen] = useState(false);
  const label = hasActiveOperations ? 'Start Another Operation' : 'Create Operation';
  // Врач с незакрытой операцией и переполненные кабинеты объясняются ДО выбора:
  // сервер откажет в любом случае, но узнавать об этом отказом — плохо.
  const available = doctors.filter((doctor) => !doctor.activeOperation);
  const blocked = rooms.allBusy || available.length === 0;

  return (
    <>
      <Button
        type="button"
        size="large"
        className="w-full px-7 text-xl sm:w-auto sm:px-9"
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>

      {open ? (
        <div
          className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-operation-title"
            className="modal-panel app-card w-full max-w-lg p-6 shadow-[var(--shadow-raised)]"
          >
            <h2 id="create-operation-title" className="text-2xl font-bold">
              Create Operation
            </h2>
            <p className="mt-2 text-slate-700">
              The operation code is built from the doctor&rsquo;s code and the next number for
              that doctor, for example CH00001.
            </p>

            {doctors.length === 0 || blocked ? (
              <>
                <Alert tone="warning" className="mt-5">
                  {doctors.length === 0
                    ? 'No doctors have been added yet. An administrator adds them in Settings → Doctors.'
                    : rooms.allBusy
                      ? `All ${rooms.rooms} operating rooms are in use. Finish one of the active operations before starting another.`
                      : 'Every doctor already has an active operation. Finish one before starting another.'}
                </Alert>

                {/* Что именно мешает: код операции и ссылка прямо в диалоге. */}
                {doctors.some((doctor) => doctor.activeOperation) ? (
                  <ul className="mt-4 flex flex-col gap-2">
                    {doctors
                      .filter((doctor) => doctor.activeOperation)
                      .map((doctor) => (
                        <li
                          key={doctor.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"
                        >
                          <span className="text-lg">
                            {doctor.lastName} —{' '}
                            <span className="font-mono font-bold">
                              {doctor.activeOperation?.caseCode}
                            </span>
                          </span>
                          <Link
                            href={`/operations/${doctor.activeOperation?.id}`}
                            className={buttonClassName({ variant: 'secondary', size: 'compact' })}
                          >
                            Resume
                          </Link>
                        </li>
                      ))}
                  </ul>
                ) : null}

                <div className="mt-6 flex justify-end">
                  <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
                    Close
                  </Button>
                </div>
              </>
            ) : (
              <form action={startOperationFormAction} className="mt-5">
                <FieldLabel htmlFor="doctorId">Doctor</FieldLabel>
                <Select
                  id="doctorId"
                  name="doctorId"
                  autoFocus
                  required
                  defaultValue={available.length === 1 ? String(available[0]?.id ?? '') : ''}
                  className="mt-1 w-full text-lg"
                >
                  <option value="" disabled>
                    Select a doctor…
                  </option>
                  {doctors.map((doctor) => (
                    <option
                      key={doctor.id}
                      value={doctor.id}
                      disabled={doctor.activeOperation != null}
                    >
                      {doctor.lastName} ({doctor.code})
                      {doctor.activeOperation
                        ? ` — busy with ${doctor.activeOperation.caseCode}`
                        : ''}
                    </option>
                  ))}
                </Select>
                <p className="mt-2 text-base text-slate-600">
                  A doctor can run one operation at a time, and {rooms.rooms} operations at most
                  can be active together — the clinic has {rooms.rooms} operating rooms.
                </p>

                <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <ConfirmButton />
                </div>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}

/**
 * Кнопка подтверждения блокируется на время запроса. Это защита от второго
 * нажатия в интерфейсе, а не от двойного создания: операция создаётся одной
 * транзакцией с выдачей номера из счётчика.
 */
function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Creating…' : 'Create Operation'}
    </Button>
  );
}
