import { listItemsForActor } from '@/actions/items';
import { requirePageAdmin } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../../../_components/app-header';
import { PackForm } from '../../_components/pack-form';
import { createPackFormAction } from '../actions';

export const dynamic = 'force-dynamic';

/**
 * Add New Pack (§6.3).
 *
 * Страница административная: `requirePageAdmin()` — первый рубеж, отказ в
 * `createPackAction()` — второй (D-10). Скрытие кнопки в списке защитой не
 * считается (§15, §18.22).
 *
 * Уникальный код `PCK-000015` и штрихкод создаёт домен при сохранении
 * (§6.3, §18.6) — в форме их нет.
 */
export default async function NewPackPage() {
  const { account, actor } = await requirePageAdmin();
  const { items } = listItemsForActor(getDb(), actor, {});

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col p-4 sm:p-6">
      <AppHeader
        title="Add New Pack"
        subtitle="A pack adds all of its items with one scan."
        backHref="/inventory/packs"
        backLabel="Packs"
        account={account}
      />
      <PackForm mode="create" action={createPackFormAction} items={items} />
    </main>
  );
}
