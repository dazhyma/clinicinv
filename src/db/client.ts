/**
 * Подключение к SQLite и singleton базы для серверного кода приложения.
 *
 * Режим WAL обязателен: он даёт одновременное чтение при записи, что нужно
 * операционному экрану (§14.3 — реакция на скан ≤ 500 мс при параллельно
 * работающих устройствах).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { env } from '@/env';
import * as schema from './schema';

export type AppDatabase = BetterSQLite3Database<typeof schema>;

/** Транзакционный дескриптор Drizzle. Доменные функции принимают его, а не голый db. */
export type Tx = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

/** И база, и транзакция поддерживают одинаковый набор запросов. */
export type DbLike = AppDatabase | Tx;

export function openSqlite(file: string): BetterSqlite3.Database {
  if (file !== ':memory:') {
    mkdirSync(path.dirname(file), { recursive: true });
  }
  const sqlite = new BetterSqlite3(file);
  // WAL не поддерживается для :memory: — pragma просто вернёт 'memory'.
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  // Внешние ключи в SQLite выключены по умолчанию и включаются на соединение.
  sqlite.pragma('foreign_keys = ON');
  // Ждать снятия блокировки вместо мгновенного SQLITE_BUSY: несколько
  // устройств пишут в одну базу во время операции.
  sqlite.pragma('busy_timeout = 5000');
  return sqlite;
}

export interface Connection {
  sqlite: BetterSqlite3.Database;
  db: AppDatabase;
}

export function createConnection(file: string): Connection {
  const sqlite = openSqlite(file);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

// В dev-режиме Next пересобирает модули; без кеша на globalThis каждое
// пересоздание открывало бы новый файловый дескриптор SQLite.
const globalForDb = globalThis as unknown as { __clinicDb?: Connection };

export function getConnection(): Connection {
  if (!globalForDb.__clinicDb) {
    globalForDb.__clinicDb = createConnection(env.databaseFile);
  }
  return globalForDb.__clinicDb;
}

export function getDb(): AppDatabase {
  return getConnection().db;
}
