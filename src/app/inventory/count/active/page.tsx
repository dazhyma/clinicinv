import { redirect } from 'next/navigation';
import { findDraftCountForActor } from '@/actions/inventory-count';
import { requirePage } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../../../_components/app-header';
import { CountScreen } from '../../_components/count-screen';

export const dynamic = 'force-dynamic';

export default async function ActiveInventoryCountPage() {
  const { account, actor } = await requirePage();
  const draft = findDraftCountForActor(getDb(), actor);
  if (!draft) redirect('/inventory/count');

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col p-4 sm:p-6">
      <AppHeader
        title={draft.internalCode}
        subtitle="Active Inventory Count"
        backHref="/inventory/count"
        backLabel="Inventory Count"
        account={{ username: account.username, role: account.role }}
      />
      <CountScreen initialState={draft} />
    </main>
  );
}
