import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getItemForActor } from '@/actions/items';
import { requirePage } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../../../_components/app-header';
import { ItemPhoto } from '../../../_components/item-photo';

export const dynamic = 'force-dynamic';

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { account, actor } = await requirePage();
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const item = getItemForActor(getDb(), actor, id);
  if (!item) notFound();
  const isAdmin = account.role === 'Admin';

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col p-4 sm:p-6">
      <AppHeader
        title={item.name}
        subtitle="Item Details"
        backHref="/inventory/catalog"
        backLabel="Items & Packs"
        account={{ username: account.username, role: account.role }}
      />

      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <div className="flex flex-wrap gap-5">
          <ItemPhoto photoUrl={item.photoUrl} name={item.name} size={128} />
          <div className="min-w-52 flex-1">
            <p className="font-mono text-lg text-slate-600">{item.internalCode}</p>
            <p className="mt-2 text-3xl font-bold">
              {item.currentQuantity}{' '}
              <span className="text-lg font-normal text-slate-600">{item.unitOfMeasurement}</span>
            </p>
            <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Detail label="SKU" value={item.sku} />
              <Detail label="Reference Number" value={item.referenceNumber} />
              <Detail label="Category" value={item.category} />
              <Detail label="Storage Location" value={item.storageLocation} />
              <Detail
                label="Low-stock Threshold"
                value={item.lowStockThreshold?.toString() ?? null}
              />
              <Detail label="Status" value={item.status} />
              {'unitCostFormatted' in item ? (
                <Detail label="Unit Cost" value={item.unitCostFormatted ?? null} />
              ) : null}
            </dl>
            {item.notes ? <p className="mt-4 text-slate-700">{item.notes}</p> : null}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={`/inventory/items/${item.id}/barcode`}
            className="rounded-xl border border-slate-300 px-5 py-3 text-lg font-semibold"
          >
            View Barcode
          </Link>
          {isAdmin ? (
            <>
              <Link
                href={`/inventory/items/${item.id}/edit`}
                className="rounded-xl border border-slate-300 px-5 py-3 text-lg font-semibold"
              >
                Edit
              </Link>
              <Link
                href={`/inventory/items/${item.id}/stock`}
                className="rounded-xl border border-slate-300 px-5 py-3 text-lg font-semibold"
              >
                Stock Adjustment
              </Link>
              <Link
                href={`/inventory/items/${item.id}/history`}
                className="rounded-xl bg-slate-900 px-5 py-3 text-lg font-semibold text-white"
              >
                Item History
              </Link>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="text-lg font-medium">{value || '—'}</dd>
    </div>
  );
}
