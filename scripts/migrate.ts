/**
 * npm run db:migrate — применяет миграции из drizzle/*.sql.
 */
import { createConnection } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { env, loadDotEnv } from '../src/env';

loadDotEnv();

const { sqlite } = createConnection(env.databaseFile);
const result = runMigrations(sqlite);

console.log(`Database: ${env.databaseFile}`);
console.log(`Journal mode: ${String(sqlite.pragma('journal_mode', { simple: true }))}`);
if (result.applied.length) {
  console.log(`Applied: ${result.applied.join(', ')}`);
} else {
  console.log('Applied: nothing new');
}
if (result.skipped.length) {
  console.log(`Already applied: ${result.skipped.join(', ')}`);
}

sqlite.close();
