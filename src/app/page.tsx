import Link from 'next/link';
import { requirePage } from '@/auth/guards';
import { AppHeader } from './_components/app-header';
import { BoxesIcon, ChevronRightIcon, ClipboardIcon, SettingsIcon } from './_components/icons';
import { buttonClassName } from './_components/ui';

export const dynamic = 'force-dynamic';

/**
 * §4: главная страница — две крупные очевидные кнопки с подписями из ТЗ.
 *
 * Кнопка Settings показывается только Admin (FR-16) и намеренно оформлена как
 * второстепенная ссылка: §4 требует, чтобы она не отвлекала от двух основных
 * рабочих разделов. Скрытие кнопки защитой не является — `/settings` и все
 * административные действия проверяют роль на сервере (§15, §18.22).
 */
export default async function HomePage() {
  const { account } = await requirePage();
  const isAdmin = account.role === 'Admin';

  return (
    <main className="app-shell flex max-w-5xl flex-col">
      <AppHeader
        title="Clinic Inventory"
        account={{ username: account.username, role: account.role }}
      />

      <div className="grid flex-1 content-start gap-5 sm:grid-cols-2">
        <Link
          href="/inventory"
          className="app-card app-card-interactive group flex min-h-52 flex-col justify-between bg-[var(--color-surface-sage)] p-6 sm:p-7"
        >
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-white/70 text-[var(--color-primary-active)]"><BoxesIcon size={27} /></span>
          <span className="mt-7 text-3xl font-bold">Inventory</span>
          <span className="mt-2 text-base text-slate-600">Manage items, stock, packs, and barcodes</span>
          <span className="mt-5 inline-flex items-center gap-1.5 font-semibold text-[var(--color-primary-active)]">Open Inventory <ChevronRightIcon className="transition-transform group-hover:translate-x-1" size={19} /></span>
        </Link>

        <Link
          href="/operations"
          className="app-card app-card-interactive group flex min-h-52 flex-col justify-between bg-[var(--color-surface-blue)] p-6 sm:p-7"
        >
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-white/70 text-blue-800"><ClipboardIcon size={27} /></span>
          <span className="mt-7 text-3xl font-bold">Surgeries</span>
          <span className="mt-2 text-base text-slate-600">Start scanning or review surgeries</span>
          <span className="mt-5 inline-flex items-center gap-1.5 font-semibold text-blue-800">Open Surgeries <ChevronRightIcon className="transition-transform group-hover:translate-x-1" size={19} /></span>
        </Link>
      </div>

      {isAdmin ? (
        <div className="mt-6">
          <Link
            href="/settings"
            className={buttonClassName({ variant: 'secondary' })}
          >
            <SettingsIcon size={19} /> Settings
          </Link>
        </div>
      ) : null}
    </main>
  );
}
