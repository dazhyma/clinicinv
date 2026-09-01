/**
 * Неизменяемая история одного товара. Количественные события читаются из
 * canonical inventory_movements; изменения карточки — из структурированных
 * item_history_events. Журнал движений не дублируется и не изменяется.
 */
import { asc, eq, inArray } from 'drizzle-orm';
import type { DbLike } from '@/db/client';
import {
  inventoryCounts,
  inventoryMovements,
  itemHistoryEvents,
  liquidInventoryMovements,
  operations,
  userAccounts,
  type UserRole,
} from '@/db/schema';
import { formatCentiml } from './liquid';

export type ItemHistoryCategory =
  | 'all'
  | 'received'
  | 'counts'
  | 'operations'
  | 'adjustments'
  | 'information'
  | 'cost';

export interface ItemHistoryEventInput {
  itemId: number;
  eventType:
    | 'item.created'
    | 'item.information_changed'
    | 'item.cost_changed'
    | 'item.archived';
  fieldName?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  actorAccountId?: number | null;
  actorRole?: UserRole | null;
  createdAt?: Date;
}

export function writeItemHistoryEvent(tx: DbLike, input: ItemHistoryEventInput): void {
  tx.insert(itemHistoryEvents)
    .values({
      itemId: input.itemId,
      eventType: input.eventType,
      fieldName: input.fieldName ?? null,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
      actorAccountId: input.actorAccountId ?? null,
      actorRole: input.actorRole ?? null,
      createdAt: input.createdAt ?? new Date(),
    })
    .run();
}

export interface ItemHistoryEntry {
  id: string;
  category: Exclude<ItemHistoryCategory, 'all'>;
  action: string;
  createdAtMs: number;
  accountRole: UserRole | null;
  quantityBefore: number | null;
  quantityDelta: number | null;
  quantityAfter: number | null;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  operationCode: string | null;
  inventoryCountCode: string | null;
  reason: string | null;
  liquidStockBefore: string | null;
  liquidVolumeDeltaMl: string | null;
  liquidStockAfter: string | null;
}

function movementPresentation(type: string, reason?: string | null): {
  action: string;
  category: ItemHistoryEntry['category'];
} {
  switch (type) {
    case 'initial':
      return { action: 'Initial Stock', category: 'information' };
    case 'received':
      return { action: 'Receive Stock', category: 'received' };
    case 'count_correction':
      return {
        action:
          reason === 'inventory count deleted'
            ? 'Inventory Count Deleted'
            : 'Inventory Count Adjustment',
        category: 'counts',
      };
    case 'manual_adjustment':
      return { action: 'Manual Adjustment', category: 'adjustments' };
    case 'used_in_operation':
      return { action: 'Used in Surgery', category: 'operations' };
    case 'returned_from_operation':
      return { action: 'Returned from Active Surgery', category: 'operations' };
    case 'void_reversal':
      return { action: 'Returned by Void Surgery', category: 'operations' };
    default:
      return { action: type, category: 'adjustments' };
  }
}

function fieldLabel(field: string | null): string {
  const labels: Record<string, string> = {
    name: 'Item Name Changed',
    referenceNumber: 'Reference Number Changed',
    unitOfMeasurement: 'Unit of Measurement Changed',
    category: 'Category Changed',
    storageLocation: 'Storage Location Changed',
    lowStockThreshold: 'Low-stock Threshold Changed',
    notes: 'Notes Changed',
    status: 'Item Status Changed',
  };
  return field ? labels[field] ?? 'Item Information Changed' : 'Item Information Changed';
}

