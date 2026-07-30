/**
 * Первичная загрузка инвентаря из подготовленного JSON.
 *
 *   npx tsx scripts/import-items.ts <файл.json>
 *
 * Формат файла — массив объектов с полями CreateItemInput (§5.4):
 *   { "sku": "...", "name": "...", "currentUnitCostCents": 151,
 *     "unitOfMeasurement": "each", "initialQuantity": 400, "notes": "..." }
 *
 * Загрузка идёт ТОЛЬКО через доменный `createItem` (§10.4, §18.5):
 * так предмет получает постоянный внутренний код, штрихкод регистрируется в
 * общем реестре, а начальное количество проходит движением `initial` — иначе
 * инвариант current_quantity == SUM(quantity_delta) сломался бы на первом же
 * предмете (противоречие C-13).
 *
 * Повторный запуск безопасен: позиции с уже существующим SKU пропускаются.
 */
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { getDb } from '../src/db/client';
import { items, userAccounts } from '../src/db/schema';
import { createItem, type CreateItemInput } from '../src/domain/items';
import { loadDotEnv } from '../src/env';

loadDotEnv();

const file = process.argv[2];
if (!file) {
  console.error('Укажите путь к JSON-файлу: npx tsx scripts/import-items.ts items.json');
  process.exit(1);
}

const db = getDb();

const admin = db.select().from(userAccounts).where(eq(userAccounts.role, 'Admin')).get();
if (!admin) {
  console.error('Admin-аккаунт не найден. Сначала выполните npm run db:seed.');
  process.exit(1);
}
const actor = { accountId: admin.id, role: 'Admin' as const };

const rows: (CreateItemInput & { sourceRow?: number })[] = JSON.parse(readFileSync(file, 'utf8'));

let created = 0;
let skipped = 0;
const failed: { sku: string; error: string }[] = [];

for (const row of rows) {
  const sku = row.sku?.trim();
  if (sku) {
    const existing = db.select({ id: items.id }).from(items).where(eq(items.sku, sku)).get();
    if (existing) {
      skipped += 1;
      continue;
    }
  }
  try {
    // Лишний ключ sourceRow (номер строки Excel — для диагностики) безвреден:
    // createItem читает поля по именам и в БД пишет только известные ему.
    createItem(db, actor, row);
    created += 1;
  } catch (error) {
    failed.push({ sku: sku ?? row.name, error: error instanceof Error ? error.message : String(error) });
  }
}

console.log(`создано:    ${created}`);
console.log(`пропущено:  ${skipped} (SKU уже есть в базе)`);
if (failed.length) {
  console.log(`ошибок:     ${failed.length}`);
  for (const f of failed.slice(0, 20)) console.log(`   ${f.sku}: ${f.error}`);
}
