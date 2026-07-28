import Link from 'next/link';
import { listItemsForActor } from '@/actions/items';
import { withBasePath } from '@/base-path';
import { requirePageAdmin } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../../_components/app-header';
import { ItemPhoto } from '../../_components/item-photo';
import { ReceiveStockScanner } from '../_components/receive-stock-scanner';

export const dynamic = 'force-dynamic';

/**
 * Receive Stock, шаг 1 (§5.8): «отсканировать внутренний штрихкод или найти
 * предмет вручную».
 *
 * Камера и HID-сканер используют одну read-only карточку подтверждения.
 * Ручной текстовый поиск остаётся отдельным запасным способом.
 */
export default async function ReceiveStockPickerPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; camera?: string }>;
}) {
  const { account, actor } = await requirePageAdmin();
  const { q = '', camera = '' } = await searchParams;

  const result = q.trim()
    ? listItemsForActor(getDb(), actor, { q, limit: 25 })
    : { items: [] as ReturnType<typeof listItemsForActor>['items'] };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col p-4 sm:p-6">
      <AppHeader
        title="Receive Stock"
        subtitle="Confirm the item, then enter the received quantity and cost."
        backHref="/inventory"
        backLabel="Inventory"
        account={account}
      />

      <div className="mb-5">
        <ReceiveStockScanner autoOpenCamera={camera === '1'} />
      </div>

      {/* Атрибут action обычной GET-формы Next префиксом не дополняет (D-51). */}
      <form
        method="get"
        action={withBasePath('/inventory/receive')}
        className="mb-5 flex flex-col gap-3 sm:flex-row"
      >
        <label htmlFor="q" className="sr-only">
          Search by name, internal code, SKU or reference number
        </label>
        <input
          id="q"
          name="q"
          type="search"
          autoFocus
          defaultValue={q}
          placeholder="Search by name, code, SKU or reference…"
          className="flex-1 rounded-lg border border-slate-300 px-4 py-3 text-lg"
        />
        <button
          type="submit"
          className="rounded-lg bg-slate-900 px-6 py-3 text-lg font-semibold text-white"
        >
          Find
        </button>
      </form>

      {q.trim() && result.items.length === 0 ? (
        <p role="status" className="rounded-2xl bg-white p-6 text-lg text-slate-700 ring-1 ring-slate-200">
          No items match this search.
        </p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {result.items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
          >
            <ItemPhoto photoUrl={item.photoUrl} name={item.name} size={56} />
            <div className="min-w-40 flex-1">
              <p className="text-xl font-semibold">{item.name}</p>
              <p className="text-lg text-slate-700">
                In stock: <strong>{item.currentQuantity}</strong> {item.unitOfMeasurement}
              </p>
              <p className="font-mono text-sm text-slate-500">{item.internalCode}</p>
            </div>
            <Link
              href={`/inventory/items/${item.id}/stock`}
              className="w-full rounded-xl bg-slate-900 px-6 py-3 text-center text-lg font-semibold text-white sm:w-auto"
            >
              Receive
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
