import Link from 'next/link';
import { listDoctorsAction, operatingRoomsStatus } from '@/actions/doctors';
import { listOperationsForActor, type OperationRowView } from '@/actions/operations';
import { requirePage } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../_components/app-header';
import { AutoDismissAlert } from '../_components/auto-dismiss-alert';
import {
  Alert,
  Button,
  ButtonLink,
  EmptyState,
  FieldLabel,
  Input,
  Select,
  StatusBadge,
} from '../_components/ui';
import { CreateOperationDialog } from './_components/create-operation-dialog';
import { DeleteOperationButton } from './_components/delete-operation-dialog';
import { formatDateTime } from './_components/format';
import { VoidOperationButton } from './_components/void-dialog';

export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
  status?: string;
  doctorId?: string;
  dateFrom?: string;
  dateTo?: string;
  finished?: string;
  voided?: string;
  deleted?: string;
  error?: string;
}

/**
 * Раздел Operations (§7.2, §8.3, §8.5).
 *
 * Блок активных операций стоит первым и показывается при каждом возвращении в
 * раздел: §8.3 требует предлагать возобновление, а §8.5 — держать несколько
 * активных операций одновременно, поэтому кнопка запуска подписана
 * «Start Another Operation», когда активные уже есть. Новая операция никогда не
 * перезаписывает существующую (§18.24) — это свойство домена, а не разметки.
 *
 * История аннулированных операций доступна только Admin (§7.2, Q-34); Staff не
 * получает её ни в списке, ни по прямой ссылке — фильтрация серверная.
 */
