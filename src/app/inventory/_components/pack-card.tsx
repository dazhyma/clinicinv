import Link from 'next/link';
import type { PackView } from '@/actions/packs';
import { ItemPhoto } from '../../_components/item-photo';

/**
 * Пак в списке (§6.1, §6.2, §6.4).
 *
 * Показывается состав и ТЕКУЩАЯ расчётная стоимость — сумма (текущая стоимость
 * предмета × количество). Она меняется вслед за ценами предметов и не имеет
 * отношения к завершённым операциям: те хранят собственные снимки (§6.4, §11.3).
 *
 * Собственного остатка у пака нет и здесь не показывается (§6.5, §18.10).
 * Числа рядом с предметами — их складские остатки, чтобы было видно, чем набор
 * реально можно собрать.
 *
 * Стоимость печатается ТОЛЬКО если сервер её прислал: при выключенной настройке
 * `staff_can_see_cost` полей стоимости в объекте нет вовсе (D-18).
 */
export function PackCard({ pack, canEdit }: { pack: PackView; canEdit: boolean }) {
  return (
    <li className="flex flex-wrap items-start gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <ItemPhoto photoUrl={pack.photoUrl} name={pack.name} size={64} />

      <div className="min-w-56 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xl font-semibold">{pack.name}</span>
          {pack.status === 'inactive' ? (
            <span className="rounded-full bg-slate-200 px-3 py-1 text-sm font-semibold text-slate-700">
              Inactive
            </span>
          ) : null}
        </div>

        <p className="mt-1 font-mono text-sm text-slate-500">{pack.internalCode}</p>

        <p className="mt-1 text-lg text-slate-700">
          {pack.componentCount} {pack.componentCount === 1 ? 'item' : 'items'} · {pack.totalUnits}{' '}
          {pack.totalUnits === 1 ? 'unit' : 'units'} per scan
          {pack.costFormatted ? <> · Cost: {pack.costFormatted}</> : null}
        </p>

        {pack.components.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1 text-base text-slate-700">
            {pack.components.map((component) => (
              <li key={component.itemId} className="flex flex-wrap gap-x-2">
                <span className="font-medium">{component.name}</span>
                <span>× {component.quantity}</span>
                {component.lineTotalFormatted ? (
                  <span className="text-slate-500">
                    ({component.unitCostFormatted} each = {component.lineTotalFormatted})
                  </span>
                ) : null}
                {component.itemStatus === 'inactive' ? (
                  <span className="font-medium text-amber-800">item inactive</span>
                ) : (
                  <span className="text-slate-500">in stock: {component.itemQuantityInStock}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-base text-amber-800">This pack has no items yet.</p>
        )}

        {pack.notes ? <p className="mt-2 text-base text-slate-600">{pack.notes}</p> : null}
      </div>

      <div className="flex w-full flex-wrap gap-2 sm:w-auto">
        {canEdit ? (
          <Link
            href={`/inventory/packs/${pack.id}/edit`}
            className="flex-1 rounded-xl border border-slate-300 px-5 py-3 text-center text-lg font-medium sm:flex-none"
          >
            Edit
          </Link>
        ) : null}
        <Link
          href={`/inventory/packs/${pack.id}/barcode`}
          className="flex-1 rounded-xl border border-slate-300 px-5 py-3 text-center text-lg font-medium sm:flex-none"
        >
          View Barcode
        </Link>
      </div>
    </li>
  );
}
