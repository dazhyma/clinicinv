import { listDoctorsAction } from '@/actions/doctors';
import { requirePageAdmin } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../../_components/app-header';
import { DoctorsManager } from './doctors-manager';

export const dynamic = 'force-dynamic';

/**
 * Справочник врачей (§3.3, новое дополнение к ТЗ).
 *
 * Раздел закрыт для Staff и страницей, и действием, и доменом (§3.2, D-10).
 * Архивные врачи показываются здесь же: администратор должен видеть, что код
 * занят, даже если врач больше не выбирается.
 */
export default async function DoctorsSettingsPage() {
  const { account, actor } = await requirePageAdmin();
  const doctors = listDoctorsAction(getDb(), actor, { includeArchived: true });

  return (
    <main className="app-shell flex max-w-5xl flex-col">
      <AppHeader
        title="Doctors"
        backHref="/settings"
        backLabel="Settings"
        account={{ username: account.username, role: account.role }}
      />
      <DoctorsManager doctors={doctors} />
    </main>
  );
}
