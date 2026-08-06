import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPackForActor } from '@/actions/packs';
import { requirePage } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../../../_components/app-header';
import { ItemPhoto } from '../../../_components/item-photo';
import { DeleteDialog } from '../../_components/delete-dialog';
import { deletePackFormAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function PackDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { account, actor } = await requirePage();
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const pack = getPackForActor(getDb(), actor, id);
  if (!pack) notFound();
  const isAdmin = account.role === 'Admin';

  return (
    <main className="app-shell flex max-w-5xl flex-col">
      <AppHeader
        title={pack.name}
        subtitle="Pack Details"
        backHref="/inventory/packs"
        backLabel="Items & Packs"
        account={{ username: account.username, role: account.role }}
      />

      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <div className="flex flex-wrap gap-5">
          <ItemPhoto photoUrl={pack.photoUrl} name={pack.name} size={128} />
          <div className="min-w-52 flex-1">
            <p className="font-mono text-lg text-slate-600">{pack.internalCode}</p>
            <p className="mt-2 text-lg">
              <strong>Pack</strong> · {pack.componentCount} positions · {pack.totalUnits} units per
              scan
              {pack.costFormatted ? ` · Cost ${pack.costFormatted}` : ''}
            </p>
            {pack.notes ? <p className="mt-3 text-slate-700">{pack.notes}</p> : null}
          </div>
        </div>

        <h2 className="mt-6 text-xl font-semibold">Contents</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {pack.components.map((component) => (
            <li key={component.itemId} className="rounded-xl bg-slate-50 p-3">
              <p className="font-semibold">
                {component.name} × {component.quantity}
              </p>
              <p className="text-sm text-slate-600">
                {component.internalCode} · in stock {component.itemQuantityInStock}
              </p>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={`/inventory/packs/${pack.id}/barcode`}
            className="rounded-xl border border-slate-300 px-5 py-3 text-lg font-semibold"
          >
            View Barcode
          </Link>
          {isAdmin && !pack.archivedAtMs ? (
            <Link
              href={`/inventory/packs/${pack.id}/edit`}
              className="rounded-xl bg-slate-900 px-5 py-3 text-lg font-semibold text-white"
            >
              Edit Pack
            </Link>
          ) : null}
        </div>
      </section>

      {isAdmin && !pack.archivedAtMs ? (
        <section className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-5">
          <h2 className="text-xl font-semibold text-red-950">Delete pack</h2>
          <p className="mt-1 mb-4 text-red-900">
            Used packs are archived permanently; unused packs are removed.
          </p>
          <DeleteDialog
            action={deletePackFormAction}
            fieldName="packId"
            entityId={pack.id}
            triggerLabel="Delete Pack"
            title={`Delete ${pack.name}?`}
            description="Items inside this pack will not be deleted. Previous operations will remain unchanged."
            confirmLabel="Delete Pack"
          />
        </section>
      ) : null}
    </main>
  );
}
