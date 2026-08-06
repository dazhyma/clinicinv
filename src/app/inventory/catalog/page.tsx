import Link from 'next/link';
import { listItemsForActor } from '@/actions/items';
import { requirePage } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../../_components/app-header';
import { AutoDismissAlert } from '../../_components/auto-dismiss-alert';
import { Alert, EmptyState } from '../../_components/ui';
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
    <main className="app-shell flex max-w-6xl flex-col">
      <AppHeader
        title="Items & Packs"
        backHref="/inventory"
        backLabel="Inventory"
        account={{ username: account.username, role: account.role }}
      />
      <InventoryTabs active="items" />

      {params.created ? (
        <AutoDismissAlert>Item {params.created} was created.</AutoDismissAlert>
      ) : null}
      {params.updated ? (
        <AutoDismissAlert>Item {params.updated} was updated.</AutoDismissAlert>
      ) : null}
      {params.deleted ? (
        <AutoDismissAlert>Item {params.deleted} was permanently deleted.</AutoDismissAlert>
      ) : null}
      {params.archived ? (
        <AutoDismissAlert>Item {params.archived} was archived.</AutoDismissAlert>
      ) : null}
      {params.error ? (
        <Alert tone="danger" className="mb-5">{params.error}</Alert>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-3">
        {isAdmin ? (
          <Link
            href="/inventory/items/new"
            className="rounded-xl bg-slate-900 px-6 py-3 text-lg font-semibold text-white"
          >
            Add New Item
          </Link>
        ) : null}
        <Link
          href="/inventory/labels"
          className="rounded-xl border-2 border-slate-900 bg-white px-6 py-3 text-lg font-semibold"
        >
          Print Labels
        </Link>
      </div>

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
        <section className="app-card">
          <EmptyState
            title={query.q || query.category || query.location || query.lowStock ? 'No items found' : 'No items yet'}
            description={query.q || query.category || query.location || query.lowStock ? 'Try changing the search or filters.' : 'New inventory items will appear here.'}
          />
        </section>
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
