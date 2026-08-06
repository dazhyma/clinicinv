import Link from 'next/link';
import { buttonClassName } from '../../_components/ui';

/** §5.1: раздел Inventory содержит как минимум вкладки Items и Packs. */
export function InventoryTabs({ active }: { active: 'items' | 'packs' }) {
  const tabs = [
    { id: 'items', label: 'Items', href: '/inventory/catalog' },
    { id: 'packs', label: 'Packs', href: '/inventory/packs' },
  ] as const;

  return (
    <nav aria-label="Inventory sections" className="mb-6 flex gap-2 rounded-xl bg-[var(--color-surface-muted)] p-1.5">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={active === tab.id ? 'page' : undefined}
          className={buttonClassName({
            variant: active === tab.id ? 'primary' : 'soft',
            className: `flex-1 text-base sm:flex-none ${active === tab.id ? '' : 'bg-transparent'}`,
          })}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
