import Link from 'next/link';
import { listItemsForActor } from '@/actions/items';
import { requirePage } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../../_components/app-header';
import { InventoryTabs } from '../_components/inventory-tabs';
import { ItemCard } from '../_components/item-card';
import { ItemFilters } from '../_components/item-filters';

export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
  category?: string;
  location?: string;
  availability?: string;
  lowStock?: string;
  includeInactive?: string;
  created?: string;
  updated?: string;
  error?: string;
  deleted?: string;
  archived?: string;
}

export default async function InventoryCatalogPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { account, actor } = await requirePage();
  const params = await searchParams;
  const isAdmin = account.role === 'Admin';
  const query = {
    q: params.q ?? '',
    category: params.category ?? '',
    location: params.location ?? '',
    availability: params.availability ?? 'all',
    lowStock: params.lowStock === '1',
    includeInactive: params.includeInactive === '1',
  };
  const result = listItemsForActor(getDb(), actor, query);
  const returnParams = new URLSearchParams();
  if (query.q) returnParams.set('q', query.q);
  if (query.category) returnParams.set('category', query.category);
  if (query.location) returnParams.set('location', query.location);
  if (query.availability !== 'all') returnParams.set('availability', query.availability);
  if (query.lowStock) returnParams.set('lowStock', '1');
  if (query.includeInactive) returnParams.set('includeInactive', '1');
  const returnTo = `/inventory/catalog${returnParams.size ? `?${returnParams}` : ''}`;

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col p-4 sm:p-6">
      <AppHeader
        title="Items & Packs"
        backHref="/inventory"
        backLabel="Inventory"
        account={{ username: account.username, role: account.role }}
      />
      <InventoryTabs active="items" />

      {params.created ? (
        <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-lg text-emerald-900">
          Item {params.created} was created.
        </p>
      ) : null}
      {params.updated ? (
        <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-lg text-emerald-900">
          Item {params.updated} was updated.
        </p>
      ) : null}
      {params.deleted ? (
        <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-lg text-emerald-900">
          Item {params.deleted} was permanently deleted.
        </p>
      ) : null}
      {params.archived ? (
        <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-lg text-emerald-900">
          Item {params.archived} was archived.
        </p>
      ) : null}
      {params.error ? (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-800">
          {params.error}
        </p>
      ) : null}

      {isAdmin ? (
        <div className="mb-4">
          <Link
            href="/inventory/items/new"
            className="rounded-xl bg-slate-900 px-6 py-3 text-lg font-semibold text-white"
          >
            Add New Item
          </Link>
        </div>
      ) : null}

      <div className="mb-5">
        <ItemFilters
          categories={result.categories}
          storageLocations={result.storageLocations}
          values={query}
          isAdmin={isAdmin}
          lowStockCount={result.lowStockCount}
        />
      </div>

      {result.items.length === 0 ? (
        <p className="rounded-2xl bg-white p-6 text-lg text-slate-600 ring-1 ring-slate-200">
          {query.q || query.category || query.location || query.lowStock
            ? 'No items match these filters.'
            : 'No items yet.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {result.items.map((item) => (
            <ItemCard key={item.id} item={item} canEdit={isAdmin} returnTo={returnTo} />
          ))}
        </ul>
      )}
    </main>
  );
}
