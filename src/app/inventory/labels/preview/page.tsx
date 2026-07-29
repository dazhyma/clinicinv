import { requirePage } from '@/auth/guards';
import { BulkLabelPreview } from '../../_components/bulk-label-preview';

export const dynamic = 'force-dynamic';

export default async function LabelSheetPreviewPage() {
  await requirePage();
  return (
    <main className="bulk-preview-main min-h-screen overflow-x-auto p-4 sm:p-6">
      <div className="mx-auto max-w-5xl">
        <BulkLabelPreview />
      </div>
    </main>
  );
}
