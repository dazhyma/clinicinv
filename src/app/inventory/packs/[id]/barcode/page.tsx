import { notFound } from 'next/navigation';
import { getPackForActor } from '@/actions/packs';
import { requirePage } from '@/auth/guards';
import { getDb } from '@/db/client';
import { renderLabelSvg } from '@/domain/barcode';
import { LabelPrintView } from '../../../_components/label-print';

export const dynamic = 'force-dynamic';

/**
 * View Barcode для пака (§6.6) — та же страница печати, что и у предмета
 * (§5.6): название пака, штрихкод, внутренний код пака.
 *
 * Код `PCK-000015` постоянен (§5.5, §18.6): изменение названия, фотографии,
 * состава или заметок его не меняет, поэтому наклеенная этикетка остаётся
 * верной и после редактирования состава.
 *
 * Стоимости пака на этикетке нет — печатать её незачем, и вопрос видимости
 * себестоимости для Staff здесь не возникает.
 */
export default async function PackBarcodePage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requirePage();
  const { id } = await params;
  const packId = Number(id);
  if (!Number.isSafeInteger(packId) || packId <= 0) notFound();

  const pack = getPackForActor(getDb(), actor, packId);
  if (!pack) notFound();

  return (
    <main>
      <LabelPrintView
        kindLabel="Pack"
        title={pack.name}
        code={pack.internalCode}
        labelSvg={renderLabelSvg(pack.barcodeValue)}
        backHref={`/inventory/packs/${pack.id}`}
        backLabel="Back to Pack"
      />
    </main>
  );
}
