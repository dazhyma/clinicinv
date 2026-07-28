import Link from 'next/link';
import { listItemsForActor } from '@/actions/items';
import { requirePage } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../_components/app-header';
import { InventoryTabs } from './_components/inventory-tabs';
import { ItemCard } from './_components/item-card';
import { ItemFilters } from './_components/item-filters';

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
  /** Итог применённой инвентаризации (§5.10). */
  count?: string;
  error?: string;
}

/**
 * Вкладка Items раздела Inventory (§5.1–§5.3, §5.11).
 *
 * Чтение, Receive Stock и Inventory Count доступны обеим ролям. Создание,
 * редактирование и ручная корректировка остаются только у Admin; это
 * дополнительно проверяется серверными actions и доменом.
 */
export default async function InventoryItemsPage({
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

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col p-4 sm:p-6">
      <AppHeader
        title="Inventory"
        backHref="/"
        backLabel="Home"
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
      {params.count ? (
        <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-lg text-emerald-900">
          {params.count}
        </p>
      ) : null}
      {params.error ? (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-800">
          {params.error}
        </p>
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
          href="/inventory/receive"
          className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-lg font-semibold text-slate-800"
        >
          Receive Stock
        </Link>
        <Link
          href="/inventory/count"
          className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-lg font-semibold text-slate-800"
        >
          Inventory Count
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
        <p className="rounded-2xl bg-white p-6 text-lg text-slate-600 ring-1 ring-slate-200">
          {query.q || query.category || query.location || query.lowStock
            ? 'No items match these filters.'
            : 'No items yet.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {result.items.map((item) => (
            <ItemCard key={item.id} item={item} canEdit={isAdmin} />
          ))}
        </ul>
      )}
    </main>
  );
}
