/**
 * npm run db:backup — резервная копия базы данных (§15, §19, NFR-16).
 *
 * Копия делается штатным механизмом SQLite `VACUUM INTO`, а НЕ копированием
 * файла. Причина не в удобстве: база работает в режиме WAL (см. `db/client.ts`),
 * поэтому в момент копирования часть подтверждённых транзакций лежит в файле
 * `-wal`, а не в `.db`. Обычный `cp clinic.db backup.db` во время работы
 * клиники даёт копию без последних операций либо вовсе повреждённую — и узнать
 * об этом можно будет только при восстановлении. `VACUUM INTO` выполняется
 * внутри транзакции чтения и записывает целостный, уже дефрагментированный файл.
 *
 * Копия сразу проверяется `PRAGMA integrity_check` и пересчётом ключевых таблиц:
 * непроверенный бэкап — это надежда, а не резервная копия.
 *
 * Расписание здесь НЕ настраивается: периодичность, глубина хранения и место
 * хранения копий — решение по инфраструктуре клиники, оно не утверждено
 * (см. docs/open-questions.md). Скрипт рассчитан на вызов извне (cron,
 * launchd, systemd timer) и на ручной запуск перед обновлением системы.
 *
 * Использование:
 *   npm run db:backup                    → ./data/backups/clinic-<timestamp>.db
 *   npm run db:backup -- /path/to/file.db
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createConnection, openSqlite } from '../src/db/client';
import { env, loadDotEnv } from '../src/env';
import { inventoryMovements, items, operations } from '../src/db/schema';
import { sql } from 'drizzle-orm';

loadDotEnv();

function timestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

const requested = process.argv[2];
const backupDir = path.resolve(process.cwd(), process.env.BACKUP_DIR ?? './data/backups');
const target = requested
  ? path.resolve(process.cwd(), requested)
  : path.join(backupDir, `clinic-${timestamp(new Date())}.db`);

if (!existsSync(env.databaseFile)) {
  console.error(`Database file not found: ${env.databaseFile}`);
  console.error('Check DATABASE_FILE in .env, or run `npm run db:migrate` first.');
  process.exit(1);
}

// VACUUM INTO намеренно отказывается писать в существующий файл: затереть
// вчерашнюю копию — худшее, что может сделать резервное копирование. Сообщение
// об этом должно быть внятным, а не трассировкой стека SQLite (§14.4).
if (existsSync(target)) {
  console.error(`Backup file already exists: ${target}`);
  console.error('Existing backups are never overwritten. Choose another name or remove it first.');
  process.exit(1);
}

mkdirSync(path.dirname(target), { recursive: true });

const source = openSqlite(env.databaseFile);
try {
  source.prepare('VACUUM INTO ?').run(target);
} catch (error) {
  console.error(`Backup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
} finally {
  source.close();
}

// --- Проверка копии ---------------------------------------------------------

const { sqlite: backup, db } = createConnection(target);

const integrity = String(backup.pragma('integrity_check', { simple: true }));
if (integrity !== 'ok') {
  backup.close();
  console.error(`Backup failed integrity check: ${integrity}`);
  console.error(`Broken file left for inspection: ${target}`);
  process.exit(1);
}

const counts = {
  items: db.select({ n: sql<number>`count(*)` }).from(items).get()?.n ?? 0,
  operations: db.select({ n: sql<number>`count(*)` }).from(operations).get()?.n ?? 0,
  movements: db.select({ n: sql<number>`count(*)` }).from(inventoryMovements).get()?.n ?? 0,
};

backup.close();

const sizeMb = (statSync(target).size / (1024 * 1024)).toFixed(2);

console.log(`Source:    ${env.databaseFile}`);
console.log(`Backup:    ${target}`);
console.log(`Size:      ${sizeMb} MB`);
console.log(`Integrity: ${integrity}`);
console.log(
  `Contents:  ${counts.items} items, ${counts.operations} operations, ${counts.movements} movements`,
);
console.log('Restore:   see README, section "Резервное копирование и восстановление".');
