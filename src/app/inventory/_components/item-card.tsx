import Link from 'next/link';
import type { ItemView } from '@/actions/items';
import { ButtonLink, StatusBadge } from '../../_components/ui';

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
      className={`app-card flex flex-wrap items-center gap-4 p-4 ${
        lowStock ? 'border-amber-300 bg-amber-50/50' : ''
      }`}
    >

      <div className="min-w-40 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={href()}
            className="text-xl font-semibold underline-offset-4 hover:underline"
          >
            {item.name}
          </Link>
          {lowStock ? (
            <StatusBadge tone="warning">Low stock</StatusBadge>
          ) : null}
          {item.archivedAtMs ? (
            <StatusBadge tone="danger">Archived</StatusBadge>
          ) : item.status === 'inactive' ? (
            <StatusBadge>Inactive</StatusBadge>
          ) : null}
        </div>

        <p className="mt-1 text-lg text-slate-700">
          In stock: <strong>{item.trackingMethod === 'liquid' ? item.liquidTotalFormatted : item.currentQuantity}</strong> {item.trackingMethod === 'liquid' ? 'ml' : item.unitOfMeasurement}
          {item.unitCostFormatted ? <> · Cost: {item.unitCostFormatted} / {item.trackingMethod === 'liquid' ? 'vial' : item.unitOfMeasurement}</> : null}
        </p>

        <p className="mt-1 font-mono text-sm text-slate-500">
          Item Code: {item.internalCode}
          {item.referenceNumber ? ` · Ref ${item.referenceNumber}` : ''}
          {item.manufacturer ? ` · ${item.manufacturer}` : ''}
        </p>
      </div>

      <div className="flex w-full flex-wrap gap-2 sm:w-auto">
        <ButtonLink
          href={href()}
          variant="secondary"
          className="flex-1 sm:flex-none"
        >
          View
        </ButtonLink>
        {canEdit && !item.archivedAtMs ? (
          <>
            <ButtonLink
              href={href('/edit')}
              variant="secondary"
              className="flex-1 sm:flex-none"
            >
              Edit
            </ButtonLink>
            <ButtonLink
              href={href('/stock')}
              variant="soft"
              className="flex-1 sm:flex-none"
            >
              Stock
            </ButtonLink>
          </>
        ) : null}
        <ButtonLink
          href={href('/barcode')}
          variant="secondary"
          className="flex-1 sm:flex-none"
        >
          View Barcode
        </ButtonLink>
      </div>
    </li>
  );
}
