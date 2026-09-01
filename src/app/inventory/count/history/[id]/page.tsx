import { notFound } from 'next/navigation';
import { getInventoryHistoryForActor } from '@/actions/inventory-history';
import { requirePage } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../../../../_components/app-header';
import { formatDateTime } from '../../../../operations/_components/format';
import { DeleteDialog } from '../../../_components/delete-dialog';
import { deleteInventoryCountFormAction } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function InventoryHistoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { account, actor } = await requirePage();
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const result = getInventoryHistoryForActor(getDb(), actor, id);
  if (!result) notFound();

  return (
    <main className="app-shell flex max-w-7xl flex-col">
      <AppHeader
        title={result.summary.internalCode}
        subtitle="Completed Inventory Count"
        backHref="/inventory/count/history"
        backLabel="Inventory History"
        account={{ username: account.username, role: account.role }}
      />

      <section className="mb-5 grid gap-3 rounded-2xl bg-white p-5 ring-1 ring-slate-200 sm:grid-cols-2">
        <p>
          <span className="block text-sm text-slate-500">Started</span>
          <strong>{formatDateTime(result.summary.createdAtMs)}</strong> ·{' '}
          {result.summary.startedBy ?? 'Unknown'}
        </p>
        <p>
          <span className="block text-sm text-slate-500">Finished</span>
          <strong>{formatDateTime(result.summary.completedAtMs)}</strong> ·{' '}
          {result.summary.completedBy ?? 'Unknown'}
        </p>
        <p>
          <span className="block text-sm text-slate-500">Items checked</span>
          <strong>{result.summary.countedItems}</strong>
        </p>
        <p>
          <span className="block text-sm text-slate-500">Differences</span>
          <strong>{result.summary.differenceCount}</strong>
        </p>
      </section>

      <ul className="flex flex-col gap-3">
        {result.lines.map((line) => (
          <li key={line.id} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center gap-4">
              <div className="min-w-48 flex-1">
                <p className="text-xl font-semibold">{line.name}</p>
                <p className="font-mono text-sm text-slate-500">{line.internalCode}</p>
                {line.referenceNumber ? (
                  <p className="text-sm text-slate-600">
                    Ref {line.referenceNumber}
                  </p>
                ) : null}
              </div>
              <div className="grid w-full grid-cols-2 gap-3 text-center sm:w-auto sm:grid-cols-4">
                <CountValue label="Expected" value={line.trackingMethod === 'liquid'
                  ? `${line.expectedUnopenedVials ?? 0} unopened + ${line.expectedOpenVialMl ?? '0.00'} ml open`
                  : line.expectedQuantity} />
                <CountValue label="Actual" value={line.trackingMethod === 'liquid'
                  ? `${line.countedUnopenedVials ?? 0} unopened + ${line.countedOpenVialMl ?? '0.00'} ml open`
                  : line.countedQuantity} />
                <CountValue
                  label="Difference"
                  value={line.trackingMethod === 'liquid'
                    ? `${line.difference > 0 ? '+' : ''}${(line.difference / 100).toFixed(2)} ml`
                    : line.difference}
                  signed
                  emphasis={line.difference !== 0}
                />
                <CountValue label="Final" value={line.trackingMethod === 'liquid'
                  ? `${line.finalUnopenedVials ?? 0} unopened + ${line.finalOpenVialMl ?? '0.00'} ml open`
                  : line.finalQuantity} />
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-500">
              Last entered {formatDateTime(line.updatedAtMs)} · {line.updatedBy ?? 'Unknown'}
            </p>
          </li>
        ))}
      </ul>

      {account.role === 'Admin' ? (
        <section className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-5">
          <h2 className="text-xl font-semibold text-red-950">Delete inventory count</h2>
          <p className="mt-1 mb-4 text-red-900">
            All adjustments created by this count will be reversed.
          </p>
          <DeleteDialog
            action={deleteInventoryCountFormAction}
            fieldName="countId"
            entityId={result.summary.id}
            triggerLabel="Delete Inventory Count"
            title={`Delete Inventory Count ${result.summary.internalCode}?`}
            description="All inventory adjustments created by this count will be reversed. This action cannot be undone."
            details={
              <dl className="grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-sm text-slate-500">Date</dt>
                  <dd className="font-semibold">
                    {formatDateTime(result.summary.completedAtMs)}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-slate-500">Items checked</dt>
                  <dd className="font-semibold">{result.summary.countedItems}</dd>
                </div>
                <div>
                  <dt className="text-sm text-slate-500">Adjustments reversed</dt>
                  <dd className="font-semibold">{result.summary.adjustmentCount}</dd>
                </div>
              </dl>
            }
            confirmLabel="Delete Inventory Count"
          />
        </section>
      ) : null}
    </main>
  );
}

function CountValue({
  label,
  value,
  signed = false,
  emphasis = false,
}: {
  label: string;
  value: number | string;
  signed?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className={`rounded-xl px-3 py-2 ${emphasis ? 'bg-amber-50' : 'bg-slate-50'}`}>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-2xl font-bold">
        {signed && typeof value === 'number' && value > 0 ? `+${value}` : value}
      </p>
    </div>
  );
}
