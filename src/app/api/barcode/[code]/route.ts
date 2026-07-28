/**
 * Скачивание этикетки файлом: Download SVG и Download PNG (§5.6).
 *
 * Страница печати рисует SVG прямо в разметке — лишнего запроса для показа не
 * требуется. Этот маршрут нужен только кнопкам скачивания.
 *
 * Два правила, которые здесь держатся:
 *   1) §15/NFR-18: без сессии — 401 и никакого содержимого. Публичного URL,
 *      выдающего данные инвентаря (а внутренний код — данные инвентаря), нет.
 *   2) §18.6: рисуется не произвольная строка из URL, а только код, реально
 *      выданный системой, — принадлежность проверяется по реестру штрихкодов.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { requireActor } from '@/auth/guards';
import { getDb } from '@/db/client';
import { renderBarcodePng, renderLabelSvg } from '@/domain/barcode';
import { findBarcodeOwner, normalizeScannedCode } from '@/domain/codes';
import { isDomainError } from '@/domain/errors';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ code: string }> }) {
  try {
    await requireActor();
  } catch (error) {
    if (isDomainError(error)) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }

  const { code } = await context.params;
  const value = normalizeScannedCode(decodeURIComponent(code));

  if (!findBarcodeOwner(getDb(), value)) {
    // §14.4: конкретная формулировка, та же, что видит сканер.
    return NextResponse.json({ error: 'Barcode not found' }, { status: 404 });
  }

  const format = request.nextUrl.searchParams.get('format') === 'png' ? 'png' : 'svg';
  const headers: Record<string, string> = {
    // private + no-store: этикетка не должна осесть в общем кеше прокси (§15).
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `attachment; filename="${value}.${format}"`,
  };

  if (format === 'png') {
    const png = await renderBarcodePng(value);
    return new NextResponse(new Uint8Array(png), {
      headers: { ...headers, 'Content-Type': 'image/png', 'Content-Length': String(png.byteLength) },
    });
  }

  return new NextResponse(renderLabelSvg(value), {
    headers: { ...headers, 'Content-Type': 'image/svg+xml; charset=utf-8' },
  });
}
