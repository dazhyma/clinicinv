import Link from 'next/link';

/** §5.1: раздел Inventory содержит как минимум вкладки Items и Packs. */
export function InventoryTabs({ active }: { active: 'items' | 'packs' }) {
  const tabs = [
    { id: 'items', label: 'Items', href: '/inventory/catalog' },
    { id: 'packs', label: 'Packs', href: '/inventory/packs' },
  ] as const;

  return (
    <nav aria-label="Inventory sections" className="mb-4 flex gap-2">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={active === tab.id ? 'page' : undefined}
          className={`min-h-12 rounded-xl px-6 py-3 text-lg font-semibold ${
            active === tab.id
              ? 'bg-slate-900 text-white'
              : 'border border-slate-300 bg-white text-slate-700'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
