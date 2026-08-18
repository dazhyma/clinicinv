import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getOperationSummary } from '@/actions/operations';
import { requirePage } from '@/auth/guards';
import { getDb } from '@/db/client';
import { ArrowLeftIcon } from '../../../_components/icons';
import { CopySummaryButton } from '../../_components/copy-summary';
import { PrintSummaryButton } from '../../_components/print-summary';
import { SummaryTable } from '../../_components/summary-table';

export const dynamic = 'force-dynamic';

/**
 * Print Summary (§12.3, FR-126).
 *
 * Страница чистая по тому же принципу, что страница этикетки (D-25): общей
 * шапки и вкладок здесь нет вовсе, а не скрыты печатью. Блок управления
 * (назад, Print, Copy) лежит в `no-print` — это единственное, что скрывается
 * правилом `@media print`.
 *
 * На бумагу попадают только код операции, позиции и итог. Данных пациента в
 * сводке нет ни на экране, ни в печати (§12.3, §18.3): их нет в модели данных.
 *
 * Сводка есть только у завершённой операции: у аннулированной материалы
 * возвращены на склад (§9.3), переносить в Symplast нечего.
 */
export default async function OperationSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { actor } = await requirePage();
  const operationId = Number((await params).id);
  if (!Number.isSafeInteger(operationId) || operationId <= 0) notFound();

  const summary = getOperationSummary(getDb(), actor, operationId);
  if (!summary) notFound();

  return (
    <main>
      <section className="app-shell no-print flex max-w-4xl flex-col gap-5">
        <Link
          href={`/operations/${operationId}`}
          className="inline-flex w-fit items-center gap-2 rounded-lg px-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
        >
          <ArrowLeftIcon size={18} /> Back to surgery
        </Link>

        <div>
          <p className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
            Symplast summary
          </p>
          <h1 className="font-mono text-2xl font-semibold">{summary.caseCode}</h1>
          <p className="text-lg text-slate-600">
            {summary.itemCount} unique items · {summary.unitCount} units used
          </p>
        </div>

        <div className="flex flex-wrap items-start gap-3">
          <PrintSummaryButton />
          <CopySummaryButton text={summary.text} />
        </div>

        <p className="text-base text-slate-600">
          Transfer these lines into Symplast manually. This summary contains materials only and
          does not include Patient ID.
        </p>
      </section>

      {/* --- То, что попадает на бумагу --- */}
      <section className="mx-auto w-full max-w-3xl bg-white p-4 sm:p-6">
        <h2 className="text-xl font-semibold">Materials used</h2>
        <p className="mb-4 font-mono text-lg">Case {summary.caseCode}</p>
        <SummaryTable summary={summary} />
      </section>
    </main>
  );
}
