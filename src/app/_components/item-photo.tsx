import Image from 'next/image';
import { withBasePath } from '@/base-path';
import { thumbnailUrl } from '@/photos/shared';

/**
 * Фотография предмета в карточке (§5.2, §13).
 *
 * Геометрия одинакова с фотографией и без неё: §13 требует аккуратного
 * плейсхолдера, а «прыгающая» вёрстка списка мешает работать пальцем.
 *
 * `unoptimized` обязателен: оптимизатор Next ходит за картинкой собственным
 * запросом без cookie сессии и получил бы от `/api/photos/[token]` 401 (§15).
 * Уменьшение уже сделано при загрузке через sharp, поэтому оптимизатор не нужен.
 *
 * Плата за `unoptimized` — префикс развёртывания приходится дописывать вручную
 * (D-51): лоадер Next в этом режиме возвращает `src` как есть, и путь
 * `/api/photos/...` из `items.photo_url` ушёл бы в корень домена, где живёт
 * чужой проект. Оптимизированный `src` префикс получил бы сам.
 */
export function ItemPhoto({
  photoUrl,
  name,
  size = 64,
  variant = 'thumb',
}: {
  photoUrl: string | null;
  name: string;
  size?: number;
  variant?: 'thumb' | 'full';
}) {
  const className = 'shrink-0 rounded-xl object-cover ring-1 ring-slate-200';

  if (!photoUrl) {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-400 ring-1 ring-slate-200"
        style={{ width: size, height: size }}
        role="img"
        aria-label={`${name}: no photo`}
      >
        <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} aria-hidden="true">
          <path
            fill="currentColor"
            d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1 2v8.6l3.6-3.6 3 3 3.4-3.4L19 15V7H5Zm3.5 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z"
          />
        </svg>
      </div>
    );
  }

  return (
    <Image
      src={withBasePath(variant === 'thumb' ? thumbnailUrl(photoUrl) : photoUrl)}
      alt={name}
      width={size}
      height={size}
      unoptimized
      className={className}
      style={{ width: size, height: size }}
    />
  );
}
