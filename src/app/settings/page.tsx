import { readSettings } from '@/actions/settings';
import { requirePageAdmin } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../_components/app-header';
import { LockIcon } from '../_components/icons';
import { ButtonLink, Card } from '../_components/ui';
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
    <main className="app-shell flex max-w-5xl flex-col">
      <AppHeader
        title="Settings"
        backHref="/"
        backLabel="Home"
        account={{ username: account.username, role: account.role }}
      />
      <Card className="mb-6 p-5 sm:p-6">
        <h2 className="text-xl font-semibold">Account Settings</h2>
        <p className="mt-1 max-w-xl text-base text-slate-600">
          Change the password of either shared account. Other signed-in devices for that account
          are logged out.
        </p>
        <ButtonLink href="/settings/password" variant="secondary" className="mt-4"><LockIcon size={19} /> Change Password</ButtonLink>
      </Card>
      <Card className="mb-6 p-5 sm:p-6">
        <h2 className="text-xl font-semibold">Doctors</h2>
        <p className="mt-1 max-w-xl text-base text-slate-600">
          Add or remove doctors and set the two-letter code that prefixes their surgery codes,
          for example CH00001.
        </p>
        <ButtonLink href="/settings/doctors" variant="secondary" className="mt-4">
          Manage Doctors
        </ButtonLink>
      </Card>
      <SettingsForm settings={settings} />
    </main>
  );
}