export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { account, actor } = await requirePage();
  const params = await searchParams;
  const query = {
    q: params.q ?? '',
    status: params.status ?? 'all',
    doctorId: params.doctorId ?? '',
    dateFrom: params.dateFrom ?? '',
    dateTo: params.dateTo ?? '',
  };
  const db = getDb();
  const result = listOperationsForActor(db, actor, query);
  // Для выбора при создании — только действующие врачи; для фильтра истории —
  // и архивные тоже, иначе их прошлые операции нельзя было бы отобрать.
  const doctors = listDoctorsAction(db, actor);
  const filterDoctors = listDoctorsAction(db, actor, { includeArchived: true });
  const rooms = operatingRoomsStatus(db);

  return (
    <main className="app-shell flex max-w-6xl flex-col">
      <AppHeader
        title="Operations"
        backHref="/"
        backLabel="Home"
        account={{ username: account.username, role: account.role }}
      />

      {params.finished ? (
        <AutoDismissAlert>
          Operation {params.finished} is finished. Quantities and costs are locked.
        </AutoDismissAlert>
      ) : null}
      {params.voided ? (
        <AutoDismissAlert tone="info">
          Operation {params.voided} was voided. All inventory deducted by it was returned.
        </AutoDismissAlert>
      ) : null}
      {params.deleted ? (
        <AutoDismissAlert tone="info">
          Operation {params.deleted} was permanently deleted.
        </AutoDismissAlert>
      ) : null}
      {params.error ? (
        <Alert tone="danger" className="mb-5">{params.error}</Alert>
      ) : null}

      <section className="app-card mb-6 border-emerald-200 bg-emerald-50/60 p-4 sm:p-5">
        <h2 className="mb-4 text-2xl font-bold">Current Operations</h2>

        {/* --- §8.3: блок возобновления --- */}
        {result.active.length > 0 ? (
          <div className="mb-5 rounded-2xl bg-white p-4 ring-1 ring-emerald-300">
            <h2 className="mb-3 text-xl font-semibold">
              {result.active.length === 1
                ? 'Active operation found'
                : `${result.active.length} active operations found`}
            </h2>
            <ul className="flex flex-col gap-3">
              {result.active.map((operation) => (
                <li
                  key={operation.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl bg-emerald-50 p-3"
                >
                  <div className="min-w-40 flex-1">
                    <p className="text-lg">
                      Case:{' '}
                      <span className="font-mono text-2xl font-bold">{operation.caseCode}</span>
                    </p>
                    {operation.doctorName ? (
                      <p className="text-lg text-slate-700">Doctor: {operation.doctorName}</p>
                    ) : null}
                    <p className="text-lg text-slate-700">
                      {operation.unitCount} items scanned · {operation.itemCount} unique
                    </p>
                    <p className="text-base text-slate-600">
                      Started {formatDateTime(operation.createdAtMs)}
                    </p>
                  </div>
                  <Link
                    href={`/operations/${operation.id}`}
                    className="rounded-xl bg-slate-900 px-6 py-4 text-lg font-semibold text-white"
                  >
                    Resume Operation
                  </Link>
                  {operation.canVoid ? (
                    <VoidOperationButton operationId={operation.id} caseCode={operation.caseCode} />
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* --- §7.3: создание операции. Кнопка осталась на прежнем месте --- */}
        <CreateOperationDialog
          doctors={doctors}
          hasActiveOperations={result.active.length > 0}
          rooms={rooms}
        />
      </section>

      <section className="app-card bg-[var(--color-surface-muted)]/50 p-4 sm:p-5">
        <h2 className="mb-4 text-2xl font-bold">Past Operations</h2>

        {/* --- §7.2: поиск и фильтры только для истории --- */}
        <form
          method="get"
          className="mb-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:p-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-12">
            <div className="lg:col-span-3">
              <FieldLabel htmlFor="q">Search by case code</FieldLabel>
              <Input
                id="q"
                name="q"
                type="search"
                defaultValue={query.q}
                className="mt-1 w-full"
              />
            </div>
            <div className="lg:col-span-2">
              <FieldLabel htmlFor="status">Status</FieldLabel>
              <Select
                id="status"
                name="status"
                defaultValue={query.status}
                className="mt-1 w-full"
              >
                <option value="all">All</option>
                <option value="Finished">Finished</option>
                {result.canSeeVoided ? <option value="Voided">Voided</option> : null}
              </Select>
            </div>

          {/*
            Два фильтра истории: по врачу и по дате создания. Активные операции
            они не скрывают — §8.3 требует предлагать возобновление всегда.
            В списке врачей есть и архивные: иначе история архивированного врача
            стала бы недоступна.
          */}
            <div className="lg:col-span-3">
              <FieldLabel htmlFor="doctorId">Doctor</FieldLabel>
              <Select
                id="doctorId"
                name="doctorId"
                defaultValue={query.doctorId}
                className="mt-1 w-full"
              >
                <option value="">All doctors</option>
                {filterDoctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.lastName} ({doctor.code}){doctor.archived ? ' · archived' : ''}
                  </option>
                ))}
              </Select>
            </div>
            <div className="lg:col-span-2">
              <FieldLabel htmlFor="dateFrom">From date</FieldLabel>
              <Input
                id="dateFrom"
                name="dateFrom"
                type="date"
                defaultValue={query.dateFrom}
                className="mt-1 w-full"
              />
            </div>
            <div className="lg:col-span-2">
              <FieldLabel htmlFor="dateTo">To date</FieldLabel>
              <Input
                id="dateTo"
                name="dateTo"
                type="date"
                defaultValue={query.dateTo}
                className="mt-1 w-full"
              />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:justify-end">
            <Button type="submit">Apply Filters</Button>
            <ButtonLink href="/operations" variant="secondary">
              Clear Filters
            </ButtonLink>
          </div>
        </form>

        <OperationHistory
          title="Finished operations"
          operations={result.finished}
          emptyLabel="No finished operations yet."
          totalLabel={result.finishedTotalFormatted}
        />

        {result.canSeeVoided ? (
          <div className="mt-5">
            <OperationHistory
              title="Voided operations"
              operations={result.voided}
              emptyLabel="No voided operations."
            />
          </div>
        ) : null}
      </section>
    </main>
  );
}

/**
 * Строка истории (§7.2, §12.1).
 *
 * Восемь полей §12.1: код операции, статус, дата создания, дата завершения или
 * аннулирования, категория (если используется), количество уникальных предметов,
 * общее количество использованных единиц и общая себестоимость для Admin.
 *
 * Себестоимость печатается только если сервер её прислал: для Staff при
 * выключенной настройке поля стоимости отсутствуют в ответе вовсе (D-18).
 * Итог берётся из снимка завершённой операции, а не из текущих цен (§18.16).
 */
function OperationHistory({
  title,
  operations,
  emptyLabel,
  totalLabel,
}: {
  title: string;
  operations: OperationRowView[];
  emptyLabel: string;
  totalLabel?: string;
}) {
  return (
    <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold">{title}</h2>
        {totalLabel ? (
          <p className="text-lg text-slate-700">
            Total cost: <strong>{totalLabel}</strong>
          </p>
        ) : null}
      </div>

      {operations.length === 0 ? (
        <EmptyState title={emptyLabel} description="Try changing the search or status filter." />
      ) : (
        <ul className="flex flex-col gap-2">
          {operations.map((operation) => (
            <li
              key={operation.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3"
            >
              <div className="min-w-40 flex-1">
                <p className="font-mono text-xl font-bold">{operation.caseCode}</p>
                {operation.doctorName ? (
                  <p className="text-base text-slate-700">Doctor: {operation.doctorName}</p>
                ) : null}
                <p className="text-base text-slate-600">
                  Created {formatDateTime(operation.createdAtMs)}
                  {operation.finishedAtMs
                    ? ` · Finished ${formatDateTime(operation.finishedAtMs)}`
                    : ''}
                  {operation.voidedAtMs ? ` · Voided ${formatDateTime(operation.voidedAtMs)}` : ''}
                </p>
                {/* §12.1: категория показывается, если она используется (D-35). */}
                {operation.procedureCategory ? (
                  <p className="text-base text-slate-600">{operation.procedureCategory}</p>
                ) : null}
                {/* C-10: «уникальные предметы» и «использованные единицы» — разные величины. */}
                <p className="text-lg text-slate-700">
                  {operation.itemCount} unique items · {operation.unitCount} units used
                  {operation.totalCostFormatted
                    ? ` · Cost ${operation.totalCostFormatted}`
                    : ''}
                </p>
              </div>

              <StatusBadge tone={operation.status === 'Finished' ? 'success' : 'danger'}>
                {operation.status}
              </StatusBadge>

              <Link
                href={`/operations/${operation.id}`}
                className="rounded-xl border border-slate-300 px-5 py-3 text-lg font-medium"
              >
                View
              </Link>

              {operation.canVoid ? (
                <VoidOperationButton operationId={operation.id} caseCode={operation.caseCode} />
              ) : null}

              {operation.canDelete ? (
                <DeleteOperationButton
                  operationId={operation.id}
                  caseCode={operation.caseCode}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
