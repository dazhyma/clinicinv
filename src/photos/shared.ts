/**
 * Часть фото-модуля, безопасная для клиентского бандла (§13).
 *
 * Здесь только константы и разбор URL — ни `sharp`, ни `node:fs`, ни доступа к
 * переменным окружения. Форма загрузки и карточка предмета исполняются в
 * браузере и импортируют именно этот файл; серверная запись файлов живёт в
 * `storage.ts`.
 */

/** §13: поддерживаются распространённые форматы JPG, PNG и WebP. */
export const ACCEPTED_PHOTO_FORMATS = ['jpeg', 'png', 'webp'] as const;

/** Значение атрибута accept у поля загрузки. Подсказка, а не проверка: */
/** фактический тип определяется на сервере по содержимому файла. */
export const PHOTO_ACCEPT_ATTRIBUTE = 'image/jpeg,image/png,image/webp';

export const PHOTO_VARIANTS = ['full', 'thumb'] as const;
export type PhotoVariant = (typeof PHOTO_VARIANTS)[number];

/** Хранимое имя файла — 32 hex-символа. Ничего, что похоже на путь. */
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

export function isValidPhotoToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/**
 * URL, который сохраняется в `items.photo_url`.
 *
 * Это маршрут приложения, а не файл в `public/`: §15 и NFR-17 требуют, чтобы
 * фотография отдавалась только после проверки сессии.
 */
export function photoUrlForToken(token: string): string {
  return `/api/photos/${token}`;
}

/** URL миниатюры для карточки списка (§5.2, §13). */
export function thumbnailUrl(photoUrl: string): string {
  return `${photoUrl}?variant=thumb`;
}

const TOKEN_FROM_URL = /^\/api\/photos\/([0-9a-f]{32})$/;

export function photoTokenFromUrl(photoUrl: string | null | undefined): string | null {
  if (!photoUrl) return null;
  return TOKEN_FROM_URL.exec(photoUrl)?.[1] ?? null;
}
