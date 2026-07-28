/**
 * Минимальный раннер миграций: применяет `drizzle/*.sql` по возрастанию имени,
 * каждый файл — в отдельной транзакции, с отметкой в `schema_migrations`.
 *
 * Миграции написаны вручную на SQL, а не сгенерированы, потому что схеме нужны
 * CHECK-констрейнты и индекс по выражению COALESCE(source_pack_id, 0),
 * которые в декларативном описании Drizzle не выражаются.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';

/**
 * Каталог миграций разрешается от рабочего каталога, а не через
 * `new URL(..., import.meta.url)`: последний webpack пытается разрешить как
 * модуль на этапе сборки Next и падает. Миграции запускают только CLI-скрипты
 * и тесты, и те и другие исполняются из корня проекта.
 */
export const MIGRATIONS_DIR = path.resolve(process.cwd(), 'drizzle');

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export function runMigrations(
  sqlite: BetterSqlite3.Database,
  dir: string = MIGRATIONS_DIR,
): MigrationResult {
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name       TEXT PRIMARY KEY,
       applied_at INTEGER NOT NULL
     )`,
  );

  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const alreadyApplied = new Set(
    (sqlite.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map(
      (row) => row.name,
    ),
  );

  const result: MigrationResult = { applied: [], skipped: [] };
  const insert = sqlite.prepare(
    'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)',
  );

  for (const file of files) {
    if (alreadyApplied.has(file)) {
      result.skipped.push(file);
      continue;
    }
    const sql = readFileSync(path.join(dir, file), 'utf8');
    const apply = sqlite.transaction(() => {
      sqlite.exec(sql);
      insert.run(file, Date.now());
    });
    apply();
    result.applied.push(file);
  }

  return result;
}
