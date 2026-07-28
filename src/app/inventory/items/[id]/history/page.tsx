import { notFound } from 'next/navigation';
import {
  getItemHistoryForActor,
  ITEM_HISTORY_FILTERS,
} from '@/actions/item-history';
import { withBasePath } from '@/base-path';
import { requirePageAdmin } from '@/auth/guards';
import { getDb } from '@/db/client';
import { formatCents } from '@/domain/money';
import { AppHeader } from '../../../../_components/app-header';
import { formatDateTime } from '../../../../operations/_components/format';

export const dynamic = 'force-dynamic';

export default async function ItemHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ category?: string }>;
}) {
  const { account, actor } = await requirePageAdmin();
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const { category = 'all' } = await searchParams;
  const result = getItemHistoryForActor(getDb(), actor, id, category);
  if (!result) notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col p-4 sm:p-6">
      <AppHeader
        title="Item History"
        subtitle={`${result.item.name} · ${result.item.internalCode}`}
        backHref={`/inventory/items/${result.item.id}`}
        backLabel="Item Details"
        account={{ username: account.username, role: account.role }}
      />

      <form
        method="get"
        action={withBasePath(`/inventory/items/${result.item.id}/history`)}
        className="mb-5 flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200"
      >
        <div className="min-w-64 flex-1">
          <label htmlFor="category" className="text-base font-medium">
            History category
          </label>
          <select
            id="category"
            name="category"
            defaultValue={result.filter}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-lg"
          >
            {ITEM_HISTORY_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-xl bg-slate-900 px-6 py-3 text-lg font-semibold text-white"
        >
          Apply
        </button>
      </form>

      {result.entries.length === 0 ? (
        <p className="rounded-2xl bg-white p-6 text-lg text-slate-600 ring-1 ring-slate-200">
          No history entries in this category.
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {result.entries.map((entry) => (
            <li key={entry.id} className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-xl font-semibold">{entry.action}</h2>
                  <p className="text-base text-slate-500">
                    {formatDateTime(entry.createdAtMs)} · {entry.accountRole ?? 'System'}
                  </p>
                </div>
              </div>

              {entry.quantityAfter != null ? (
                <p className="mt-3 text-lg">
                  Quantity: <strong>{entry.quantityBefore}</strong> →{' '}
                  <strong>{entry.quantityAfter}</strong>
                  <span
                    className={`ml-3 font-bold ${
                      (entry.quantityDelta ?? 0) < 0 ? 'text-red-700' : 'text-emerald-700'
                    }`}
                  >
                    {(entry.quantityDelta ?? 0) > 0 ? '+' : ''}
                    {entry.quantityDelta}
                  </span>
                </p>
              ) : null}

              {entry.oldValue !== null || entry.newValue !== null ? (
                <p className="mt-3 text-lg">
                  {formatHistoryValue(entry.fieldName, entry.oldValue)} →{' '}
                  <strong>{formatHistoryValue(entry.fieldName, entry.newValue)}</strong>
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-base text-slate-600">
                {entry.operationCode ? <span>Operation: {entry.operationCode}</span> : null}
                {entry.inventoryCountCode ? (
                  <span>Inventory Count: {entry.inventoryCountCode}</span>
                ) : null}
                {entry.reason ? <span>Reason: {entry.reason}</span> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

function formatHistoryValue(field: string | null, value: string | null): string {
  if (value == null || value === '') return '—';
  if (field === 'currentUnitCostCents') return formatCents(Number(value));
  if (field === 'photoUrl') return value ? 'Photo present' : 'No photo';
  return value;
}
