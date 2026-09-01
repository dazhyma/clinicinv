import { describe, expect, it } from 'vitest';
import { itemsReturnPath } from '@/app/inventory/_components/items-return-path';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BASE_PATH, withBasePath } from '@/base-path';
import { sessionCookieOptions } from '@/auth/session';

/**
 * Развёртывание под префиксом `/clinic` (D-51).
 *
 * Тест держит три свойства, которые ломаются молча: конфигурация сборки
 * читает ту же константу, что и код; cookie сессии не разливается по чужим
 * приложениям домена; ручная подстановка префикса не удваивается.
 */
describe('basePath развёртывания', () => {
  it('next.config.ts берёт basePath из общей константы, а не из своего литерала', () => {
    const config = readFileSync(path.resolve(process.cwd(), 'next.config.ts'), 'utf8');
    expect(config).toContain("import { BASE_PATH } from './src/base-path'");
    expect(config).toContain('basePath: BASE_PATH');
    // Литерала пути в конфиге быть не должно: два источника истины разойдутся.
    expect(config).not.toContain(`basePath: '${BASE_PATH}'`);
  });

  it('cookie сессии ограничена префиксом и не уходит соседним приложениям домена', () => {
    const options = sessionCookieOptions(new Date(Date.now() + 60_000));
    expect(options.path).toBe(BASE_PATH);
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
  });

  it('withBasePath добавляет префикс один раз', () => {
    expect(withBasePath('/api/barcode/abc')).toBe(`${BASE_PATH}/api/barcode/abc`);
    // Повторное применение — типичная ошибка при правке разметки.
    expect(withBasePath(withBasePath('/api/barcode/abc'))).toBe(`${BASE_PATH}/api/barcode/abc`);
    expect(withBasePath(BASE_PATH)).toBe(BASE_PATH);
  });

  it('withBasePath не трогает абсолютные и относительные URL', () => {
    expect(withBasePath('https://example.test/x')).toBe('https://example.test/x');
    expect(withBasePath('?variant=thumb')).toBe('?variant=thumb');
  });

});

describe('Items return path', () => {
  it('сохраняет только безопасный URL списка с поиском и фильтрами', () => {
    expect(itemsReturnPath('/inventory/catalog?q=gauze&lowStock=1')).toBe(
      '/inventory/catalog?q=gauze&lowStock=1',
    );
    expect(itemsReturnPath('https://evil.example/inventory/catalog')).toBe('/inventory/catalog');
    expect(itemsReturnPath('/operations')).toBe('/inventory/catalog');
  });
});
