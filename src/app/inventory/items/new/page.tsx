import { itemFormOptions } from '@/actions/items';
import { requirePageAdmin } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../../../_components/app-header';
import { createItemFormAction } from '../../actions';
import { ItemForm } from '../../_components/item-form';

export const dynamic = 'force-dynamic';

/**
 * Add New Item (§5.4).
 *
 * Страница закрыта для Staff (`requirePageAdmin`), но настоящая защита —
 * проверка роли в самом действии и в домене (§18.22, D-10).
 */
export default async function NewItemPage() {
  const { account } = await requirePageAdmin();
  const options = itemFormOptions(getDb());

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col p-4 sm:p-6">
      <AppHeader
        title="Add New Item"
        subtitle="A permanent internal code and barcode are generated automatically on save."
        backHref="/inventory"
        backLabel="Inventory"
        account={account}
      />
      <ItemForm mode="create" action={createItemFormAction} options={options} />
    </main>
  );
}
