import Link from 'next/link';
import { requirePage } from '@/auth/guards';
import { AppHeader } from './_components/app-header';

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
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col p-4 sm:p-6">
      <AppHeader
        title="Clinic Inventory"
        account={{ username: account.username, role: account.role }}
      />

      <div className="grid flex-1 content-start gap-4 sm:grid-cols-2">
        <Link
          href="/inventory"
          className="flex min-h-44 flex-col justify-center rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 transition active:ring-2 active:ring-slate-400"
        >
          <span className="text-3xl font-semibold">Inventory</span>
          <span className="mt-2 text-lg text-slate-600">
            Manage items, stock, packs, and barcodes
          </span>
        </Link>

        <Link
          href="/operations"
          className="flex min-h-44 flex-col justify-center rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 transition active:ring-2 active:ring-slate-400"
        >
          <span className="text-3xl font-semibold">Operations</span>
          <span className="mt-2 text-lg text-slate-600">
            Start scanning or review operations
          </span>
        </Link>
      </div>

      {isAdmin ? (
        <div className="mt-6">
          <Link
            href="/settings"
            className="inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-slate-600"
          >
            Settings
          </Link>
        </div>
      ) : null}
    </main>
  );
}
