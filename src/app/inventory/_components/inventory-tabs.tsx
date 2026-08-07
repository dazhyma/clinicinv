import Link from 'next/link';
import { buttonClassName } from '../../_components/ui';

/** §5.1: раздел Inventory содержит как минимум вкладки Items и Packs. */
export function InventoryTabs({ active }: { active: 'items' | 'packs' }) {
  const tabs = [
    { id: 'items', label: 'Items', href: '/inventory/catalog' },
    { id: 'packs', label: 'Packs', href: '/inventory/packs' },
  ] as const;

  return (
    <nav aria-label="Inventory sections" className="mb-6 flex w-fit max-w-full gap-2">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={active === tab.id ? 'page' : undefined}
          className={buttonClassName({
            variant: active === tab.id ? 'primary' : 'secondary',
            className: 'text-base',
          })}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
