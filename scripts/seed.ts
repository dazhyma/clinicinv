/**
 * npm run db:seed — создаёт два общих аккаунта (§2.3, §18.1).
 *
 * Пароли берутся ТОЛЬКО из переменных окружения (§15). В коде и в репозитории
 * их нет; в БД попадает исключительно argon2id-хеш.
 *
 * Скрипт не перезаписывает существующие аккаунты молча: для смены пароля
 * задайте SEED_FORCE_PASSWORD_RESET=true.
 */
import { eq } from 'drizzle-orm';
import { createConnection } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { userAccounts, type UserRole } from '../src/db/schema';
import { env, loadDotEnv } from '../src/env';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../src/auth/password';

loadDotEnv();

const forceReset = process.env.SEED_FORCE_PASSWORD_RESET === 'true';

async function main() {
  const { sqlite, db } = createConnection(env.databaseFile);
  runMigrations(sqlite);

  const accounts: { username: string; password: string | undefined; role: UserRole }[] = [
    { ...env.seedAccounts.admin, role: 'Admin' },
    { ...env.seedAccounts.staff, role: 'Staff' },
  ];

  for (const account of accounts) {
    const username = account.username.trim().toLowerCase();

    if (!account.password) {
      throw new Error(
        `Password for the ${account.role} account is not set. ` +
          `Add SEED_${account.role.toUpperCase()}_PASSWORD to .env (see .env.example).`,
      );
    }
    if (account.password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(
        `Password for the ${account.role} account is shorter than ${MIN_PASSWORD_LENGTH} characters.`,
      );
    }

    const existing = db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.username, username))
      .get();

    const passwordHash = await hashPassword(account.password);
    const now = new Date();

    if (!existing) {
      db.insert(userAccounts)
        .values({
          username,
          passwordHash,
          role: account.role,
          active: true,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      console.log(`Created ${account.role} account "${username}"`);
    } else if (forceReset) {
      db.update(userAccounts)
        .set({ passwordHash, role: account.role, active: true, updatedAt: now })
        .where(eq(userAccounts.id, existing.id))
        .run();
      console.log(`Reset password for ${account.role} account "${username}"`);
    } else {
      console.log(
        `Account "${username}" already exists — left untouched ` +
          `(set SEED_FORCE_PASSWORD_RESET=true to reset the password)`,
      );
    }
  }

  const total = db.select().from(userAccounts).all().length;
  console.log(`Accounts in database: ${total}`);
  sqlite.close();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
