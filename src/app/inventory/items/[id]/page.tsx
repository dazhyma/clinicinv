import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getItemForActor } from '@/actions/items';
import { requirePage } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../../../_components/app-header';
import { DeleteDialog } from '../../_components/delete-dialog';
import { deleteItemFormAction } from '../../actions';
import { itemsReturnPath } from '../../_components/items-return-path';

export const dynamic = 'force-dynamic';

export default async function ItemDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { account, actor } = await requirePage();
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const item = getItemForActor(getDb(), actor, id);
  if (!item) notFound();
  const isAdmin = account.role === 'Admin';
  const backHref = itemsReturnPath((await searchParams).returnTo);
  const returnQuery = `?returnTo=${encodeURIComponent(backHref)}`;

  return (
    <main className="app-shell flex max-w-5xl flex-col">
      <AppHeader
        title={item.name}
        subtitle="Item Details"
        backHref={backHref}
        backLabel="Back to Items"
        account={{ username: account.username, role: account.role }}
      />

      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <div className="flex flex-wrap gap-5">
          <div className="min-w-52 flex-1">
            <p className="text-lg text-slate-600">
              Item Code: <span className="font-mono">{item.internalCode}</span>
            </p>
            <p className="mt-2 text-3xl font-bold">
              {item.trackingMethod === 'liquid' ? item.liquidTotalFormatted : item.currentQuantity}{' '}
              <span className="text-lg font-normal text-slate-600">{item.trackingMethod === 'liquid' ? 'ml available' : item.unitOfMeasurement}</span>
            </p>
            <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Detail label="Reference Number" value={item.referenceNumber} />
              <Detail label="Manufacturer" value={item.manufacturer} />
              <Detail label="Tracking Method" value={item.trackingMethod === 'liquid' ? 'Liquid Volume (ml)' : 'Standard Units'} />
              {item.trackingMethod === 'liquid' ? <Detail label="Physical Stock" value={`${item.liquidUnopenedVials} unopened vials · ${(item.liquidOpenVialCentiml / 100).toFixed(2)} ml in open vial`} /> : null}
              <Detail label="Category" value={item.category} />
              <Detail label="Storage Location" value={item.storageLocation} />
              <Detail
                label="Low-stock Threshold"
                value={item.lowStockThreshold?.toString() ?? null}
              />
              <Detail label="Status" value={item.status} />
              {'unitCostFormatted' in item ? (
                <Detail label={item.trackingMethod === 'liquid' ? 'Cost per Vial' : 'Unit Cost'} value={item.unitCostFormatted ?? null} />
              ) : null}
            </dl>
            {item.notes ? <p className="mt-4 text-slate-700">{item.notes}</p> : null}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={`/inventory/items/${item.id}/barcode${returnQuery}`}
            className="rounded-xl border border-slate-300 px-5 py-3 text-lg font-semibold"
          >
            View Barcode
          </Link>
          {isAdmin && !item.archivedAtMs ? (
            <>
              <Link
                href={`/inventory/items/${item.id}/edit${returnQuery}`}
                className="rounded-xl border border-slate-300 px-5 py-3 text-lg font-semibold"
              >
                Edit
              </Link>
              <Link
                href={`/inventory/items/${item.id}/stock${returnQuery}`}
                className="rounded-xl border border-slate-300 px-5 py-3 text-lg font-semibold"
              >
                Stock Adjustment
              </Link>
              <Link
                href={`/inventory/items/${item.id}/history${returnQuery}`}
                className="rounded-xl bg-slate-900 px-5 py-3 text-lg font-semibold text-white"
              >
                Item History
              </Link>
            </>
          ) : null}
        </div>
      </section>

      {isAdmin && !item.archivedAtMs ? (
        <section className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-5">
          <h2 className="text-xl font-semibold text-red-950">Delete item</h2>
          <p className="mt-1 mb-4 text-red-900">
            This action is permanent. Items with stock or historical records are archived instead
            of being physically removed.
          </p>
          <DeleteDialog
            action={deleteItemFormAction}
            fieldName="itemId"
            entityId={item.id}
            triggerLabel="Delete Item"
            title={`Delete ${item.name}?`}
            description="Previous history will remain available when this item must be archived."
            details={
              <p>
                Current stock: <strong>{item.currentQuantity}</strong>{' '}
                {item.unitOfMeasurement}
              </p>
            }
            confirmLabel="Delete Item"
          />
        </section>
      ) : null}
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
