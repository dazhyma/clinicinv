/**
 * Фотографии предметов (§13, §15, NFR-17).
 *
 * Проверяется главное: тип файла определяется по содержимому, размер ограничен,
 * большие изображения уменьшаются, а файлы не попадают в публичную статику.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isDomainError } from '@/domain/errors';
import {
  deletePhotoByUrl,
  isValidPhotoToken,
  photoFilePath,
  photoTokenFromUrl,
  storeItemPhoto,
  thumbnailUrl,
} from '@/photos/storage';

let uploadsDir: string;
const previousUploadsDir = process.env.UPLOADS_DIR;

beforeAll(() => {
  uploadsDir = mkdtempSync(path.join(tmpdir(), 'clinic-photos-'));
  process.env.UPLOADS_DIR = uploadsDir;
  process.env.PHOTO_MAX_MB = '10';
  process.env.PHOTO_MAX_EDGE_PX = '1024';
});

afterAll(() => {
  rmSync(uploadsDir, { recursive: true, force: true });
  if (previousUploadsDir === undefined) delete process.env.UPLOADS_DIR;
  else process.env.UPLOADS_DIR = previousUploadsDir;
});

async function pngFile(width: number, height: number, name = 'photo.png'): Promise<File> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } },
  })
    .png()
    .toBuffer();
  return new File([new Uint8Array(buffer)], name, { type: 'image/png' });
}

describe('Загрузка фотографии (§13)', () => {
  it('принимает PNG и сохраняет полный размер и миниатюру вне public/', async () => {
    const photoUrl = await storeItemPhoto(await pngFile(400, 300));

    expect(photoUrl).toMatch(/^\/api\/photos\/[0-9a-f]{32}$/);

    const token = photoTokenFromUrl(photoUrl)!;
    expect(isValidPhotoToken(token)).toBe(true);

    const full = photoFilePath(token, 'full')!;
    const thumb = photoFilePath(token, 'thumb')!;
    expect(existsSync(full)).toBe(true);
    expect(existsSync(thumb)).toBe(true);

    // §15/NFR-17: файлы лежат в каталоге загрузок, а не в публичной статике.
    expect(full.startsWith(uploadsDir)).toBe(true);
    expect(full).not.toContain(`${path.sep}public${path.sep}`);

    expect(thumbnailUrl(photoUrl)).toBe(`${photoUrl}?variant=thumb`);
  });

  it('уменьшает слишком большое изображение', async () => {
    const photoUrl = await storeItemPhoto(await pngFile(3000, 2000));
    const token = photoTokenFromUrl(photoUrl)!;

    const full = await sharp(readFileSync(photoFilePath(token, 'full')!)).metadata();
    const thumb = await sharp(readFileSync(photoFilePath(token, 'thumb')!)).metadata();

    expect(full.width).toBe(1024);
    expect(Math.max(full.width ?? 0, full.height ?? 0)).toBeLessThanOrEqual(1024);
    expect(Math.max(thumb.width ?? 0, thumb.height ?? 0)).toBeLessThanOrEqual(256);
  });

  it('маленькое изображение не растягивается', async () => {
    const photoUrl = await storeItemPhoto(await pngFile(120, 90));
    const token = photoTokenFromUrl(photoUrl)!;
    const full = await sharp(readFileSync(photoFilePath(token, 'full')!)).metadata();
    expect(full.width).toBe(120);
  });

  it('отвергает файл, который лишь притворяется картинкой', async () => {
    // Расширение и MIME-тип подделаны — проверяется фактическое содержимое.
    const fake = new File([new TextEncoder().encode('not really an image')], 'evil.png', {
      type: 'image/png',
    });

    await expect(storeItemPhoto(fake)).rejects.toSatisfy(
      (error: unknown) =>
        isDomainError(error) && /JPG, PNG, or WebP/.test(error.message),
    );
  });

  it('отвергает файл больше лимита', async () => {
    process.env.PHOTO_MAX_MB = '1';
    try {
      const big = new File([new Uint8Array(2 * 1024 * 1024)], 'big.png', { type: 'image/png' });
      await expect(storeItemPhoto(big)).rejects.toSatisfy(
        (error: unknown) => isDomainError(error) && /smaller than 1 MB/.test(error.message),
      );
    } finally {
      process.env.PHOTO_MAX_MB = '10';
    }
  });

  it('отвергает пустой файл', async () => {
    const empty = new File([], 'empty.png', { type: 'image/png' });
    await expect(storeItemPhoto(empty)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && /empty/.test(error.message),
    );
  });

  it('удаление убирает оба варианта файла', async () => {
    const photoUrl = await storeItemPhoto(await pngFile(200, 200));
    const token = photoTokenFromUrl(photoUrl)!;

    await deletePhotoByUrl(photoUrl);

    expect(existsSync(photoFilePath(token, 'full')!)).toBe(false);
    expect(existsSync(photoFilePath(token, 'thumb')!)).toBe(false);
  });
});

describe('Токен фотографии не позволяет выйти за каталог', () => {
  it.each([
    '../../etc/passwd',
    '..',
    'abc',
    '0123456789abcdef0123456789abcdeg',
    '/etc/passwd',
  ])('отклоняет токен %s', (token) => {
    expect(isValidPhotoToken(token)).toBe(false);
    expect(photoFilePath(token, 'full')).toBeNull();
  });

  it('не извлекает токен из чужого URL', () => {
    expect(photoTokenFromUrl('/uploads/secret.webp')).toBeNull();
    expect(photoTokenFromUrl('https://evil.example/api/photos/' + 'a'.repeat(32))).toBeNull();
  });
});
