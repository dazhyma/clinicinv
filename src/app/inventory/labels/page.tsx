import { listActiveItemsForLabels } from '@/actions/item-labels';
import { requirePage } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../../_components/app-header';
import { BulkLabelSelection } from '../_components/bulk-label-selection';

export const dynamic = 'force-dynamic';

export default async function PrintItemLabelsPage() {
  const { account, actor } = await requirePage();
  const items = listActiveItemsForLabels(getDb(), actor);
  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))].sort() as string[];
  const storageLocations = [
    ...new Set(items.map((item) => item.storageLocation).filter(Boolean)),
  ].sort() as string[];

  return (
    <main className="app-shell flex max-w-6xl flex-col">
      <AppHeader
        title="Print Item Labels"
        subtitle="Select active items and create a US Letter label sheet."
        backHref="/inventory/catalog"
        backLabel="Back to Items"
        account={{ username: account.username, role: account.role }}
      />
      <BulkLabelSelection
        items={items}
        categories={categories}
        storageLocations={storageLocations}
      />
    </main>
  );
}
