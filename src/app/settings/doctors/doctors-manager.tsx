'use client';

import { useActionState, useState } from 'react';
import type { DoctorView } from '@/actions/doctors';
import { suggestDoctorCode } from '@/domain/doctor-code';
import { Field, ErrorBanner, SubmitButton, SuccessBanner } from '../../inventory/_components/form-field';
import { Alert, Button, Card, EmptyState, StatusBadge } from '../../_components/ui';
import type { FormState } from '../../inventory/actions';
import {
  createDoctorFormAction,
  deleteDoctorFormAction,
  updateDoctorFormAction,
} from './actions';

const initialState: FormState = {};

/**
 * Справочник врачей (§3.3, новое дополнение к ТЗ).
 *
 * Код подставляется из фамилии по мере ввода, но поле остаётся полностью
 * редактируемым: у двух врачей фамилии могут начинаться одинаково, и развести
 * их обязан человек. Как только администратор правит код руками, автоподстановка
 * для этой формы прекращается — иначе следующая буква фамилии затёрла бы ввод.
 */
export function DoctorsManager({ doctors }: { doctors: DoctorView[] }) {
  const active = doctors.filter((doctor) => !doctor.archived);
  const archived = doctors.filter((doctor) => doctor.archived);

  return (
    <div className="flex flex-col gap-6">
      <AddDoctorCard />

      <Card className="p-5 sm:p-6">
        <h2 className="text-xl font-semibold">Doctors</h2>
        <p className="mt-1 mb-4 text-base text-slate-600">
          The doctor code is the prefix of every surgery code for that doctor, for example
          CH00001. Changing a code does not rewrite surgeries that already exist.
        </p>

        {active.length === 0 ? (
          <EmptyState
            title="No doctors yet."
            description="Add the first doctor above — a surgery cannot be created without one."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {active.map((doctor) => (
              <DoctorRow key={doctor.id} doctor={doctor} />
            ))}
          </ul>
        )}
      </Card>

      {archived.length > 0 ? (
        <Card className="p-5 sm:p-6">
          <h2 className="text-xl font-semibold">Archived doctors</h2>
          <p className="mt-1 mb-4 text-base text-slate-600">
            Archived doctors cannot be selected for a new surgery. Their past surgeries keep
            their codes, and their numbering never restarts.
          </p>
          <ul className="flex flex-col gap-3">
            {archived.map((doctor) => (
              <li
                key={doctor.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3"
              >
                <div className="min-w-40 flex-1">
                  <p className="text-lg font-semibold">{doctor.lastName}</p>
                  <p className="font-mono text-base text-slate-600">{doctor.code}</p>
                </div>
                <StatusBadge tone="neutral">Archived</StatusBadge>
                <span className="text-base text-slate-600">
                  {doctor.operationCount} surgery record(s)
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function AddDoctorCard() {
  const [state, formAction] = useActionState(createDoctorFormAction, initialState);
  const [lastName, setLastName] = useState('');
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const fieldErrors = state.fieldErrors ?? {};

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-xl font-semibold">Add Doctor</h2>
      <p className="mt-1 mb-5 text-base text-slate-600">
        The code is suggested from the last name and stays editable.
      </p>

      <form action={formAction} className="flex flex-col gap-4">
        <ErrorBanner message={state.error} />
        {state.ok ? <SuccessBanner message={state.message} /> : null}

        <Field name="lastName" label="Last name" required error={fieldErrors.lastName}>
          {(props) => (
            <input
              {...props}
              type="text"
              value={lastName}
              maxLength={120}
              onChange={(event) => {
                setLastName(event.target.value);
                if (!codeTouched) setCode(suggestDoctorCode(event.target.value));
              }}
            />
          )}
        </Field>

        <Field
          name="code"
          label="Doctor code"
          error={fieldErrors.code}
          hint="Two to four letters (A–Z). Suggested from the last name; edit it if two doctors would clash."
        >
          {(props) => (
            <input
              {...props}
              type="text"
              value={code}
              maxLength={4}
              className={`${props.className} font-mono uppercase`}
              onChange={(event) => {
                setCodeTouched(true);
                setCode(event.target.value.toUpperCase());
              }}
            />
          )}
        </Field>

        <Field name="fullName" label="Full name" error={fieldErrors.fullName}>
          {(props) => <input {...props} type="text" maxLength={200} />}
        </Field>

        <div>
          <SubmitButton pendingLabel="Adding…">Add Doctor</SubmitButton>
        </div>
      </form>
    </Card>
  );
}

function DoctorRow({ doctor }: { doctor: DoctorView }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction] = useActionState(updateDoctorFormAction, initialState);
  const fieldErrors = state.fieldErrors ?? {};

  return (
    <li className="rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-40 flex-1">
          <p className="text-lg font-semibold">{doctor.lastName}</p>
          <p className="font-mono text-base text-slate-600">{doctor.code}</p>
          {doctor.fullName ? (
            <p className="text-base text-slate-600">{doctor.fullName}</p>
          ) : null}
        </div>
        <span className="text-base text-slate-600">{doctor.operationCount} surgery record(s)</span>
        <Button
          variant="secondary"
          size="compact"
          type="button"
          onClick={() => setEditing((value) => !value)}
        >
          {editing ? 'Close' : 'Edit'}
        </Button>
        <DeleteDoctorButton doctor={doctor} />
      </div>

      {state.ok ? <SuccessBanner message={state.message} /> : null}

      {editing ? (
        <form action={formAction} className="mt-4 flex flex-col gap-4 border-t border-slate-200 pt-4">
          <ErrorBanner message={state.error} />
          <input type="hidden" name="doctorId" value={doctor.id} />

          <Field name={`lastName-${doctor.id}`} label="Last name" required error={fieldErrors.lastName}>
            {(props) => (
              <input {...props} name="lastName" type="text" defaultValue={doctor.lastName} maxLength={120} />
            )}
          </Field>

          <Field
            name={`code-${doctor.id}`}
            label="Doctor code"
            required
            error={fieldErrors.code}
            hint="Surgeries created earlier keep the code they were issued."
          >
            {(props) => (
              <input
                {...props}
                name="code"
                type="text"
                defaultValue={doctor.code}
                maxLength={4}
                className={`${props.className} font-mono uppercase`}
              />
            )}
          </Field>

          <Field name={`fullName-${doctor.id}`} label="Full name" error={fieldErrors.fullName}>
            {(props) => (
              <input
                {...props}
                name="fullName"
                type="text"
                defaultValue={doctor.fullName ?? ''}
                maxLength={200}
              />
            )}
          </Field>

          <div>
            <SubmitButton>Save Doctor</SubmitButton>
          </div>
        </form>
      ) : null}
    </li>
  );
}

/**
 * Delete Doctor. Врач без операций удаляется, врач с операциями архивируется —
 * поэтому подтверждение прямо называет исход, а не спрашивает «вы уверены?».
 */
function DeleteDoctorButton({ doctor }: { doctor: DoctorView }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(deleteDoctorFormAction, initialState);
  const willArchive = doctor.operationCount > 0;

  return (
    <>
      <Button variant="danger" size="compact" type="button" onClick={() => setOpen(true)}>
        Delete
      </Button>

      {open ? (
        <div
          className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !pending) setOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={`delete-doctor-${doctor.id}`}
            className="modal-panel app-card w-full max-w-lg p-6 shadow-[var(--shadow-raised)]"
          >
            <h2 id={`delete-doctor-${doctor.id}`} className="text-2xl font-bold">
              {willArchive ? 'Archive doctor' : 'Delete doctor'}
            </h2>
            <p className="mt-3 text-slate-700">
              {willArchive
                ? `${doctor.lastName} is used by ${doctor.operationCount} surgery record(s), so the record is archived instead of deleted. Those surgeries keep their codes, and ${doctor.code} numbering never restarts.`
                : `${doctor.lastName} has no surgeries and will be removed completely.`}
            </p>

            {state.error ? (
              <Alert tone="danger" className="mt-4">
                {state.error}
              </Alert>
            ) : null}

            <form
              action={formAction}
              className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"
            >
              <input type="hidden" name="doctorId" value={doctor.id} />
              <Button variant="secondary" type="button" disabled={pending} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" type="submit" disabled={pending}>
                {pending ? 'Working…' : willArchive ? 'Archive Doctor' : 'Delete Doctor'}
              </Button>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
