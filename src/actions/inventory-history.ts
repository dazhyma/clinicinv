import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '@/db/client';
import { inventoryMovements } from '@/db/schema';
import { isInventoryWorker, type Actor } from '@/domain/actor';
import {
  deleteCompletedInventoryCount,
  getCompletedInventoryCount,
  listCompletedInventoryCounts,
} from '@/domain/inventory-count';
import { isAdmin } from '@/domain/actor';
import { forbidden, runAction, type ActionResult } from './result';

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
  adjustmentCount: number;
}

export function listInventoryHistoryForActor(
  db: AppDatabase,
  actor: Actor,
): InventoryHistoryRowView[] {
  if (!isInventoryWorker(actor)) return [];
  return listCompletedInventoryCounts(db).map(({ count, countedItems, differenceCount }) => {
    const adjustmentCount = db
      .select({ id: inventoryMovements.id })
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.inventoryCountId, count.id),
          eq(inventoryMovements.movementType, 'count_correction'),
          eq(inventoryMovements.reason, 'inventory correction'),
        ),
      )
      .all().length;
    return {
      id: count.id,
      internalCode: countCode(count.id, count.internalCode),
      status: 'Completed',
      createdAtMs: count.createdAt.getTime(),
      completedAtMs: (count.appliedAt ?? count.updatedAt).getTime(),
      startedBy: count.createdByRole,
      completedBy: count.completedByRole,
      countedItems,
      differenceCount,
      adjustmentCount,
    };
  });
}

export interface InventoryHistoryDetailView {
  summary: InventoryHistoryRowView;
  lines: Array<{
    id: number;
    itemId: number;
    name: string;
    internalCode: string;
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
  const adjustmentCount = db
    .select({ id: inventoryMovements.id })
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.inventoryCountId, countId),
        eq(inventoryMovements.movementType, 'count_correction'),
        eq(inventoryMovements.reason, 'inventory correction'),
      ),
    )
    .all().length;
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
      adjustmentCount,
    },
    lines: result.lines.map((line) => ({
      id: line.id,
      itemId: line.itemId,
      name: line.itemNameSnapshot ?? `Item ${line.itemId}`,
      internalCode: line.internalCodeSnapshot ?? '',
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

export interface DeletedInventoryCountView {
  id: number;
  internalCode: string;
  reversedMovements: number;
}

export function deleteInventoryCountAction(
  db: AppDatabase,
  actor: Actor,
  countId: number,
): ActionResult<DeletedInventoryCountView> {
  if (!isAdmin(actor)) return forbidden('delete inventory count');
  return runAction(() => {
    const result = deleteCompletedInventoryCount(db, actor, countId);
    return {
      id: result.count.id,
      internalCode: countCode(result.count.id, result.count.internalCode),
      reversedMovements: result.reversedMovements,
    };
  });
}
