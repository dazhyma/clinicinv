import Link from 'next/link';
import { listInventoryHistoryForActor } from '@/actions/inventory-history';
import { requirePage } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../../../_components/app-header';
import { AutoDismissAlert } from '../../../_components/auto-dismiss-alert';
import { EmptyState, StatusBadge } from '../../../_components/ui';
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
    <main className="app-shell flex max-w-6xl flex-col">
      <AppHeader
        title="Inventory History"
        backHref="/inventory/count"
        backLabel="Inventory Count"
        account={{ username: account.username, role: account.role }}
      />
      {deleted ? (
        <AutoDismissAlert>
          Inventory Count {deleted} was deleted and its adjustments were reversed.
        </AutoDismissAlert>
      ) : null}

      {counts.length === 0 ? (
        <section className="app-card"><EmptyState title="No completed inventory counts yet" description="Completed counts will appear here." /></section>
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
                <StatusBadge tone="success">Completed</StatusBadge>
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
