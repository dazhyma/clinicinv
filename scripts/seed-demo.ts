/**
 * Демонстрационные данные для тестового стенда: врачи и несколько предметов.
 *
 * Скрипт НЕ для production: он наполняет базу, указанную в DATABASE_FILE, и
 * рассчитан на пустой стенд. Повторный запуск завершится ошибкой уникальности
 * кода врача — это намеренно, чтобы случайный запуск по рабочей базе не
 * прошёл незаметно.
 *
 *   DATABASE_FILE=./data/test-stand/clinic.db npx tsx scripts/seed-demo.ts
 */
import { eq } from 'drizzle-orm';
import { createConnection } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { userAccounts } from '../src/db/schema';
import { createDoctor } from '../src/domain/doctors';
import { createItem } from '../src/domain/items';
import { env, loadDotEnv } from '../src/env';

loadDotEnv();

const { sqlite, db } = createConnection(env.databaseFile);
runMigrations(sqlite);

const adminRow = db.select().from(userAccounts).where(eq(userAccounts.role, 'Admin')).get();
if (!adminRow) throw new Error('Admin account not found — run npm run db:seed first');
const admin = { accountId: adminRow.id, role: 'Admin' as const };

console.log(`Database: ${env.databaseFile}`);

// Chapman задан вручную: по фамилии он тоже получил бы CH и столкнулся с Chen.
for (const doctor of [{ lastName: 'Chen' }, { lastName: 'Wong' }, { lastName: 'Chapman', code: 'CP' }]) {
  const created = createDoctor(db, admin, doctor);
  console.log(`Doctor ${created.lastName} — code ${created.code}`);
}

for (const item of [
  { name: 'Gauze 4x4', currentUnitCostCents: 300, unitOfMeasurement: 'each', initialQuantity: 40 },
  { name: 'Gloves L', currentUnitCostCents: 50, unitOfMeasurement: 'pair', initialQuantity: 120 },
  { name: 'Syringe 10 mL', currentUnitCostCents: 120, unitOfMeasurement: 'each', initialQuantity: 60 },
]) {
  const created = createItem(db, admin, { ...item, referenceNumber: null });
  console.log(`Item ${created.name} — ${created.internalCode}`);
}

sqlite.close();
