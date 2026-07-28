/**
 * Паки — цифровые наборы (§6).
 *
 * Пак НЕ является физическим складским объектом (§6.5, §18.10): у него нет
 * собственного количества и нет хранимой стоимости. Стоимость всегда считается
 * от текущих цен предметов в момент отображения (§6.4).
 *
 * Изменение состава пака не порождает движений остатков и не трогает уже
 * существующие строки операций (§6.7, §18.17). Состав читается только в момент
 * сканирования.
 */
import { and, eq, like, or, sql, type SQL } from 'drizzle-orm';
import type { AppDatabase, DbLike } from '@/db/client';
import {
  barcodeRegistry,
  items,
  operationEvents,
  operationItems,
  packItems,
  packs,
  type EntityStatus,
  type ItemRow,
  type PackRow,
} from '@/db/schema';
import { assertAdmin, type Actor } from './actor';
import { AUDIT_ACTIONS, writeAudit } from './audit';
import { nextInternalCode, normalizeScannedCode, PACK_CODE_PREFIX } from './codes';
import { errors } from './errors';
import { assertPositiveQuantity } from './quantity';
import { runInTransaction } from './movements';

export interface PackComponentInput {
  itemId: number;
  quantity: number;
}

export interface CreatePackInput {
  name: string;
  composition: PackComponentInput[];
  photoUrl?: string | null;
  notes?: string | null;
  status?: EntityStatus;
}

function validateComposition(composition: PackComponentInput[]): PackComponentInput[] {
  if (!composition.length) throw errors.validationFailed('A pack must contain at least one item');
  const seen = new Set<number>();
  for (const component of composition) {
    assertPositiveQuantity(component.quantity, 'Pack item quantity');
    if (seen.has(component.itemId)) {
      // ux_pack_items_pack_item поймал бы это и на уровне БД, но сообщение
      // должно быть конкретным (§14.4).
      throw errors.validationFailed('The same item is listed twice in this pack');
    }
    seen.add(component.itemId);
  }
  return composition;
}

export function createPack(db: AppDatabase, actor: Actor, input: CreatePackInput): PackRow {
  assertAdmin(actor, 'create pack');

  const name = input.name?.trim();
  if (!name) throw errors.validationFailed('Pack name is required');
  const composition = validateComposition(input.composition);

  return runInTransaction(db, (tx) => {
    const internalCode = nextInternalCode(tx, PACK_CODE_PREFIX);
    const barcodeValue = internalCode;
    const now = new Date();

    const created = tx
      .insert(packs)
      .values({
        internalCode,
        barcodeValue,
        name,
        photoUrl: input.photoUrl ?? null,
        notes: input.notes?.trim() || null,
        status: input.status ?? 'active',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    tx.insert(barcodeRegistry)
      .values({ barcodeValue, ownerType: 'pack', ownerId: created.id, createdAt: now })
      .run();

    for (const component of composition) {
      const item = tx.select().from(items).where(eq(items.id, component.itemId)).get();
      if (!item) throw errors.itemNotFound(component.itemId);
      if (item.status !== 'active' || item.archivedAt) throw errors.itemInactive(item.name);
      tx.insert(packItems)
        .values({ packId: created.id, itemId: component.itemId, quantity: component.quantity })
        .run();
    }

    writeAudit(tx, {
      action: AUDIT_ACTIONS.packCreated,
      actorAccountId: actor.accountId,
      actorRole: actor.role,
      entityType: 'pack',
      entityId: created.id,
      summary: `${internalCode} "${name}", ${composition.length} item(s)`,
    });

    return created;
  });
}

export interface UpdatePackPatch {
  name?: string;
  photoUrl?: string | null;
  notes?: string | null;
  status?: EntityStatus;
  /** Полная замена состава. Движений остатков не порождает (§6.7). */
  composition?: PackComponentInput[];
}

const IMMUTABLE_PACK_FIELDS = ['internalCode', 'barcodeValue', 'internal_code', 'barcode_value'];

export function updatePack(
  db: AppDatabase,
  actor: Actor,
  packId: number,
  patch: UpdatePackPatch,
): PackRow {
  assertAdmin(actor, 'edit pack');

  for (const field of IMMUTABLE_PACK_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) throw errors.immutableField(field);
  }
  if (patch.name !== undefined && !patch.name.trim()) {
    throw errors.validationFailed('Pack name is required');
  }
  const composition = patch.composition ? validateComposition(patch.composition) : undefined;

  return runInTransaction(db, (tx) => {
    const existing = tx.select().from(packs).where(eq(packs.id, packId)).get();
    if (!existing) throw errors.packNotFound(packId);
    if (existing.archivedAt) {
      throw errors.validationFailed(`${existing.name} is archived and cannot be edited`);
    }

    const updated = tx
      .update(packs)
      .set({
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.photoUrl !== undefined ? { photoUrl: patch.photoUrl } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes?.trim() || null } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        updatedAt: new Date(),
      })
      .where(eq(packs.id, packId))
      .returning()
      .get();

    if (composition) {
      // Полная замена состава. Ни одна строка operation_items не трогается —
      // завершённые и активные операции сохраняют свой состав (§6.7, §18.17).
      tx.delete(packItems).where(eq(packItems.packId, packId)).run();
      for (const component of composition) {
        const item = tx.select().from(items).where(eq(items.id, component.itemId)).get();
        if (!item) throw errors.itemNotFound(component.itemId);
        if (item.status !== 'active' || item.archivedAt) throw errors.itemInactive(item.name);
        tx.insert(packItems)
          .values({ packId, itemId: component.itemId, quantity: component.quantity })
          .run();
      }
    }

    writeAudit(tx, {
      action: AUDIT_ACTIONS.packUpdated,
      actorAccountId: actor.accountId,
      actorRole: actor.role,
      entityType: 'pack',
      entityId: packId,
      summary: `${existing.internalCode}: ${Object.keys(patch).join(', ') || 'no changes'}`,
    });

    return updated;
  });
}

