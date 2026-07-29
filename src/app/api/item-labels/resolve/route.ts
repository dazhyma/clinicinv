import { NextResponse, type NextRequest } from 'next/server';
import { resolveBulkLabels } from '@/actions/item-labels';
import { requireActor } from '@/auth/guards';
import { getDb } from '@/db/client';
import { isDomainError } from '@/domain/errors';
import { readBulkLabelRequest } from '../request';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor();
    const input = await readBulkLabelRequest(request);
    const model = resolveBulkLabels(getDb(), actor, input);
    return NextResponse.json(model, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (isDomainError(error)) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === 'NOT_AUTHENTICATED' ? 401 : 400 },
      );
    }
    console.error('[item-labels] preview generation failed', error);
    return NextResponse.json({ error: 'Unable to generate label sheet' }, { status: 500 });
  }
}
