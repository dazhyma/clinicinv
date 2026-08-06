/**
 * Общая обвязка доменных тестов: чистая база в памяти с применёнными
 * миграциями плюс два аккаунта (§2.3).
 */
import type { AppDatabase } from '@/db/client';
import { createInMemoryConnection } from '@/db/testing';
import { userAccounts } from '@/db/schema';
import type { Actor } from '@/domain/actor';
import { createItem } from '@/domain/items';
import { createPack } from '@/domain/packs';
import { setSetting, SETTING_KEYS } from '@/domain/settings';

export interface TestContext {
  db: AppDatabase;
  sqlite: ReturnType<typeof createInMemoryConnection>['sqlite'];
  admin: Actor;
  staff: Actor;
}

export function setupTestDb(): TestContext {
  const { db, sqlite } = createInMemoryConnection();
  const now = new Date();

  // Пароли здесь не хешируются argon2 намеренно: доменные тесты не проверяют
  // аутентификацию (для неё есть tests/auth.test.ts), а argon2 медленный.
  const adminRow = db
    .insert(userAccounts)
    .values({
      username: 'admin',
      passwordHash: 'not-used-in-domain-tests',
      role: 'Admin',
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  const staffRow = db
    .insert(userAccounts)
    .values({
      username: 'staff',
      passwordHash: 'not-used-in-domain-tests',
      role: 'Staff',
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return {
    db,
    sqlite,
    admin: { accountId: adminRow.id, role: 'Admin' },
    staff: { accountId: staffRow.id, role: 'Staff' },
  };
}

/** Тестовые данные из docs/acceptance-criteria.md. */
export const FIXTURES = {
  gauze: { name: 'Gauze 4x4', costCents: 300, quantity: 10, unit: 'each' },
  gloves: { name: 'Gloves L', costCents: 50, quantity: 50, unit: 'pair' },
  syringe: { name: 'Syringe 10 mL', costCents: 120, quantity: 20, unit: 'each' },
  mask: { name: 'Mask', costCents: 25, quantity: 100, unit: 'each' },
} as const;

export function makeItem(
  ctx: TestContext,
  fixture: { name: string; costCents: number; quantity: number; unit: string },
  overrides: { referenceNumber?: string } = {},
) {
  return createItem(ctx.db, ctx.admin, {
    name: fixture.name,
    currentUnitCostCents: fixture.costCents,
    unitOfMeasurement: fixture.unit,
    initialQuantity: fixture.quantity,
    referenceNumber: overrides.referenceNumber ?? null,
  });
}

export function makeBasicPack(
  ctx: TestContext,
  composition: { itemId: number; quantity: number }[],
  name = 'Basic Pack',
) {
  return createPack(ctx.db, ctx.admin, { name, composition });
}

export function setNegativeStockMode(ctx: TestContext, mode: 'warn' | 'block') {
  setSetting(ctx.db, SETTING_KEYS.negativeStockMode, mode);
}

/** Счётчик clientEventId: в реальной системе их генерирует клиент. */
let eventCounter = 0;
export function nextClientEventId(prefix = 'evt'): string {
  eventCounter += 1;
  return `${prefix}-${eventCounter}`;
}
