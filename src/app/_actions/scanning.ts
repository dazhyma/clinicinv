'use server';

import {
  resolveBarcodeForConfirmation,
  type BarcodeConfirmationView,
  searchSelectionTargetsForConfirmation,
  type SelectionSearchResultView,
} from '@/actions/scanning';
import { toFailure, type ActionResult } from '@/actions/result';
import { requireActor } from '@/auth/guards';
import { getDb } from '@/db/client';

/**
 * Session-protected, read-only lookup for a confirmation card.
 *
 * This action deliberately has no operation/count id and accepts no quantity:
 * it cannot alter inventory even if called directly.
 */
export async function resolveBarcodeServerAction(
  barcode: string,
): Promise<ActionResult<BarcodeConfirmationView>> {
  try {
    const actor = await requireActor();
    return resolveBarcodeForConfirmation(getDb(), actor, barcode);
  } catch (error) {
    return toFailure(error);
  }
}

export async function searchSelectionTargetsServerAction(input: {
  query: string;
  includePacks?: boolean;
}): Promise<ActionResult<SelectionSearchResultView[]>> {
  try {
    const actor = await requireActor();
    return searchSelectionTargetsForConfirmation(getDb(), actor, input);
  } catch (error) {
    return toFailure(error);
  }
}
