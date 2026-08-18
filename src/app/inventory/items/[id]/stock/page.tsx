import { notFound } from 'next/navigation';
import { canSeeCost, getItemForActor } from '@/actions/items';
import { requirePage } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../../../../_components/app-header';
import { adjustStockFormAction, receiveStockFormAction } from '../../../actions';
import { AdjustStockForm, ReceiveStockForm } from '../../../_components/stock-forms';
import { ItemPhoto } from '../../../../_components/item-photo';
import { itemsReturnPath } from '../../../_components/items-return-path';

export const dynamic = 'force-dynamic';

/**
 * Receive Stock (§5.8) и ручная корректировка остатка (§5.9) для одного предмета.
 *
 * Оба действия меняют остаток, поэтому оба идут через журнал движений с ключом
 * идемпотентности от клиента (§10.4): повторная отправка того же события не
 * начислит и не спишет предмет дважды.
 *
 * Ни то, ни другое не меняет завершённые операции (§5.9, §11.3).
 */
export default async function ItemStockPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnToScanner?: string; returnTo?: string }>;
}) {
  const { account, actor } = await requirePage();
  const isAdmin = account.role === 'Admin';
  const { id } = await params;
  const { returnToScanner, returnTo } = await searchParams;
  const itemId = Number(id);
  if (!Number.isSafeInteger(itemId) || itemId <= 0) notFound();

  const db = getDb();
  const item = getItemForActor(db, actor, itemId);
  if (!item || (!isAdmin && item.status !== 'active')) notFound();

  return (
    <main className="app-shell flex max-w-4xl flex-col">
      <AppHeader
        title={item.name}
        subtitle={
          isAdmin
            ? 'Receive stock or correct the quantity on hand.'
            : 'Enter the quantity received and save the delivery.'
        }
        backHref={itemsReturnPath(returnTo)}
        backLabel="Back to Items"
        account={{ username: account.username, role: account.role }}
      />

      <section className="mb-6 flex items-center gap-4 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <ItemPhoto photoUrl={item.photoUrl} name={item.name} size={64} />
        <div>
          <p className="text-lg">
            In stock: <strong>{item.currentQuantity}</strong> {item.unitOfMeasurement}
            {item.unitCostFormatted ? <> · Cost: {item.unitCostFormatted}</> : null}
          </p>
          <p className="font-mono text-sm text-slate-500">{item.internalCode}</p>
        </div>
      </section>

      <div className={`grid gap-6 ${isAdmin ? 'lg:grid-cols-2' : ''}`}>
        <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
          <h2 className="mb-4 text-xl font-semibold">Receive Stock</h2>
          <ReceiveStockForm
            item={item}
            action={receiveStockFormAction}
            showCost={canSeeCost(db, actor)}
            returnToScanner={
              returnToScanner === 'camera' || returnToScanner === 'hid'
                ? returnToScanner
                : undefined
            }
          />
        </section>

        {isAdmin ? (
          <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
            <h2 className="mb-1 text-xl font-semibold">Manual Adjustment</h2>
            <p className="mb-4 text-base text-slate-600">
              Finished surgeries are never changed by an adjustment.
            </p>
            <AdjustStockForm item={item} action={adjustStockFormAction} />
          </section>
        ) : null}
      </div>
    </main>
  );
}
