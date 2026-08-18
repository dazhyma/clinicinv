'use client';

import Link from 'next/link';
import { useActionState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { DoctorView } from '@/actions/doctors';
import type { OperationListResult, OperationRowView } from '@/actions/operations';
import {
  Alert,
  Button,
  ButtonLink,
  EmptyState,
  FieldLabel,
  FilterActions,
  Input,
  Select,
  StatusBadge,
} from '../../_components/ui';
import {
  searchPastSurgeriesFormAction,
  type PatientSurgerySearchState,
} from '../actions';
import { DeleteOperationButton } from './delete-operation-dialog';
import { formatDateTime } from './format';
import { VoidOperationButton } from './void-dialog';

const initialSearchState: PatientSurgerySearchState = {};

interface Filters {
  q: string;
  status: string;
  doctorId: string;
  dateFrom: string;
  dateTo: string;
}

export function PastSurgeries({
  initialResult,
  doctors,
  filters,
}: {
  initialResult: OperationListResult;
  doctors: DoctorView[];
  filters: Filters;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(searchPastSurgeriesFormAction, initialSearchState);
  const result = state.result ?? initialResult;
  const noPatientMatches =
    state.searched && state.result && result.finished.length === 0 && result.voided.length === 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    if (String(data.get('patientId') ?? '').trim()) return;

    event.preventDefault();
    const params = new URLSearchParams();
    for (const name of ['q', 'status', 'doctorId', 'dateFrom', 'dateTo']) {
      const value = String(data.get(name) ?? '');
      if (value && !(name === 'status' && value === 'all')) params.set(name, value);
    }
    router.push(params.size ? `/operations?${params.toString()}` : '/operations');
  }

  return (
    <>
      <form
        action={formAction}
        onSubmit={submit}
        className="mb-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:p-4"
      >
        {state.error ? <Alert tone="danger" className="mb-3">{state.error}</Alert> : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-12">
          <div className="lg:col-span-3">
            <FieldLabel htmlFor="q">Search by case code</FieldLabel>
            <Input id="q" name="q" type="search" defaultValue={filters.q} className="mt-1 w-full" />
          </div>
          <div className="lg:col-span-3">
            <FieldLabel htmlFor="patientId">Search by Patient ID</FieldLabel>
            <Input
              id="patientId"
              name="patientId"
              type="search"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={64}
              autoComplete="off"
              spellCheck={false}
              placeholder="Enter Patient ID"
              aria-invalid={state.fieldErrors?.patientId ? true : undefined}
              aria-describedby={state.fieldErrors?.patientId ? 'patientId-search-error' : 'patientId-search-hint'}
              className="mt-1 w-full"
            />
            <p id="patientId-search-hint" className="sr-only">
              Exact match. The value is submitted securely and is not added to the URL.
            </p>
            {state.fieldErrors?.patientId ? (
              <p id="patientId-search-error" role="alert" className="mt-1 text-sm font-medium text-red-700">
                {state.fieldErrors.patientId}
              </p>
            ) : null}
          </div>
          <div className="lg:col-span-2">
            <FieldLabel htmlFor="status">Status</FieldLabel>
            <Select id="status" name="status" defaultValue={filters.status} className="mt-1 w-full">
              <option value="all">All</option>
              <option value="Finished">Finished</option>
              {result.canSeeVoided ? <option value="Voided">Voided</option> : null}
            </Select>
          </div>
          <div className="lg:col-span-4">
            <FieldLabel htmlFor="doctorId">Doctor</FieldLabel>
            <Select id="doctorId" name="doctorId" defaultValue={filters.doctorId} className="mt-1 w-full">
              <option value="">All doctors</option>
              {doctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.lastName} ({doctor.code}){doctor.archived ? ' · archived' : ''}
                </option>
              ))}
            </Select>
          </div>
          <div className="lg:col-span-2 lg:col-start-9">
            <FieldLabel htmlFor="dateFrom">From date</FieldLabel>
            <Input id="dateFrom" name="dateFrom" type="date" defaultValue={filters.dateFrom} className="mt-1 w-full" />
          </div>
          <div className="lg:col-span-2">
            <FieldLabel htmlFor="dateTo">To date</FieldLabel>
            <Input id="dateTo" name="dateTo" type="date" defaultValue={filters.dateTo} className="mt-1 w-full" />
          </div>
        </div>

        <FilterActions>
          <Button type="submit">Apply Filters</Button>
          <ButtonLink href="/operations" variant="secondary">Clear Filters</ButtonLink>
        </FilterActions>
      </form>

      {noPatientMatches ? (
        <EmptyState
          title="No surgeries found for this Patient ID."
          description="Check the Patient ID or clear the filters and try again."
        />
      ) : (
        <>
          <SurgeryHistory
            title="Finished surgeries"
            surgeries={result.finished}
            emptyLabel="No finished surgeries yet."
            totalLabel={result.finishedTotalFormatted}
          />

          {result.canSeeVoided ? (
            <div className="mt-5">
              <SurgeryHistory
                title="Voided surgeries"
                surgeries={result.voided}
                emptyLabel="No voided surgeries."
              />
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

function SurgeryHistory({
  title,
  surgeries,
  emptyLabel,
  totalLabel,
}: {
  title: string;
  surgeries: OperationRowView[];
  emptyLabel: string;
  totalLabel?: string;
}) {
  return (
    <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold">{title}</h2>
        {totalLabel ? <p className="text-lg text-slate-700">Total cost: <strong>{totalLabel}</strong></p> : null}
      </div>

      {surgeries.length === 0 ? (
        <EmptyState title={emptyLabel} description="Try changing the search or status filter." />
      ) : (
        <ul className="flex flex-col gap-2">
          {surgeries.map((surgery) => (
            <li key={surgery.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3">
              <div className="min-w-40 flex-1">
                <p className="font-mono text-xl font-bold">{surgery.caseCode}</p>
                {surgery.patientId !== undefined ? (
                  <p className="text-base text-slate-700">Patient ID: {surgery.patientId ?? 'Not provided'}</p>
                ) : null}
                {surgery.doctorName ? <p className="text-base text-slate-700">Doctor: {surgery.doctorName}</p> : null}
                <p className="text-base text-slate-600">
                  Created {formatDateTime(surgery.createdAtMs)}
                  {surgery.finishedAtMs ? ` · Finished ${formatDateTime(surgery.finishedAtMs)}` : ''}
                  {surgery.voidedAtMs ? ` · Voided ${formatDateTime(surgery.voidedAtMs)}` : ''}
                </p>
                {surgery.procedureCategory ? <p className="text-base text-slate-600">{surgery.procedureCategory}</p> : null}
                <p className="text-lg text-slate-700">
                  {surgery.itemCount} unique items · {surgery.unitCount} units used
                  {surgery.totalCostFormatted ? ` · Cost ${surgery.totalCostFormatted}` : ''}
                </p>
              </div>

              <StatusBadge tone={surgery.status === 'Finished' ? 'success' : 'danger'}>{surgery.status}</StatusBadge>
              <Link href={`/operations/${surgery.id}`} className="rounded-xl border border-slate-300 px-5 py-3 text-lg font-medium">
                View
              </Link>
              {surgery.canVoid ? <VoidOperationButton operationId={surgery.id} caseCode={surgery.caseCode} /> : null}
              {surgery.canDelete ? <DeleteOperationButton operationId={surgery.id} caseCode={surgery.caseCode} /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
