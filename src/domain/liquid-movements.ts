import { and, eq, sql } from 'drizzle-orm';
import type { DbLike } from '@/db/client';
import {
  items,
  liquidInventoryMovements,
  type ItemRow,
  type MovementType,
} from '@/db/schema';
import { errors } from './errors';
import { liquidTotalCentiml, type LiquidStockState } from './liquid';

export interface ApplyLiquidMovementInput {
  itemId: number;
  movementType: MovementType;
  next: LiquidStockState;
  operationId?: number | null;
  inventoryCountId?: number | null;
  reason?: string | null;
  vialCostAtReceiptCents?: number | null;
  idempotencyKey: string;
  actorAccountId?: number | null;
}

export interface ApplyLiquidMovementResult extends LiquidStockState {
  created: boolean;
  totalVolumeCentiml: number;
}

function validateState(item: ItemRow, state: LiquidStockState): void {
  const perVial = item.liquidVolumePerVialCentiml;
  if (item.trackingMethod !== 'liquid' || !perVial) throw errors.validationFailed('Item is not tracked as liquid volume');
  if (!Number.isSafeInteger(state.unopenedVials) || state.unopenedVials < 0) {
    throw errors.validationFailed('Unopened vials cannot be negative');
  }
  if (!Number.isSafeInteger(state.openVialCentiml) || state.openVialCentiml < 0 || state.openVialCentiml > perVial) {
    throw errors.validationFailed('Open vial amount must be between 0 and the volume per vial');
  }
}

/** Единственный путь изменения liquid stock; standard applyMovement не затрагивается. */
export function applyLiquidMovement(
  tx: DbLike,
  input: ApplyLiquidMovementInput,
): ApplyLiquidMovementResult {
  const existing = tx
    .select({ id: liquidInventoryMovements.id })
    .from(liquidInventoryMovements)
    .where(eq(liquidInventoryMovements.idempotencyKey, input.idempotencyKey))
    .get();
  const item = tx.select().from(items).where(eq(items.id, input.itemId)).get();
  if (!item) throw errors.itemNotFound(input.itemId);
  validateState(item, input.next);
  const perVial = item.liquidVolumePerVialCentiml!;
  if (existing) {
    return {
      unopenedVials: item.liquidUnopenedVials,
      openVialCentiml: item.liquidOpenVialCentiml,
      totalVolumeCentiml: liquidTotalCentiml(item.liquidUnopenedVials, item.liquidOpenVialCentiml, perVial),
      created: false,
    };
  }

  const oldTotal = liquidTotalCentiml(item.liquidUnopenedVials, item.liquidOpenVialCentiml, perVial);
  const newTotal = liquidTotalCentiml(input.next.unopenedVials, input.next.openVialCentiml, perVial);
  tx.insert(liquidInventoryMovements).values({
    itemId: item.id,
    movementType: input.movementType,
    unopenedVialsDelta: input.next.unopenedVials - item.liquidUnopenedVials,
    openVialCentimlDelta: input.next.openVialCentiml - item.liquidOpenVialCentiml,
    openVialCentimlBefore: item.liquidOpenVialCentiml,
    openVialCentimlAfter: input.next.openVialCentiml,
    totalVolumeCentimlDelta: newTotal - oldTotal,
    operationId: input.operationId ?? null,
    inventoryCountId: input.inventoryCountId ?? null,
    reason: input.reason?.trim() || null,
    vialCostAtReceiptCents: input.vialCostAtReceiptCents ?? null,
    idempotencyKey: input.idempotencyKey,
    createdByAccountId: input.actorAccountId ?? null,
    createdAt: new Date(),
  }).run();

  const updated = tx.update(items).set({
    liquidUnopenedVials: input.next.unopenedVials,
    liquidOpenVialCentiml: input.next.openVialCentiml,
    updatedAt: new Date(),
  }).where(and(
    eq(items.id, item.id),
    eq(items.liquidUnopenedVials, item.liquidUnopenedVials),
    eq(items.liquidOpenVialCentiml, item.liquidOpenVialCentiml),
  )).run();
  if (updated.changes !== 1) throw errors.validationFailed('Liquid stock changed concurrently; reload and try again');

  return {
    ...input.next,
    totalVolumeCentiml: newTotal,
    created: true,
  };
}

export function liquidMovementInvariantViolations(tx: DbLike): number[] {
  const rows = tx.select({
    id: items.id,
    unopened: items.liquidUnopenedVials,
    open: items.liquidOpenVialCentiml,
    movementUnopened: sql<number>`coalesce(sum(${liquidInventoryMovements.unopenedVialsDelta}), 0)`,
    movementOpen: sql<number>`coalesce(sum(${liquidInventoryMovements.openVialCentimlDelta}), 0)`,
  }).from(items).leftJoin(liquidInventoryMovements, eq(liquidInventoryMovements.itemId, items.id))
    .where(eq(items.trackingMethod, 'liquid')).groupBy(items.id).all();
  return rows.filter((row) => row.unopened !== row.movementUnopened || row.open !== row.movementOpen)
    .map((row) => row.id);
}
