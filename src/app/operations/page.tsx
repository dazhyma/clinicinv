import Link from 'next/link';
import { listOperationsForActor, type OperationRowView } from '@/actions/operations';
import { requirePage } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../_components/app-header';
import { formatDateTime } from './_components/format';
import { VoidOperationButton } from './_components/void-dialog';
import { startOperationFormAction } from './actions';

export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
  status?: string;
  finished?: string;
  voided?: string;
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
  const query = { q: params.q ?? '', status: params.status ?? 'all' };

  const result = listOperationsForActor(getDb(), actor, query);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col p-4 sm:p-6">
      <AppHeader title="Operations" backHref="/" backLabel="Home" account={account} />

      {params.finished ? (
        <p role="status" className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-lg text-emerald-900">
          Operation {params.finished} is finished. Quantities and costs are locked.
        </p>
      ) : null}
      {params.voided ? (
        <p role="status" className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-lg text-amber-900">
          Operation {params.voided} was voided. All inventory deducted by it was returned.
        </p>
      ) : null}
      {params.error ? (
        <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-lg text-red-800">
          {params.error}
        </p>
      ) : null}

      {/* --- §8.3: блок возобновления --- */}
      {result.active.length > 0 ? (
        <section className="mb-5 rounded-2xl border-2 border-emerald-500 bg-white p-4">
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
                    Case: <span className="font-mono text-2xl font-bold">{operation.caseCode}</span>
                  </p>
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
        </section>
      ) : null}

      {/* --- §7.3: Start New Operation --- */}
      <form action={startOperationFormAction} className="mb-5">
        <button
          type="submit"
          className="w-full rounded-2xl bg-slate-900 px-6 py-5 text-2xl font-bold text-white sm:w-auto sm:px-10"
        >
          {result.active.length > 0 ? 'Start Another Operation' : 'Start New Operation'}
        </button>
      </form>

      {/* --- §7.2: поиск и фильтры --- */}
      <form method="get" className="mb-5 flex flex-wrap items-end gap-3">
        <div className="min-w-52 flex-1">
          <label htmlFor="q" className="text-base font-medium">
            Search by case code
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={query.q}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-lg"
          />
        </div>
        <div>
          <label htmlFor="status" className="text-base font-medium">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={query.status}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-lg"
          >
            <option value="all">All</option>
            <option value="Active">Active</option>
            <option value="Finished">Finished</option>
            {result.canSeeVoided ? <option value="Voided">Voided</option> : null}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-lg font-semibold"
        >
          Apply
        </button>
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
        <p className="text-lg text-slate-600">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {operations.map((operation) => (
            <li
              key={operation.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3"
            >
              <div className="min-w-40 flex-1">
                <p className="font-mono text-xl font-bold">{operation.caseCode}</p>
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

              <span
                className={`rounded-full px-4 py-2 text-base font-semibold ${
                  operation.status === 'Finished'
                    ? 'bg-slate-200 text-slate-800'
                    : 'bg-red-100 text-red-900'
                }`}
              >
                {operation.status}
              </span>

              <Link
                href={`/operations/${operation.id}`}
                className="rounded-xl border border-slate-300 px-5 py-3 text-lg font-medium"
              >
                View
              </Link>

              {operation.canVoid ? (
                <VoidOperationButton operationId={operation.id} caseCode={operation.caseCode} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
