import { notFound } from 'next/navigation';
import { listItemsForActor } from '@/actions/items';
import { getPackForActor } from '@/actions/packs';
import { requirePageAdmin } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../../../../_components/app-header';
import { PackForm } from '../../../_components/pack-form';
import { updatePackFormAction } from '../../actions';

export const dynamic = 'force-dynamic';

/**
 * Редактирование пака и его состава (§6.7).
 *
 * Изменение состава действует только на будущие сканирования: завершённые
 * операции сохраняют исходный состав, количества и историческую стоимость
 * (§6.7, §18.17). Пересчёта истории здесь нет — строки операций не читаются и
 * не пишутся вовсе.
 *
 * Внутренний код и штрихкод формой не меняются (§18.6, §18.7): в разметке они
 * выведены текстом, в `PackFormInput` их нет, а доменный `updatePack()`
 * отвергает попытку их передать.
 */
export default async function EditPackPage({ params }: { params: Promise<{ id: string }> }) {
  const { account, actor } = await requirePageAdmin();
  const { id } = await params;
  const packId = Number(id);
  if (!Number.isSafeInteger(packId) || packId <= 0) notFound();

  const db = getDb();
  const pack = getPackForActor(db, actor, packId);
  if (!pack || pack.archivedAtMs) notFound();

  // Состав может содержать предмет, который позже деактивировали: он должен
  // остаться в списке выбора, иначе форма молча выбросила бы его из пака.
  const { items } = listItemsForActor(db, actor, { includeInactive: true });

  return (
    <main className="app-shell flex max-w-4xl flex-col">
      <AppHeader
        title={pack.name}
        subtitle="Changes apply to future scans only."
        backHref={`/inventory/packs/${pack.id}`}
        backLabel="Pack Details"
        account={{ username: account.username, role: account.role }}
      />
      <PackForm mode="edit" action={updatePackFormAction} items={items} pack={pack} />
    </main>
  );
}