export interface DeletePackResult {
  disposition: 'deleted' | 'archived';
  pack: PackRow;
  photoUrl: string | null;
}

/** Used packs keep their historical identity; unused packs are removed fully. */
export function deletePack(
  db: AppDatabase,
  actor: Actor,
  packId: number,
): DeletePackResult {
  assertAdmin(actor, 'delete pack');

  return runInTransaction(db, (tx) => {
    const pack = getPack(tx, packId);
    if (!pack) throw errors.packNotFound(packId);
    if (pack.archivedAt) {
      throw errors.validationFailed(`${pack.name} has already been archived`);
    }

    const usedByLine = Boolean(
      tx
        .select({ id: operationItems.id })
        .from(operationItems)
        .where(eq(operationItems.sourcePackId, packId))
        .limit(1)
        .get(),
    );
    const usedByEvent = Boolean(
      tx
        .select({ id: operationEvents.id })
        .from(operationEvents)
        .where(
          and(
            eq(operationEvents.eventType, 'pack_added'),
            sql`json_extract(${operationEvents.payloadJson}, '$.packId') = ${packId}`,
          ),
        )
        .limit(1)
        .get(),
    );
    const used = usedByLine || usedByEvent;

    if (!used) {
      tx.delete(packItems).where(eq(packItems.packId, packId)).run();
      tx.delete(barcodeRegistry)
        .where(and(eq(barcodeRegistry.ownerType, 'pack'), eq(barcodeRegistry.ownerId, packId)))
        .run();
      tx.delete(packs).where(eq(packs.id, packId)).run();
      writeAudit(tx, {
        action: AUDIT_ACTIONS.packDeleted,
        actorAccountId: actor.accountId,
        actorRole: actor.role,
        entityType: 'pack',
        entityId: packId,
        summary: `${pack.internalCode} "${pack.name}" permanently deleted`,
      });
      return { disposition: 'deleted', pack, photoUrl: pack.photoUrl };
    }

    const archived = tx
      .update(packs)
      .set({
        status: 'inactive',
        archivedAt: new Date(),
        archivedByAccountId: actor.accountId,
        updatedAt: new Date(),
      })
      .where(eq(packs.id, packId))
      .returning()
      .get();
    writeAudit(tx, {
      action: AUDIT_ACTIONS.packArchived,
      actorAccountId: actor.accountId,
      actorRole: actor.role,
      entityType: 'pack',
      entityId: packId,
      summary: `${pack.internalCode} "${pack.name}" archived`,
    });
    return { disposition: 'archived', pack: archived, photoUrl: pack.photoUrl };
  });
}

export interface PackComponent {
  item: ItemRow;
  quantity: number;
}

export function getPack(tx: DbLike, packId: number): PackRow | undefined {
  return tx.select().from(packs).where(eq(packs.id, packId)).get();
}

export function findPackByBarcode(tx: DbLike, barcode: string): PackRow | undefined {
  return tx.select().from(packs).where(eq(packs.barcodeValue, normalizeScannedCode(barcode))).get();
}

export function getPackComposition(tx: DbLike, packId: number): PackComponent[] {
  return tx
    .select({ item: items, quantity: packItems.quantity })
    .from(packItems)
    .innerJoin(items, eq(items.id, packItems.itemId))
    .where(eq(packItems.packId, packId))
    .orderBy(packItems.id)
    .all();
}

/**
 * §6.4: текущая стоимость пака = Σ(текущая стоимость предмета × количество).
 * Значение вычисляется, а не хранится: хранимое рассинхронизировалось бы при
 * изменении цены предмета. На завершённые операции не влияет никак.
 */
export function packCurrentCostCents(tx: DbLike, packId: number): number {
  return getPackComposition(tx, packId).reduce(
    (total, component) => total + component.item.currentUnitCostCents * component.quantity,
    0,
  );
}

export function listPacks(
  tx: DbLike,
  options: { includeInactive?: boolean; query?: string | null } = {},
): PackRow[] {
  const conditions: SQL[] = [];
  if (!options.includeInactive) conditions.push(eq(packs.status, 'active'));
  const term = options.query?.trim();
  if (term) {
    const pattern = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    const match = or(
      like(packs.name, pattern),
      like(packs.internalCode, pattern),
      like(packs.barcodeValue, pattern),
    );
    if (match) conditions.push(match);
  }
  const query = tx.select().from(packs);
  return conditions.length ? query.where(and(...conditions)).all() : query.all();
}
