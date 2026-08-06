import Link from 'next/link';
import { findDraftCountForActor } from '@/actions/inventory-count';
import { requirePage } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../_components/app-header';
import { BoxesIcon, ChevronRightIcon, ClipboardIcon, HistoryIcon } from '../_components/icons';

export const dynamic = 'force-dynamic';

const cards = [
  {
    href: '/inventory/receive',
    title: 'Receive Stock',
    description: 'Scan or find an item and record newly received stock.',
    icon: BoxesIcon,
    tone: 'bg-[var(--color-surface-sage)]',
  },
  {
    href: '/inventory/count',
    title: 'Inventory Count',
    description: 'Start, resume, finish, and review physical inventory counts.',
    icon: ClipboardIcon,
    tone: 'bg-[var(--color-surface-blue)]',
  },
  {
    href: '/inventory/catalog',
    title: 'Items & Packs',
    description: 'Browse inventory items, packs, barcodes, and item details.',
    icon: HistoryIcon,
    tone: 'bg-[var(--color-surface-beige)]',
  },
] as const;

export default async function InventoryHomePage() {
  const { account, actor } = await requirePage();
  const draft = findDraftCountForActor(getDb(), actor);

  return (
    <main className="app-shell flex max-w-6xl flex-col">
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
          className="app-card app-card-interactive mb-6 flex items-center justify-between gap-4 border-emerald-300 bg-emerald-50 p-5 text-emerald-950"
        >
          <span><span className="text-xl font-bold">Resume {draft.internalCode}</span><span className="mt-1 block text-base">{draft.countedItems} items counted · {draft.differenceCount} differences</span></span>
          <ChevronRightIcon className="shrink-0" />
        </Link>
      ) : null}

      <div className="grid gap-5 md:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className={`app-card app-card-interactive group flex min-h-56 flex-col justify-between p-6 ${card.tone}`}
          >
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white/65 text-[var(--color-primary-active)]"><card.icon size={24} /></span>
            <span className="mt-6 text-2xl font-bold">{card.title}</span>
            <span className="mt-2 flex-1 text-base text-slate-600">{card.description}</span>
            <span className="mt-5 inline-flex items-center gap-1 font-semibold">Open <ChevronRightIcon className="transition-transform group-hover:translate-x-1" size={18} /></span>
          </Link>
        ))}
      </div>
    </main>
  );
}
