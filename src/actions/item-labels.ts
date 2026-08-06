import { and, eq, inArray } from 'drizzle-orm';
import type { AppDatabase } from '@/db/client';
import { items } from '@/db/schema';
import type { Actor } from '@/domain/actor';
import { renderInventoryLabelSvg } from '@/domain/barcode';
import { errors } from '@/domain/errors';
import {
  calculateLabelSheetLayout,
  isLabelSizeId,
  MAX_BULK_LABEL_ITEMS,
  MAX_BULK_LABELS,
  MAX_COPIES_PER_ITEM,
} from '@/domain/label-sheet';
import { listItems } from '@/domain/items';

export interface LabelSelectionItemView {
  id: number;
  name: string;
  photoUrl: string | null;
  internalCode: string;
  barcodeValue: string;
  referenceNumber: string | null;
  category: string | null;
  storageLocation: string | null;
  currentQuantity: number;
  lowStockThreshold: number | null;
  status: 'active';
}

export function listActiveItemsForLabels(
  db: AppDatabase,
  actor: Actor,
): LabelSelectionItemView[] {
  void actor;
  return listItems(db, { limit: MAX_BULK_LABEL_ITEMS })
    .filter((item) => item.status === 'active' && !item.archivedAt)
    .map((item) => ({
      id: item.id,
      name: item.name,
      photoUrl: item.photoUrl,
      internalCode: item.internalCode,
      barcodeValue: item.barcodeValue,
      referenceNumber: item.referenceNumber,
      category: item.category,
      storageLocation: item.storageLocation,
      currentQuantity: item.currentQuantity,
      lowStockThreshold: item.lowStockThreshold,
      status: 'active' as const,
    }));
}

export interface BulkLabelSelection {
  itemId: number;
  copies: number;
}

export interface BulkLabelRequest {
  sizeId: string;
  selection: BulkLabelSelection[];
}

export interface ResolvedBulkLabelItem {
  id: number;
  name: string;
  internalCode: string;
  barcodeValue: string;
  referenceNumber: string | null;
  copies: number;
  labelSvg: string;
}

export interface ResolvedBulkLabels {
  items: ResolvedBulkLabelItem[];
  layout: ReturnType<typeof calculateLabelSheetLayout>;
}

export function resolveBulkLabels(
  db: AppDatabase,
  actor: Actor,
  request: BulkLabelRequest,
): ResolvedBulkLabels {
  void actor;
  if (!isLabelSizeId(request.sizeId)) {
    throw errors.validationFailed('Select a valid label size');
  }
  if (!Array.isArray(request.selection) || request.selection.length === 0) {
    throw errors.validationFailed('Select at least one item');
  }
  if (request.selection.length > MAX_BULK_LABEL_ITEMS) {
    throw errors.validationFailed(`Select no more than ${MAX_BULK_LABEL_ITEMS} items`);
  }

  const copiesById = new Map<number, number>();
  for (const entry of request.selection) {
    if (!Number.isSafeInteger(entry.itemId) || entry.itemId <= 0) {
      throw errors.validationFailed('One or more selected items are invalid');
    }
    if (
      !Number.isSafeInteger(entry.copies) ||
      entry.copies < 1 ||
      entry.copies > MAX_COPIES_PER_ITEM
    ) {
      throw errors.validationFailed(
        `Copies must be between 1 and ${MAX_COPIES_PER_ITEM} for every item`,
      );
    }
    if (copiesById.has(entry.itemId)) {
      throw errors.validationFailed('The same item was selected more than once');
    }
    copiesById.set(entry.itemId, entry.copies);
  }

  const totalLabels = [...copiesById.values()].reduce((total, copies) => total + copies, 0);
  if (totalLabels > MAX_BULK_LABELS) {
    throw errors.validationFailed(
      `A label sheet can contain at most ${MAX_BULK_LABELS} labels`,
    );
  }

  const selected = db
    .select()
    .from(items)
    .where(
      and(
        inArray(items.id, [...copiesById.keys()]),
        eq(items.status, 'active'),
      ),
    )
    .all()
    .filter((item) => !item.archivedAt)
    .sort((left, right) => left.name.localeCompare(right.name) || left.id - right.id);

  if (selected.length !== copiesById.size) {
    throw errors.validationFailed(
      'One or more selected items are no longer active. Return to selection and try again.',
    );
  }

  const resolved = selected.map((item) => {
    let labelSvg: string;
    try {
      labelSvg = renderInventoryLabelSvg({
        name: item.name,
        internalCode: item.internalCode,
        referenceNumber: item.referenceNumber,
      });
    } catch {
      throw errors.validationFailed(
        `One or more barcodes could not be generated: ${item.name}. Try again or remove the affected item.`,
      );
    }
    return {
      id: item.id,
      name: item.name,
      internalCode: item.internalCode,
      barcodeValue: item.barcodeValue,
      referenceNumber: item.referenceNumber,
      copies: copiesById.get(item.id)!,
      labelSvg,
    };
  });

  return {
    items: resolved,
    layout: calculateLabelSheetLayout(request.sizeId, totalLabels),
  };
}
