import type { AppDatabase } from '@/db/client';
import type { Actor } from '@/domain/actor';
import { isAdmin } from '@/domain/actor';
import {
  listItemHistory,
  type ItemHistoryCategory,
  type ItemHistoryEntry,
} from '@/domain/item-history';
import { getItem } from '@/domain/items';

export const ITEM_HISTORY_FILTERS: Array<{
  value: ItemHistoryCategory;
  label: string;
}> = [
  { value: 'all', label: 'All' },
  { value: 'received', label: 'Stock Received' },
  { value: 'counts', label: 'Inventory Counts' },
  { value: 'operations', label: 'Surgeries' },
  { value: 'adjustments', label: 'Manual Adjustments' },
  { value: 'information', label: 'Item Information Changes' },
  { value: 'cost', label: 'Cost Changes' },
];

export interface ItemHistoryView {
  item: {
    id: number;
    name: string;
    internalCode: string;
    referenceNumber: string | null;
    photoUrl: string | null;
    currentQuantity: number;
    unitOfMeasurement: string;
  };
  entries: ItemHistoryEntry[];
  filter: ItemHistoryCategory;
}

export function getItemHistoryForActor(
  db: AppDatabase,
  actor: Actor,
  itemId: number,
  requestedFilter: string,
): ItemHistoryView | undefined {
  // Серверная граница обязательна: скрытой кнопки для Staff недостаточно.
  if (!isAdmin(actor)) return undefined;
  const item = getItem(db, itemId);
  if (!item) return undefined;
  const filter =
    ITEM_HISTORY_FILTERS.find((option) => option.value === requestedFilter)?.value ?? 'all';

  return {
    item: {
      id: item.id,
      name: item.name,
      internalCode: item.internalCode,
      referenceNumber: item.referenceNumber,
      photoUrl: item.photoUrl,
      currentQuantity: item.currentQuantity,
      unitOfMeasurement: item.unitOfMeasurement,
    },
    entries: listItemHistory(db, item.id, filter),
    filter,
  };
}
