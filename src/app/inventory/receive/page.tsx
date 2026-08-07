import { requirePage } from '@/auth/guards';
import { AppHeader } from '../../_components/app-header';
import { ReceiveStockScanner } from '../_components/receive-stock-scanner';

export const dynamic = 'force-dynamic';

/**
 * Receive Stock, шаг 1 (§5.8): «отсканировать внутренний штрихкод или найти
 * предмет вручную».
 *
 * Камера и HID-сканер используют одну read-only карточку подтверждения.
 * Ручной текстовый поиск, HID и камера используют один селектор и одну карточку.
 */
export default async function ReceiveStockPickerPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; camera?: string }>;
}) {
  const { account } = await requirePage();
  const { camera = '' } = await searchParams;

  return (
    <main className="app-shell flex max-w-4xl flex-col">
      <AppHeader
        title="Receive Stock"
        subtitle="Confirm the item, then enter the received quantity and cost."
        backHref="/inventory"
        backLabel="Inventory"
        account={{ username: account.username, role: account.role }}
      />

      <div className="mb-5">
        <ReceiveStockScanner autoOpenCamera={camera === '1'} />
      </div>

    </main>
  );
}
