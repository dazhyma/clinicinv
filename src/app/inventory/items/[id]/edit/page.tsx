import { notFound } from 'next/navigation';
import { getItemForActor, itemFormOptions } from '@/actions/items';
import { requirePageAdmin } from '@/auth/guards';
import { getDb } from '@/db/client';
import { CENTS_IN_DOLLAR } from '@/domain/money';
import { AppHeader } from '../../../../_components/app-header';
import { updateItemFormAction } from '../../../actions';
import { ItemForm } from '../../../_components/item-form';
import { itemsReturnPath } from '../../../_components/items-return-path';

export const dynamic = 'force-dynamic';

/**
 * Edit Item (§5.7).
 *
 * Изменение стоимости здесь влияет только на будущие добавления: завершённые
 * операции не пересчитываются, уже добавленные строки активных операций — тоже
 * (§11.3, §11.4, §18.15, §18.16). Внутренний код и штрихкод формой не меняются
 * (§18.7).
 */
export default async function EditItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { account, actor } = await requirePageAdmin();
  const { id } = await params;
  const itemId = Number(id);
  if (!Number.isSafeInteger(itemId) || itemId <= 0) notFound();

  const db = getDb();
  const item = getItemForActor(db, actor, itemId);
  if (!item || item.archivedAtMs) notFound();

  // Admin всегда видит стоимость, поэтому поле здесь заведомо присутствует.
  const unitCostValue =
    item.unitCostCents === undefined
      ? undefined
      : (item.unitCostCents / CENTS_IN_DOLLAR).toFixed(2);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col p-4 sm:p-6">
      <AppHeader
        title={item.name}
        subtitle="Editing an item never changes finished operations."
        backHref={itemsReturnPath((await searchParams).returnTo)}
        backLabel="Back to Items"
        account={{ username: account.username, role: account.role }}
      />
      <ItemForm
        mode="edit"
        action={updateItemFormAction}
        options={itemFormOptions(db)}
        item={item}
        unitCostValue={unitCostValue}
      />
    </main>
  );
}
