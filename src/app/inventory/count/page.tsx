import Link from 'next/link';
import { findDraftCountForActor } from '@/actions/inventory-count';
import { requirePage } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../../_components/app-header';
import { startInventoryCountFormAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function InventoryCountHomePage() {
  const { account, actor } = await requirePage();
  const draft = findDraftCountForActor(getDb(), actor);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col p-4 sm:p-6">
      <AppHeader
        title="Inventory Count"
        backHref="/inventory"
        backLabel="Inventory"
        account={{ username: account.username, role: account.role }}
      />

      <div className="grid gap-4">
        <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
          <h2 className="text-xl font-semibold">Start New Inventory Count</h2>
          <p className="mt-2 text-base text-slate-600">
            Only one shared inventory count can be active at a time.
          </p>
          <form action={startInventoryCountFormAction} className="mt-4">
            <button
              type="submit"
              disabled={Boolean(draft)}
              className="w-full rounded-xl bg-slate-900 px-6 py-4 text-lg font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
            >
              Start New Inventory Count
            </button>
          </form>
          {draft ? (
            <p className="mt-2 text-sm text-amber-800">
              Finish or cancel {draft.internalCode} before starting another count.
            </p>
          ) : null}
        </section>

        {draft ? (
          <Link
            href="/inventory/count/active"
            className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-5"
          >
            <span className="text-xl font-bold">Resume Active Inventory Count</span>
            <span className="mt-1 block font-mono text-lg">{draft.internalCode}</span>
            <span className="mt-1 block text-base text-slate-700">
              {draft.countedItems} items counted · {draft.differenceCount} differences
            </span>
          </Link>
        ) : null}

        <Link
          href="/inventory/count/history"
          className="rounded-2xl bg-white p-5 ring-1 ring-slate-200"
        >
          <span className="text-xl font-bold">Inventory History</span>
          <span className="mt-2 block text-base text-slate-600">
            Review completed inventory counts and their item-level results.
          </span>
        </Link>
      </div>
    </main>
  );
}
