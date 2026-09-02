import { asc, eq } from 'drizzle-orm';
import type { AppDatabase, DbLike } from '@/db/client';
import { surgeryTypes, type SurgeryTypeRow } from '@/db/schema';
import { assertAdmin, assertAuthenticated, type Actor } from './actor';
import { AUDIT_ACTIONS, writeAudit } from './audit';
import { errors } from './errors';
import { runInTransaction } from './movements';

export function cleanSurgeryTypeName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

export function normalizeSurgeryTypeName(value: string): string {
  return cleanSurgeryTypeName(value).toLocaleLowerCase('en-US');
}

/**
 * Свободный Surgery Type сохраняется как снимок операции, а нормализованное
 * значение служит только для переиспользования подсказки без дублей.
 */
export function resolveSurgeryTypeSuggestion(
  tx: DbLike,
  actor: Actor,
  rawName: string | null | undefined,
): { id: number | null; snapshot: string | null } {
  assertAuthenticated(actor);
  const snapshot = cleanSurgeryTypeName(rawName ?? '');
  if (!snapshot) return { id: null, snapshot: null };
  const normalizedName = normalizeSurgeryTypeName(snapshot);
  const existing = tx.select().from(surgeryTypes)
    .where(eq(surgeryTypes.normalizedName, normalizedName)).get();
  if (existing) return { id: existing.id, snapshot };

  const now = new Date();
  const created = tx.insert(surgeryTypes).values({
    name: snapshot,
    normalizedName,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    createdByAccountId: actor.accountId,
    updatedByAccountId: actor.accountId,
  }).returning().get();
  writeAudit(tx, {
    action: AUDIT_ACTIONS.surgeryTypeCreated,
    actorAccountId: actor.accountId,
    actorRole: actor.role,
    entityType: 'surgery_type',
    entityId: created.id,
    summary: snapshot,
  });
  return { id: created.id, snapshot };
}

export function listSurgeryTypes(
  tx: DbLike,
  actor: Actor,
  includeInactive = false,
): SurgeryTypeRow[] {
  assertAuthenticated(actor);
  const query = tx.select().from(surgeryTypes);
  return (includeInactive
    ? query
    : query.where(eq(surgeryTypes.status, 'active')))
    .orderBy(asc(surgeryTypes.name)).all();
}

export function createSurgeryType(db: AppDatabase, actor: Actor, rawName: string): SurgeryTypeRow {
  assertAdmin(actor, 'create surgery type');
  const name = cleanSurgeryTypeName(rawName);
  if (!name) throw errors.validationFailed('Surgery Type name is required');
  return runInTransaction(db, (tx) => {
    const normalizedName = normalizeSurgeryTypeName(name);
    if (tx.select({ id: surgeryTypes.id }).from(surgeryTypes)
      .where(eq(surgeryTypes.normalizedName, normalizedName)).get()) {
      throw errors.validationFailed('A Surgery Type with this name already exists');
    }
    const now = new Date();
    const created = tx.insert(surgeryTypes).values({
      name, normalizedName, status: 'active', createdAt: now, updatedAt: now,
      createdByAccountId: actor.accountId, updatedByAccountId: actor.accountId,
    }).returning().get();
    writeAudit(tx, {
      action: AUDIT_ACTIONS.surgeryTypeCreated,
      actorAccountId: actor.accountId,
      actorRole: actor.role,
      entityType: 'surgery_type',
      entityId: created.id,
      summary: name,
    });
    return created;
  });
}

export function updateSurgeryType(
  db: AppDatabase,
  actor: Actor,
  id: number,
  input: { name?: string; status?: 'active' | 'inactive' },
): SurgeryTypeRow {
  assertAdmin(actor, 'manage surgery types');
  return runInTransaction(db, (tx) => {
    const existing = tx.select().from(surgeryTypes).where(eq(surgeryTypes.id, id)).get();
    if (!existing) throw errors.validationFailed('Surgery Type not found');
    const name = input.name == null
      ? existing.name
      : cleanSurgeryTypeName(input.name);
    if (!name) throw errors.validationFailed('Surgery Type name is required');
    const normalizedName = normalizeSurgeryTypeName(name);
    const duplicate = tx.select({ id: surgeryTypes.id }).from(surgeryTypes)
      .where(eq(surgeryTypes.normalizedName, normalizedName)).get();
    if (duplicate && duplicate.id !== id) throw errors.validationFailed('A Surgery Type with this name already exists');
    const status = input.status ?? existing.status;
    const updated = tx.update(surgeryTypes).set({
      name, normalizedName, status, updatedAt: new Date(), updatedByAccountId: actor.accountId,
    }).where(eq(surgeryTypes.id, id)).returning().get();
    writeAudit(tx, {
      action: status === 'inactive' && existing.status !== 'inactive'
        ? AUDIT_ACTIONS.surgeryTypeDeactivated
        : AUDIT_ACTIONS.surgeryTypeUpdated,
      actorAccountId: actor.accountId,
      actorRole: actor.role,
      entityType: 'surgery_type',
      entityId: id,
      summary: `${existing.name} -> ${name} (${status})`,
    });
    return updated;
  });
}
