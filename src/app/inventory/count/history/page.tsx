import Link from 'next/link';
import { listInventoryHistoryForActor } from '@/actions/inventory-history';
import { requirePage } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../../../_components/app-header';
import { formatDateTime } from '../../../operations/_components/format';

export const dynamic = 'force-dynamic';

export default async function InventoryHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  const { account, actor } = await requirePage();
  const { deleted } = await searchParams;
  const counts = listInventoryHistoryForActor(getDb(), actor);

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col p-4 sm:p-6">
      <AppHeader
        title="Inventory History"
        backHref="/inventory/count"
        backLabel="Inventory Count"
        account={{ username: account.username, role: account.role }}
      />
      {deleted ? (
        <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-lg text-emerald-900">
          Inventory Count {deleted} was deleted and its adjustments were reversed.
        </p>
      ) : null}

      {counts.length === 0 ? (
        <p className="rounded-2xl bg-white p-6 text-lg text-slate-600 ring-1 ring-slate-200">
          No completed inventory counts yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {counts.map((count) => (
            <li key={count.id} className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
              <div className="flex flex-wrap items-center gap-4">
                <div className="min-w-52 flex-1">
                  <p className="font-mono text-2xl font-bold">{count.internalCode}</p>
                  <p className="mt-1 text-base text-slate-600">
                    Started {formatDateTime(count.createdAtMs)} · {count.startedBy ?? 'Unknown'}
                  </p>
                  <p className="text-base text-slate-600">
                    Finished {formatDateTime(count.completedAtMs)} · {count.completedBy ?? 'Unknown'}
                  </p>
                  <p className="mt-2 text-lg">
                    {count.countedItems} items checked · {count.differenceCount} differences
                  </p>
                </div>
                <span className="rounded-full bg-emerald-100 px-4 py-2 font-semibold text-emerald-900">
                  Completed
                </span>
                <Link
                  href={`/inventory/count/history/${count.id}`}
                  className="rounded-xl border border-slate-300 px-5 py-3 text-lg font-semibold"
                >
                  View Results
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