export function listItemHistory(
  tx: DbLike,
  itemId: number,
  filter: ItemHistoryCategory = 'all',
): ItemHistoryEntry[] {
  const movements = tx
    .select()
    .from(inventoryMovements)
    .where(eq(inventoryMovements.itemId, itemId))
    .orderBy(asc(inventoryMovements.id))
    .all();
  const events = tx
    .select()
    .from(itemHistoryEvents)
    .where(eq(itemHistoryEvents.itemId, itemId))
    .orderBy(asc(itemHistoryEvents.id))
    .all();
  const liquidMovements = tx
    .select()
    .from(liquidInventoryMovements)
    .where(eq(liquidInventoryMovements.itemId, itemId))
    .orderBy(asc(liquidInventoryMovements.id))
    .all();

  const accountIds = Array.from(
    new Set(
      [
        ...movements.map((row) => row.createdByAccountId),
        ...liquidMovements.map((row) => row.createdByAccountId),
        ...events.map((row) => row.actorAccountId),
      ].filter((value): value is number => value != null),
    ),
  );
  const accountRoles = new Map<number, UserRole>();
  if (accountIds.length) {
    for (const account of tx
      .select({ id: userAccounts.id, role: userAccounts.role })
      .from(userAccounts)
      .where(inArray(userAccounts.id, accountIds))
      .all()) {
      accountRoles.set(account.id, account.role);
    }
  }

  const operationIds = Array.from(
    new Set(
      [...movements, ...liquidMovements]
        .map((row) => row.operationId)
        .filter((value): value is number => value != null),
    ),
  );
  const operationCodes = new Map<number, string>();
  if (operationIds.length) {
    for (const operation of tx
      .select({ id: operations.id, code: operations.randomCaseCode })
      .from(operations)
      .where(inArray(operations.id, operationIds))
      .all()) {
      operationCodes.set(operation.id, operation.code);
    }
  }

  const countIds = Array.from(
    new Set(
      [...movements, ...liquidMovements]
        .map((row) => row.inventoryCountId)
        .filter((value): value is number => value != null),
    ),
  );
  const countCodes = new Map<number, string>();
  if (countIds.length) {
    for (const count of tx
      .select({ id: inventoryCounts.id, code: inventoryCounts.internalCode })
      .from(inventoryCounts)
      .where(inArray(inventoryCounts.id, countIds))
      .all()) {
      countCodes.set(count.id, count.code ?? `INV-${String(count.id).padStart(6, '0')}`);
    }
  }

  let runningQuantity = 0;
  const movementEntries = movements.map<ItemHistoryEntry>((movement) => {
    const quantityBefore = runningQuantity;
    runningQuantity += movement.quantityDelta;
    const presentation = movementPresentation(movement.movementType, movement.reason);
    return {
      id: `movement-${movement.id}`,
      category: presentation.category,
      action: presentation.action,
      createdAtMs: movement.createdAt.getTime(),
      accountRole:
        movement.createdByAccountId != null
          ? accountRoles.get(movement.createdByAccountId) ?? null
          : null,
      quantityBefore,
      quantityDelta: movement.quantityDelta,
      quantityAfter: runningQuantity,
      fieldName: null,
      oldValue: null,
      newValue: null,
      operationCode:
        movement.operationId != null ? operationCodes.get(movement.operationId) ?? null : null,
      inventoryCountCode:
        movement.inventoryCountId != null
          ? countCodes.get(movement.inventoryCountId) ?? null
          : null,
      reason: movement.reason,
      liquidStockBefore: null,
      liquidVolumeDeltaMl: null,
      liquidStockAfter: null,
    };
  });

  let runningUnopenedVials = 0;
  const liquidMovementEntries = liquidMovements.map<ItemHistoryEntry>((movement) => {
    const unopenedBefore = runningUnopenedVials;
    runningUnopenedVials += movement.unopenedVialsDelta;
    const presentation = movementPresentation(movement.movementType, movement.reason);
    return {
      id: `liquid-movement-${movement.id}`,
      category: presentation.category,
      action: presentation.action,
      createdAtMs: movement.createdAt.getTime(),
      accountRole:
        movement.createdByAccountId != null
          ? accountRoles.get(movement.createdByAccountId) ?? null
          : null,
      quantityBefore: null,
      quantityDelta: null,
      quantityAfter: null,
      fieldName: null,
      oldValue: null,
      newValue: null,
      operationCode:
        movement.operationId != null ? operationCodes.get(movement.operationId) ?? null : null,
      inventoryCountCode:
        movement.inventoryCountId != null
          ? countCodes.get(movement.inventoryCountId) ?? null
          : null,
      reason: movement.reason,
      liquidStockBefore: `${unopenedBefore} unopened + ${formatCentiml(movement.openVialCentimlBefore)} ml open`,
      liquidVolumeDeltaMl: formatCentiml(movement.totalVolumeCentimlDelta),
      liquidStockAfter: `${runningUnopenedVials} unopened + ${formatCentiml(movement.openVialCentimlAfter)} ml open`,
    };
  });

  const changeEntries = events.map<ItemHistoryEntry>((event) => ({
    id: `event-${event.id}`,
    category: event.eventType === 'item.cost_changed' ? 'cost' : 'information',
    action:
      event.eventType === 'item.archived'
        ? 'Item Archived'
        : event.eventType === 'item.created'
        ? 'Item Created'
        : event.eventType === 'item.cost_changed'
          ? 'Unit Cost Changed'
          : fieldLabel(event.fieldName),
    createdAtMs: event.createdAt.getTime(),
    accountRole:
      event.actorRole ??
      (event.actorAccountId != null ? accountRoles.get(event.actorAccountId) ?? null : null),
    quantityBefore: null,
    quantityDelta: null,
    quantityAfter: null,
    fieldName: event.fieldName,
    oldValue: event.oldValue,
    newValue: event.newValue,
    operationCode: null,
    inventoryCountCode: null,
    reason: null,
    liquidStockBefore: null,
    liquidVolumeDeltaMl: null,
    liquidStockAfter: null,
  }));

  return [...movementEntries, ...liquidMovementEntries, ...changeEntries]
    .filter((entry) => filter === 'all' || entry.category === filter)
    .sort((left, right) => right.createdAtMs - left.createdAtMs || right.id.localeCompare(left.id));
}
