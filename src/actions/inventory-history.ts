import type { AppDatabase } from '@/db/client';
import { isInventoryWorker, type Actor } from '@/domain/actor';
import {
  getCompletedInventoryCount,
  listCompletedInventoryCounts,
} from '@/domain/inventory-count';

function countCode(id: number, value: string | null): string {
  return value ?? `INV-${String(id).padStart(6, '0')}`;
}

export interface InventoryHistoryRowView {
  id: number;
  internalCode: string;
  status: 'Completed';
  createdAtMs: number;
  completedAtMs: number;
  startedBy: 'Staff' | 'Admin' | null;
  completedBy: 'Staff' | 'Admin' | null;
  countedItems: number;
  differenceCount: number;
}

export function listInventoryHistoryForActor(
  db: AppDatabase,
  actor: Actor,
): InventoryHistoryRowView[] {
  if (!isInventoryWorker(actor)) return [];
  return listCompletedInventoryCounts(db).map(({ count, countedItems, differenceCount }) => ({
    id: count.id,
    internalCode: countCode(count.id, count.internalCode),
    status: 'Completed',
    createdAtMs: count.createdAt.getTime(),
    completedAtMs: (count.appliedAt ?? count.updatedAt).getTime(),
    startedBy: count.createdByRole,
    completedBy: count.completedByRole,
    countedItems,
    differenceCount,
  }));
}

export interface InventoryHistoryDetailView {
  summary: InventoryHistoryRowView;
  lines: Array<{
    id: number;
    itemId: number;
    name: string;
    internalCode: string;
    sku: string | null;
    referenceNumber: string | null;
    photoUrl: string | null;
    unitOfMeasurement: string;
    expectedQuantity: number;
    countedQuantity: number;
    difference: number;
    finalQuantity: number;
    updatedBy: 'Staff' | 'Admin' | null;
    updatedAtMs: number;
  }>;
}

export function getInventoryHistoryForActor(
  db: AppDatabase,
  actor: Actor,
  countId: number,
): InventoryHistoryDetailView | undefined {
  if (!isInventoryWorker(actor)) return undefined;
  const result = getCompletedInventoryCount(db, countId);
  if (!result) return undefined;
  const differenceCount = result.lines.filter((line) => line.difference !== 0).length;
  return {
    summary: {
      id: result.count.id,
      internalCode: countCode(result.count.id, result.count.internalCode),
      status: 'Completed',
      createdAtMs: result.count.createdAt.getTime(),
      completedAtMs: (result.count.appliedAt ?? result.count.updatedAt).getTime(),
      startedBy: result.count.createdByRole,
      completedBy: result.count.completedByRole,
      countedItems: result.lines.length,
      differenceCount,
    },
    lines: result.lines.map((line) => ({
      id: line.id,
      itemId: line.itemId,
      name: line.itemNameSnapshot ?? `Item ${line.itemId}`,
      internalCode: line.internalCodeSnapshot ?? '',
      sku: line.skuSnapshot,
      referenceNumber: line.referenceNumberSnapshot,
      photoUrl: line.photoUrlSnapshot,
      unitOfMeasurement: line.unitOfMeasurementSnapshot ?? 'units',
      expectedQuantity: line.expectedQuantity,
      countedQuantity: line.countedQuantity,
      difference: line.difference,
      finalQuantity: line.finalQuantity ?? line.countedQuantity,
      updatedBy: line.updatedByRole,
      updatedAtMs: line.updatedAt.getTime(),
    })),
  };
}
