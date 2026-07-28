/**
 * Серверное хранение фотографий предметов (§13, §15, NFR-17).
 *
 * Файлы НЕ кладутся в `public/`. §15 запрещает публичные URL, отдающие данные
 * системы без входа, а фотография предмета — такие данные. Каталог задаётся
 * переменной `UPLOADS_DIR` (по умолчанию `./data/uploads`, вне статики), а
 * отдаёт файлы единственный route handler `/api/photos/[token]`, который на
 * каждом запросе проверяет сессию.
 *
 * Тип файла проверяется по ФАКТИЧЕСКОМУ содержимому (sharp разбирает заголовок
 * изображения), а не по расширению и не по заголовку `Content-Type` из формы:
 * и то и другое подделывается тривиально.
 *
 * Q-40: максимальная сторона хранимого изображения — 1024 px, отдельно
 * хранится миниатюра 256 px для списка (§13: фотографии не должны замедлять
 * работу операционного экрана).
 *
 * Константы и разбор URL вынесены в `shared.ts`: их импортируют клиентские
 * компоненты, куда `sharp` и `node:fs` попасть не должны.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { env } from '@/env';
import { errors } from '@/domain/errors';
import {
  ACCEPTED_PHOTO_FORMATS,
  PHOTO_VARIANTS,
  isValidPhotoToken,
  photoTokenFromUrl,
  photoUrlForToken,
  type PhotoVariant,
} from './shared';

export * from './shared';

const THUMB_EDGE_PX = 256;

/** Абсолютный путь к файлу варианта. Возвращает null для некорректного токена. */
export function photoFilePath(token: string, variant: PhotoVariant): string | null {
  if (!isValidPhotoToken(token)) return null;
  const suffix = variant === 'thumb' ? '.thumb.webp' : '.webp';
  // Токен уже провалидирован как [0-9a-f]{32}, выход за каталог невозможен.
  return path.join(env.uploadsDir, `${token}${suffix}`);
}

/**
 * Проверяет, уменьшает и сохраняет фотографию. Возвращает URL для `photo_url`.
 *
 * Ошибки — доменные и конкретные (§14.4): пользователь должен понять, что
 * именно не так с файлом, а не увидеть «Something went wrong».
 */
export async function storeItemPhoto(file: File): Promise<string> {
  if (file.size === 0) {
    throw errors.validationFailed('The selected photo file is empty', { field: 'photo' });
  }
  if (file.size > env.photoMaxBytes) {
    const limitMb = Math.round(env.photoMaxBytes / (1024 * 1024));
    throw errors.validationFailed(`Photo must be smaller than ${limitMb} MB`, { field: 'photo' });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let format: string | undefined;
  try {
    format = (await sharp(buffer).metadata()).format;
  } catch {
    // sharp не смог разобрать заголовок — это не изображение, чем бы ни было
    // расширение и заявленный MIME-тип.
    format = undefined;
  }

  const accepted = ACCEPTED_PHOTO_FORMATS as readonly string[];
  if (!format || !accepted.includes(format)) {
    throw errors.validationFailed('Photo must be a JPG, PNG, or WebP image', { field: 'photo' });
  }

  const token = randomUUID().replace(/-/g, '');
  mkdirSync(env.uploadsDir, { recursive: true });

  // rotate() без аргументов применяет EXIF-ориентацию: снятое телефоном фото
  // иначе легло бы в карточку боком.
  const pipeline = () => sharp(buffer).rotate();

  const full = await pipeline()
    .resize({
      width: env.photoMaxEdgePx,
      height: env.photoMaxEdgePx,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toBuffer();

  const thumb = await pipeline()
    .resize({
      width: THUMB_EDGE_PX,
      height: THUMB_EDGE_PX,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 75 })
    .toBuffer();

  await writeFile(photoFilePath(token, 'full')!, full);
  await writeFile(photoFilePath(token, 'thumb')!, thumb);

  return photoUrlForToken(token);
}

/**
 * Удаление файлов заменённой фотографии. Ошибки намеренно проглатываются:
 * осиротевший файл — мусор на диске, а не потеря учётных данных, и он не должен
 * ронять сохранение карточки предмета.
 */
export async function deletePhotoByUrl(photoUrl: string | null | undefined): Promise<void> {
  const token = photoTokenFromUrl(photoUrl);
  if (!token) return;
  for (const variant of PHOTO_VARIANTS) {
    const file = photoFilePath(token, variant);
    if (file) await rm(file, { force: true }).catch(() => undefined);
  }
}
