import Link from 'next/link';
import { listDoctorsAction, operatingRoomsStatus } from '@/actions/doctors';
import { listOperationsForActor } from '@/actions/operations';
import { requirePage } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../_components/app-header';
import { AutoDismissAlert } from '../_components/auto-dismiss-alert';
import { Alert } from '../_components/ui';
import { CreateOperationDialog } from './_components/create-operation-dialog';
import { formatDateTime } from './_components/format';
import { PastSurgeries } from './_components/past-surgeries';
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
        title="Surgeries"
        backHref="/"
        backLabel="Home"
        account={{ username: account.username, role: account.role }}
      />

      {params.finished ? (
        <AutoDismissAlert>
          Surgery {params.finished} is finished. Quantities and costs are locked.
        </AutoDismissAlert>
      ) : null}
      {params.voided ? (
        <AutoDismissAlert tone="info">
          Surgery {params.voided} was voided. All inventory deducted by it was returned.
        </AutoDismissAlert>
      ) : null}
      {params.deleted ? (
        <AutoDismissAlert tone="info">
          Surgery {params.deleted} was permanently deleted.
        </AutoDismissAlert>
      ) : null}
      {params.error ? (
        <Alert tone="danger" className="mb-5">{params.error}</Alert>
      ) : null}

      <section className="app-card mb-6 border-emerald-200 bg-emerald-50/60 p-4 sm:p-5">
        <h2 className="mb-4 text-2xl font-bold">Current Surgeries</h2>

        {/* --- §8.3: блок возобновления --- */}
        {result.active.length > 0 ? (
          <div className="mb-5 rounded-2xl bg-white p-4 ring-1 ring-emerald-300">
            <h2 className="mb-3 text-xl font-semibold">
              {result.active.length === 1
                ? 'Active surgery found'
                : `${result.active.length} active surgeries found`}
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
                      Patient ID: {operation.patientId ?? 'Not provided'}
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
                    Resume Surgery
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
        <h2 className="mb-4 text-2xl font-bold">Past Surgeries</h2>
        <PastSurgeries
          key={JSON.stringify(query)}
          initialResult={result}
          doctors={filterDoctors}
          filters={query}
        />
      </section>
    </main>
  );
}
