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
    <main className="app-shell flex max-w-4xl flex-col">
      <AppHeader
        title="Add New Item"
        subtitle="The system creates a permanent Item Code and uses it for the barcode."
        backHref="/inventory/catalog"
        backLabel="Items & Packs"
        account={{ username: account.username, role: account.role }}
      />
      <ItemForm mode="create" action={createItemFormAction} options={options} />
    </main>
  );
}
