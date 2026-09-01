import { eq } from 'drizzle-orm';
import type { DbLike } from '@/db/client';
import { manufacturers, type ManufacturerRow } from '@/db/schema';
import type { Actor } from './actor';

export function normalizeManufacturerName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export function listManufacturers(tx: DbLike): ManufacturerRow[] {
  return tx.select().from(manufacturers).orderBy(manufacturers.name).all();
}

/** Сохраняет первое корректное написание; регистр и лишние пробелы дубликат не создают. */
export function resolveManufacturer(
  tx: DbLike,
  actor: Actor,
  rawName: string | null | undefined,
): ManufacturerRow | null {
  const name = rawName?.normalize('NFKC').trim().replace(/\s+/g, ' ') ?? '';
  if (!name) return null;
  const normalizedName = normalizeManufacturerName(name);
  const existing = tx.select().from(manufacturers)
    .where(eq(manufacturers.normalizedName, normalizedName)).get();
  if (existing) return existing;
  return tx.insert(manufacturers).values({
    name,
    normalizedName,
    createdAt: new Date(),
    createdByAccountId: actor.accountId,
  }).returning().get();
}
