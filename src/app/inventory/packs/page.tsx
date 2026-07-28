import Link from 'next/link';
import { listPacksForActor } from '@/actions/packs';
import { withBasePath } from '@/base-path';
import { requirePage } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../../_components/app-header';
import { InventoryTabs } from '../_components/inventory-tabs';
import { PackCard } from '../_components/pack-card';

export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
  includeInactive?: string;
  created?: string;
  updated?: string;
}

/**
 * Вкладка Packs раздела Inventory (§5.1, §6).
 *
 * Чтение доступно обеим ролям: Staff сканирует паки (§3.2) и должен видеть их
 * состав. Кнопки Add New Pack и Edit показываются только Admin — но это лишь
 * эргономика: сами действия отклоняются на сервере (§18.22), см.
 * `src/actions/packs.ts`.
 *
 * Неактивные паки — административный срез, поэтому переключатель показывается
 * только Admin (сервер всё равно игнорирует его для Staff).
 */
export default async function InventoryPacksPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { account, actor } = await requirePage();
  const params = await searchParams;
  const isAdmin = account.role === 'Admin';
  const includeInactive = params.includeInactive === '1';
  const q = params.q ?? '';

  const result = listPacksForActor(getDb(), actor, { includeInactive, q });

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col p-4 sm:p-6">
      <AppHeader
        title="Items & Packs"
        backHref="/inventory"
        backLabel="Inventory"
        account={{ username: account.username, role: account.role }}
      />
      <InventoryTabs active="packs" />

      <form
        method="get"
        action={withBasePath('/inventory/packs')}
        className="mb-4 flex flex-col gap-3 sm:flex-row"
      >
        <label htmlFor="pack-q" className="sr-only">
          Search packs
        </label>
        <input
          id="pack-q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search packs by name or code…"
          className="flex-1 rounded-lg border border-slate-300 px-4 py-3 text-lg"
        />
        <button
          type="submit"
          className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-lg font-semibold"
        >
          Search
        </button>
      </form>

      {params.created ? (
        <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-lg text-emerald-900">
          Pack {params.created} was created.
        </p>
      ) : null}
      {params.updated ? (
        <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-lg text-emerald-900">
          Pack {params.updated} was updated.
        </p>
      ) : null}

      <div className="mb-5 flex flex-wrap items-center gap-3">
        {isAdmin ? (
          <>
            <Link
              href="/inventory/packs/new"
              className="rounded-xl bg-slate-900 px-6 py-3 text-lg font-semibold text-white"
            >
              Add New Pack
            </Link>
            <Link
              href={includeInactive ? '/inventory/packs' : '/inventory/packs?includeInactive=1'}
              className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-lg font-medium text-slate-800"
            >
              {includeInactive ? 'Hide inactive' : 'Show inactive'}
            </Link>
          </>
        ) : null}
      </div>

      <p className="mb-4 text-base text-slate-600">
        A pack is a scanning shortcut, not a physical stock object: one scan adds every item inside
        it and reduces the stock of those items.
      </p>

      {result.packs.length === 0 ? (
        <p className="rounded-2xl bg-white p-6 text-lg text-slate-600 ring-1 ring-slate-200">
          No packs yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {result.packs.map((pack) => (
            <PackCard key={pack.id} pack={pack} canEdit={isAdmin} />
          ))}
        </ul>
      )}
    </main>
  );
}
