import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getOperationState,
  getOperationSummary,
  soundOnScanEnabled,
  type OperationLineView,
  type OperationStateView,
} from '@/actions/operations';
import { requirePage } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../../_components/app-header';
import { CopySummaryButton } from '../_components/copy-summary';
import { formatDateTime } from '../_components/format';
import { OperationScreen } from '../_components/operation-screen';
import { SummaryTable } from '../_components/summary-table';
import { VoidOperationButton } from '../_components/void-dialog';

export const dynamic = 'force-dynamic';

/**
 * Экран одной операции.
 *
 * Состояние читается из БД при каждом заходе (§8.2, §8.3): refresh, закрытие
 * вкладки, logout, истечение сессии и перезапуск сервера возвращают ровно то,
 * что было сохранено, — статус не меняется и позиции не теряются.
 *
 * Завершённая и аннулированная операции открываются только для чтения: изменить
 * их состав нельзя ни кнопкой, ни запросом (§9.2, §18.14). Для них рисуется
 * полная карточка §12.2 — код, статус, временные отметки, позиции с источником
 * добавления, количеством, сохранённой стоимостью единицы и суммой строки, плюс
 * общий итог; у завершённой операции дополнительно есть сводка §12.3.
 *
 * Все суммы приходят из СНИМКОВ строки и снимка итога операции. Ни одного
 * обращения к текущей цене предмета на этой странице нет — §11.3, §18.16.
 */
export default async function OperationPage({ params }: { params: Promise<{ id: string }> }) {
  const { account, actor } = await requirePage();
  const operationId = Number((await params).id);
  if (!Number.isSafeInteger(operationId) || operationId <= 0) notFound();

  const db = getDb();
  const state = getOperationState(db, actor, operationId);
  // §18.22 / Q-34: для Staff аннулированной операции просто не существует.
  if (!state) notFound();

  const isAdmin = account.role === 'Admin';

  if (state.status !== 'Active') {
    // §12.3: сводка существует только у завершённой операции. У аннулированной
    // материалы возвращены на склад (§9.3) — переносить в Symplast нечего.
    const summary = getOperationSummary(db, actor, operationId);

    return (
      <main className="app-shell flex max-w-5xl flex-col">
        <AppHeader
          title={`Case ${state.caseCode}`}
          backHref="/operations"
          backLabel="Operations"
          account={{ username: account.username, role: account.role }}
        />

        <OperationHeaderCard state={state} />

        <section className="mt-4 rounded-2xl bg-white p-4 ring-1 ring-slate-200 sm:p-5">
          <h2 className="mb-3 text-xl font-semibold">Items used</h2>
          {state.lines.length === 0 ? (
            <p className="text-lg text-slate-600">No items were added to this operation.</p>
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {state.lines.map((line) => (
                  <OperationLineRow key={line.id} line={line} />
                ))}
              </ul>

              {/*
                Итог — снимок операции (§11.2, §18.16). Изменение текущей цены
                предмета, состава пака или его названия эту сумму не трогает.
              */}
              {state.totalCostFormatted ? (
                <p className="mt-4 border-t-2 border-slate-900 pt-3 text-right text-xl">
                  Total cost: <strong className="text-2xl">{state.totalCostFormatted}</strong>
                </p>
              ) : null}
            </>
          )}
        </section>

        {summary ? (
          <section className="mt-4 rounded-2xl bg-white p-4 ring-1 ring-slate-200 sm:p-5">
            <h2 className="text-xl font-semibold">Symplast summary</h2>
            <p className="mb-4 text-base text-slate-600">
              Materials used, ready to be transferred manually. No patient information is stored or
              shown.
            </p>

            <SummaryTable summary={summary} />

            <div className="mt-4 flex flex-wrap items-start gap-3">
              <Link
                href={`/operations/${state.id}/summary`}
                className="rounded-xl bg-slate-900 px-8 py-4 text-lg font-semibold text-white"
              >
                Print Summary
              </Link>
              <CopySummaryButton text={summary.text} />
            </div>
          </section>
        ) : null}

        {isAdmin && state.canVoid ? (
          <section className="mt-4 rounded-2xl border border-red-200 bg-white p-4">
            <VoidOperationButton
              operationId={state.id}
              caseCode={state.caseCode}
              redirectTo={`/operations?voided=${encodeURIComponent(state.caseCode)}`}
              variant="block"
            />
          </section>
        ) : null}

        <p className="mt-6 text-center">
          <Link href="/operations" className="text-lg text-slate-600 underline underline-offset-4">
            All operations
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="app-shell flex max-w-4xl flex-col">
      <AppHeader
        title="Operation"
        backHref="/operations"
        backLabel="Operations"
        account={{ username: account.username, role: account.role }}
      />
      <OperationScreen
        initialState={state}
        soundEnabled={soundOnScanEnabled(db)}
        isAdmin={isAdmin}
      />
    </main>
  );
}

/**
 * Шапка карточки (§12.2): код операции, статус, временные отметки и категория,
 * если она используется (§12.1). Свободных полей здесь нет — категория приходит
 * из закрытого справочника, которого заказчик ещё не утвердил (D-35).
 */
function OperationHeaderCard({ state }: { state: OperationStateView }) {
  const rows: { label: string; value: string }[] = [
    { label: 'Created', value: formatDateTime(state.createdAtMs) },
  ];
  if (state.finishedAtMs) rows.push({ label: 'Finished', value: formatDateTime(state.finishedAtMs) });
  if (state.voidedAtMs) rows.push({ label: 'Voided', value: formatDateTime(state.voidedAtMs) });
  if (state.procedureCategory) rows.push({ label: 'Category', value: state.procedureCategory });
  if (state.voidReason) rows.push({ label: 'Void reason', value: state.voidReason });

  return (
    <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-base text-slate-600">Case</p>
          <p className="font-mono text-3xl font-bold tracking-wider">{state.caseCode}</p>
        </div>
        <span
          className={`rounded-full px-5 py-2 text-lg font-semibold ${
            state.status === 'Voided' ? 'bg-red-100 text-red-900' : 'bg-slate-200 text-slate-900'
          }`}
        >
          {state.status}
        </span>
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-wrap gap-2">
            <dt className="text-base text-slate-600">{row.label}:</dt>
            <dd className="text-lg text-slate-900">{row.value}</dd>
          </div>
        ))}
      </dl>

      {/* C-10: уникальные позиции и единицы — разные величины, подписаны отдельно. */}
      <p className="mt-4 text-lg">
        <strong>{state.itemCount}</strong> unique items · <strong>{state.unitCount}</strong> units
        used
        {state.totalCostFormatted ? (
          <>
            {' · '}Total cost: <strong>{state.totalCostFormatted}</strong>
          </>
        ) : null}
      </p>
    </section>
  );
}

