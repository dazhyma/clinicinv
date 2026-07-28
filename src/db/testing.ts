/**
 * Соединение в памяти с уже применёнными миграциями — для тестов.
 *
 * Вынесено из client.ts намеренно: раннер миграций читает каталог с диска,
 * и в бандле приложения ему делать нечего.
 */
import { createConnection, type Connection } from './client';
import { runMigrations } from './migrate';

export function createInMemoryConnection(): Connection {
  const connection = createConnection(':memory:');
  runMigrations(connection.sqlite);
  return connection;
}
