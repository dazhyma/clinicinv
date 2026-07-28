import { notFound } from 'next/navigation';
import { getItemForActor } from '@/actions/items';
import { requirePage } from '@/auth/guards';
import { getDb } from '@/db/client';
import { renderLabelSvg } from '@/domain/barcode';
import { LabelPrintView } from '../../../_components/label-print';

export const dynamic = 'force-dynamic';

/**
 * View Barcode для предмета (§5.6, §18.8).
 *
 * Отдельная чистая страница: ни шапки, ни вкладок, ни карточки предмета — на
 * бумагу попадают только этикетки. Управление (копии, размер, Print, скачивание)
 * живёт в блоке `no-print`.
 *
 * Печатается текущее значение штрихкода: SKU, если он задан, либо постоянный
 * внутренний код. Прежние значения остаются алиасами и продолжают сканироваться.
 *
 * Доступно обеим ролям: §3.2 не запрещает Staff печатать этикетку, а стоимости
 * на этикетке нет вовсе.
 */
export default async function ItemBarcodePage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requirePage();
  const { id } = await params;
  const itemId = Number(id);
  if (!Number.isSafeInteger(itemId) || itemId <= 0) notFound();

  const item = getItemForActor(getDb(), actor, itemId);
  if (!item) notFound();

  return (
    <main>
      <LabelPrintView
        kindLabel="Item"
        title={item.name}
        code={item.barcodeValue}
        labelSvg={renderLabelSvg(item.barcodeValue)}
        backHref={`/inventory/items/${item.id}`}
        backLabel="Back to Item"
      />
    </main>
  );
}
