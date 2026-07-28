import Link from 'next/link';
import { readSettings } from '@/actions/settings';
import { requirePageAdmin } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../_components/app-header';
import { SettingsForm } from './settings-form';

export const dynamic = 'force-dynamic';

/**
 * Основные настройки (§3.3). Раздел закрыт для Staff (§3.2) — и страницей,
 * и действием, и доменом.
 *
 * В этом спринте здесь только две настройки, от которых зависит уже написанное
 * поведение: видимость себестоимости для Staff и режим нехватки остатка.
 * Остальные ключи (`sound_on_scan_enabled`, `label_size_preset`,
 * `procedure_category_enabled`) появятся вместе с экранами, которые их читают.
 */
export default async function SettingsPage() {
  const { account, actor } = await requirePageAdmin();
  const settings = readSettings(getDb(), actor);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col p-4 sm:p-6">
      <AppHeader
        title="Settings"
        backHref="/"
        backLabel="Home"
        account={{ username: account.username, role: account.role }}
      />
      <section className="mb-6 rounded-2xl bg-white p-5 ring-1 ring-slate-200 sm:p-6">
        <h2 className="text-xl font-semibold">Account Settings</h2>
        <p className="mt-1 max-w-xl text-base text-slate-600">
          Change the password of either shared account. Other signed-in devices for that account
          are logged out.
        </p>
        <Link
          href="/settings/password"
          className="mt-3 inline-flex rounded-xl border-2 border-slate-900 px-6 py-3 text-lg font-semibold"
        >
          Change Password
        </Link>
      </section>
      <SettingsForm settings={settings} />
    </main>
  );
}
