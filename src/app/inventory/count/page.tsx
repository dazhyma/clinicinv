import Link from 'next/link';
import { findDraftCountForActor } from '@/actions/inventory-count';
import { requirePage } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../../_components/app-header';
import { CountScreen } from '../_components/count-screen';
import { startInventoryCountFormAction } from './actions';

export const dynamic = 'force-dynamic';

/**
 * Inventory Count (§5.1, §5.10).
 *
 * Admin и Staff работают с одним общим черновиком. Каждое действие проверяет
 * узкое право Inventory Count на сервере и в домене; остальные ручные
 * корректировки для Staff по-прежнему запрещены.
 *
 * Черновик читается из БД при каждом заходе, поэтому незавершённая
 * инвентаризация переживает обновление страницы, закрытие вкладки и перезапуск
 * сервера (§5.10). Ничего не хранится только на странице.
 */
export default async function InventoryCountPage() {
  const { account, actor } = await requirePage();
  const draft = findDraftCountForActor(getDb(), actor);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col p-4 sm:p-6">
      <AppHeader
        title="Inventory Count"
        backHref="/inventory"
        backLabel="Inventory"
        account={account}
      />

      {draft ? (
        <CountScreen initialState={draft} />
      ) : (
        <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
          <h2 className="text-xl font-semibold">Start a new inventory count</h2>
          <p className="mt-2 text-lg text-slate-700">
            Scan each item, enter the quantity you found on the shelf, and the system shows the
            expected quantity and the difference. Stock changes only after you apply the count.
          </p>
          <p className="mt-2 text-base text-slate-600">
            An unfinished count is kept on the server: you can close this page and continue later.
          </p>

          <form action={startInventoryCountFormAction} className="mt-5">
            <button
              type="submit"
              className="w-full rounded-2xl bg-slate-900 px-6 py-5 text-2xl font-bold text-white sm:w-auto sm:px-10"
            >
              Start New Count
            </button>
          </form>
        </section>
      )}

      <p className="mt-6 text-center">
        <Link href="/inventory" className="text-lg text-slate-600 underline underline-offset-4">
          Back to Inventory
        </Link>
      </p>
    </main>
  );
}
