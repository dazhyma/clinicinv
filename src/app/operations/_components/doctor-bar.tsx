'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { DoctorView } from '@/actions/doctors';
import { Alert, Button, FieldLabel, Select } from '../../_components/ui';
import { changeOperationDoctorServerAction } from '../actions';

/**
 * Врач активной операции (новое дополнение к ТЗ).
 *
 * Staff видит фамилию, но не может её изменить: селектор рисуется только при
 * `canChange`. Это удобство интерфейса, а не защита — сервер отклоняет смену
 * врача из-под Staff в действии и ещё раз в домене (D-10).
 *
 * Смена врача выдаёт НОВОЕ обозначение из счётчика нового врача, поэтому
 * предупреждение об этом стоит рядом с полем, а не после нажатия.
 */
export function OperationDoctorBar({
  operationId,
  doctorId,
  doctorName,
  caseCode,
  canChange,
  doctors,
}: {
  operationId: number;
  doctorId: number | null;
  doctorName: string | null;
  caseCode: string;
  canChange: boolean;
  doctors: DoctorView[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(doctorId ? String(doctorId) : '');
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  function submit() {
    const nextDoctorId = Number(selected);
    if (!Number.isSafeInteger(nextDoctorId) || nextDoctorId <= 0) {
      setError('Select a doctor');
      return;
    }
    setError(undefined);
    startTransition(async () => {
      const result = await changeOperationDoctorServerAction({ operationId, doctorId: nextDoctorId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      // Смена врача выдаёт НОВОЕ обозначение, а его крупно печатает шапка
      // OperationScreen из своего состояния. Без refresh экран продолжил бы
      // показывать прежний код — и персонал записал бы в карту не тот.
      router.refresh();
    });
  }

  return (
    <section className="app-card mb-4 p-4 sm:p-5">
      {/*
        Код операции здесь не дублируется: его крупно печатает шапка
        OperationScreen прямо под этой полосой.
      */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-base text-slate-600">Doctor</p>
          <p className="text-xl font-semibold">{doctorName ?? '—'}</p>
        </div>
        {canChange && !editing ? (
          <Button variant="secondary" size="compact" type="button" onClick={() => setEditing(true)}>
            Change Doctor
          </Button>
        ) : null}
      </div>

      {canChange && editing ? (
        <div className="mt-4">
          <FieldLabel htmlFor="operation-doctor">Doctor</FieldLabel>
          <Select
            id="operation-doctor"
            value={selected}
            disabled={pending}
            onChange={(event) => setSelected(event.target.value)}
            className="mt-1 w-full text-lg"
          >
            <option value="" disabled>
              Select a doctor…
            </option>
            {/*
              Врач с собственной незакрытой операцией недоступен: перенос создал
              бы у него вторую. Текущий врач этой операции остаётся выбираемым.
            */}
            {doctors.map((doctor) => {
              const busyElsewhere =
                doctor.activeOperation != null && doctor.activeOperation.id !== operationId;
              return (
                <option key={doctor.id} value={doctor.id} disabled={busyElsewhere}>
                  {doctor.lastName} ({doctor.code})
                  {busyElsewhere ? ` — busy with ${doctor.activeOperation?.caseCode}` : ''}
                </option>
              );
            })}
          </Select>

          <Alert tone="warning" className="mt-3">
            Changing the doctor issues a new case code from that doctor&rsquo;s numbering. The
            current code {caseCode} is not reused.
          </Alert>

          {error ? (
            <Alert tone="danger" className="mt-3">
              {error}
            </Alert>
          ) : null}

          <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              type="button"
              disabled={pending}
              onClick={() => {
                setEditing(false);
                setError(undefined);
                setSelected(doctorId ? String(doctorId) : '');
              }}
            >
              Cancel
            </Button>
            <Button type="button" disabled={pending} onClick={submit}>
              {pending ? 'Saving…' : 'Save Doctor'}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
