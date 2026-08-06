import Link from 'next/link';
import type { ItemView } from '@/actions/items';
import { ItemPhoto } from '../../_components/item-photo';

/**
 * Карточка предмета в списке (§5.2).
 *
 * Состав по ТЗ: фотография, название, текущее количество, себестоимость за
 * единицу, кнопки Edit и View Barcode. Пример разметки из §5.2:
 *   [Фото] Gauze 4×4 / In stock: 147 · Cost: $3.25 / [Edit] [View Barcode]
 *
 * Себестоимость печатается ТОЛЬКО если сервер её прислал: при выключенной
 * настройке `staff_can_see_cost` поля `unitCostFormatted` в объекте нет вовсе
 * (§3.2, §15) — скрывать нечего.
 *
 * На узком экране блок кнопок переносится под текст, но кнопки остаются
 * крупными (§5.2, §14.1): минимальная высота задана глобально в globals.css.
 */
export function ItemCard({
  item,
  canEdit,
  returnTo,
}: {
  item: ItemView;
  canEdit: boolean;
  returnTo: string;
}) {
  const lowStock = item.isLowStock;
  const href = (suffix = '') =>
    `/inventory/items/${item.id}${suffix}?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <li
      className={`flex flex-wrap items-center gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ${
        lowStock ? 'ring-2 ring-amber-400' : 'ring-slate-200'
      }`}
    >
      <ItemPhoto photoUrl={item.photoUrl} name={item.name} size={64} />

      <div className="min-w-40 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={href()}
            className="text-xl font-semibold underline-offset-4 hover:underline"
          >
            {item.name}
          </Link>
          {lowStock ? (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900">
              Low stock
            </span>
          ) : null}
          {item.archivedAtMs ? (
            <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-800">
              Archived
            </span>
          ) : item.status === 'inactive' ? (
            <span className="rounded-full bg-slate-200 px-3 py-1 text-sm font-semibold text-slate-700">
              Inactive
            </span>
          ) : null}
        </div>

        <p className="mt-1 text-lg text-slate-700">
          In stock: <strong>{item.currentQuantity}</strong> {item.unitOfMeasurement}
          {item.unitCostFormatted ? <> · Cost: {item.unitCostFormatted}</> : null}
        </p>

        <p className="mt-1 font-mono text-sm text-slate-500">
          Item Code: {item.internalCode}
          {item.referenceNumber ? ` · Ref ${item.referenceNumber}` : ''}
        </p>
      </div>

      <div className="flex w-full flex-wrap gap-2 sm:w-auto">
        <Link
          href={href()}
          className="flex-1 rounded-xl border border-slate-300 px-5 py-3 text-center text-lg font-medium sm:flex-none"
        >
          View
        </Link>
        {canEdit && !item.archivedAtMs ? (
          <>
            <Link
              href={href('/edit')}
              className="flex-1 rounded-xl border border-slate-300 px-5 py-3 text-center text-lg font-medium sm:flex-none"
            >
              Edit
            </Link>
            <Link
              href={href('/stock')}
              className="flex-1 rounded-xl border border-slate-300 px-5 py-3 text-center text-lg font-medium sm:flex-none"
            >
              Stock
            </Link>
          </>
        ) : null}
        <Link
          href={href('/barcode')}
          className="flex-1 rounded-xl border border-slate-300 px-5 py-3 text-center text-lg font-medium sm:flex-none"
        >
          View Barcode
        </Link>
      </div>
    </li>
  );
}
