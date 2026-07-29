import { NextResponse, type NextRequest } from 'next/server';
import { resolveBulkLabels } from '@/actions/item-labels';
import { requireActor } from '@/auth/guards';
import { getDb } from '@/db/client';
import { isDomainError } from '@/domain/errors';
import { createItemLabelSheetPdf } from '@/pdf/item-label-sheet';
import { readBulkLabelRequest } from '../request';

export const dynamic = 'force-dynamic';

function fileDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor();
    const input = await readBulkLabelRequest(request);
    const model = resolveBulkLabels(getDb(), actor, input);
    const pdf = await createItemLabelSheetPdf(model);

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.byteLength),
        'Content-Disposition': `attachment; filename="inventory-labels-${fileDate()}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (isDomainError(error)) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === 'NOT_AUTHENTICATED' ? 401 : 400 },
      );
    }
    console.error('[item-labels] PDF generation failed', error);
    return NextResponse.json({ error: 'Unable to generate label sheet PDF' }, { status: 500 });
  }
}
