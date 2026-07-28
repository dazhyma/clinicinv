import Link from 'next/link';
import { findDraftCountForActor } from '@/actions/inventory-count';
import { requirePage } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../_components/app-header';

export const dynamic = 'force-dynamic';

const cards = [
  {
    href: '/inventory/receive',
    title: 'Receive Stock',
    description: 'Scan or find an item and record newly received stock.',
  },
  {
    href: '/inventory/count',
    title: 'Inventory Count',
    description: 'Start, resume, finish, and review physical inventory counts.',
  },
  {
    href: '/inventory/catalog',
    title: 'Items & Packs',
    description: 'Browse inventory items, packs, barcodes, and item details.',
  },
] as const;

export default async function InventoryHomePage() {
  const { account, actor } = await requirePage();
  const draft = findDraftCountForActor(getDb(), actor);

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col p-4 sm:p-6">
      <AppHeader
        title="Inventory"
        subtitle="Choose what you want to do."
        backHref="/"
        backLabel="Home"
        account={{ username: account.username, role: account.role }}
      />

      {draft ? (
        <Link
          href="/inventory/count/active"
          className="mb-5 rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-5 text-emerald-950"
        >
          <span className="text-xl font-bold">Resume {draft.internalCode}</span>
          <span className="mt-1 block text-base">
            {draft.countedItems} items counted · {draft.differenceCount} differences
          </span>
        </Link>
      ) : null}

      <div className="grid gap-5 md:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="flex min-h-52 flex-col justify-between rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:ring-slate-400"
          >
            <span className="text-2xl font-bold">{card.title}</span>
            <span className="text-lg text-slate-600">{card.description}</span>
            <span className="text-lg font-semibold">Open →</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
