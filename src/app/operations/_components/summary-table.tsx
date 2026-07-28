import type { OperationSummaryView } from '@/actions/operations';

/**
 * Таблица сводки для Symplast (§12.3).
 *
 * Колонок ровно столько, сколько перечисляет §12.3: item name, SKU или
 * reference number, quantity used и — при необходимости — cost с общим итогом.
 * Ни даты процедуры, ни свободного примечания, ни любого другого поля здесь нет
 * и быть не может: это форма, из которой переписывают вручную, и лишняя графа
 * стала бы местом для данных пациента (§2.4, §18.3, FR-125).
 *
 * Компонент не клиентский: он рисуется и в карточке операции, и на чистой
 * странице печати, где скриптов нет вовсе.
 */
export function SummaryTable({ summary }: { summary: OperationSummaryView }) {
  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr className="border-b-2 border-slate-900">
          <th scope="col" className="py-2 pr-3 text-base font-semibold">
            Item
          </th>
          <th scope="col" className="py-2 pr-3 text-base font-semibold">
            SKU / Ref
          </th>
          <th scope="col" className="py-2 pr-3 text-right text-base font-semibold">
            Qty
          </th>
          {summary.showCost ? (
            <>
              <th scope="col" className="py-2 pr-3 text-right text-base font-semibold">
                Unit cost
              </th>
              <th scope="col" className="py-2 text-right text-base font-semibold">
                Line total
              </th>
            </>
          ) : null}
        </tr>
      </thead>

      <tbody>
        {summary.lines.map((line) => (
          <tr key={line.itemId} className="border-b border-slate-200">
            <td className="py-2 pr-3 text-lg">{line.name}</td>
            <td className="py-2 pr-3 font-mono text-base">{line.reference ?? '—'}</td>
            <td className="py-2 pr-3 text-right text-lg font-semibold">
              {line.quantity}
              <span className="ml-1 text-base font-normal text-slate-600">
                {line.unitOfMeasurement}
              </span>
            </td>
            {summary.showCost ? (
              <>
                {/* Стоимость единицы отсутствует, если предмет попал в операцию
                    по разным ценам: усреднять снимки нельзя (§11.3, D-5). */}
                <td className="py-2 pr-3 text-right text-lg">{line.unitCostFormatted ?? '—'}</td>
                <td className="py-2 text-right text-lg">{line.lineTotalFormatted ?? '—'}</td>
              </>
            ) : null}
          </tr>
        ))}
      </tbody>

      {summary.showCost && summary.totalCostFormatted ? (
        <tfoot>
          <tr>
            <td colSpan={4} className="py-3 pr-3 text-right text-lg font-semibold">
              Total
            </td>
            <td className="py-3 text-right text-xl font-bold">{summary.totalCostFormatted}</td>
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}
