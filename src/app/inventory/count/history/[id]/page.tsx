import { notFound } from 'next/navigation';
import { getInventoryHistoryForActor } from '@/actions/inventory-history';
import { requirePage } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../../../../_components/app-header';
import { ItemPhoto } from '../../../../_components/item-photo';
import { formatDateTime } from '../../../../operations/_components/format';

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
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col p-4 sm:p-6">
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
              <ItemPhoto photoUrl={line.photoUrl} name={line.name} size={64} />
              <div className="min-w-48 flex-1">
                <p className="text-xl font-semibold">{line.name}</p>
                <p className="font-mono text-sm text-slate-500">{line.internalCode}</p>
                {line.sku || line.referenceNumber ? (
                  <p className="text-sm text-slate-600">
                    {line.sku ? `SKU ${line.sku}` : `Ref ${line.referenceNumber}`}
                  </p>
                ) : null}
              </div>
              <div className="grid w-full grid-cols-2 gap-3 text-center sm:w-auto sm:grid-cols-4">
                <CountValue label="Expected" value={line.expectedQuantity} />
                <CountValue label="Actual" value={line.countedQuantity} />
                <CountValue
                  label="Difference"
                  value={line.difference}
                  signed
                  emphasis={line.difference !== 0}
                />
                <CountValue label="Final" value={line.finalQuantity} />
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-500">
              Last entered {formatDateTime(line.updatedAtMs)} · {line.updatedBy ?? 'Unknown'}
            </p>
          </li>
        ))}
      </ul>
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
  value: number;
  signed?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className={`rounded-xl px-3 py-2 ${emphasis ? 'bg-amber-50' : 'bg-slate-50'}`}>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-2xl font-bold">{signed && value > 0 ? `+${value}` : value}</p>
    </div>
  );
}