/**
 * Строка карточки (§12.2): предмет, источник добавления (отдельный скан или
 * пак), количество, сохранённая стоимость единицы и сумма строки.
 *
 * Название, Item Code, reference number и стоимость — снимки на момент добавления
 * (§11.2, §18.15): предмет мог быть переименован, подорожать или вовсе исчезнуть
 * из состава пака, и на этой странице это ничего не меняет.
 */
function OperationLineRow({ line }: { line: OperationLineView }) {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3">
      <div className="min-w-48 flex-1">
        <p className="text-lg font-semibold">{line.name}</p>
        <p className="text-base text-slate-600">
          <span className="font-mono">{line.internalCode}</span>
          {line.referenceNumber ? ` · Ref ${line.referenceNumber}` : ''}
        </p>
        <span
          className={`mt-1 inline-block rounded-full px-3 py-1 text-sm font-semibold ${
            line.sourceType === 'pack'
              ? 'bg-sky-100 text-sky-900'
              : 'bg-slate-100 text-slate-700'
          }`}
        >
          {line.sourceType === 'pack'
            ? `From pack${line.sourcePackName ? `: ${line.sourcePackName}` : ''}`
            : 'Individual scan'}
        </span>
      </div>

      <div className="text-right">
        <p className="text-xl font-bold">
          {line.quantity}
          <span className="ml-1 text-base font-normal text-slate-600">
            {line.unitOfMeasurement}
          </span>
        </p>
        {line.unitCostFormatted ? (
          <p className="text-base text-slate-600">{line.unitCostFormatted} / unit</p>
        ) : null}
        {line.lineTotalFormatted ? (
          <p className="text-lg font-semibold">{line.lineTotalFormatted}</p>
        ) : null}
      </div>
    </li>
  );
}
