import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each test file opens its own in-memory/temporary SQLite database.
    // Threads are fine, but a single fork keeps native better-sqlite3 predictable.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
