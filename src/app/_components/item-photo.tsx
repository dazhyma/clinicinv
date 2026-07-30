import Image from 'next/image';
import { withBasePath } from '@/base-path';
import { thumbnailUrl } from '@/photos/shared';

/**
 * Фотография предмета в карточке (§5.2, §13).
 *
 * Без фотографии не рисуется НИЧЕГО — по решению заказчика: плашка-заглушка
 * занимала место в каждой строке списка, ничего при этом не показывая. У
 * подавляющего большинства позиций фотографии нет (первичная загрузка из
 * Count sheet принесла 506 позиций без фото), поэтому §13 «аккуратный
 * placeholder» здесь проигрывает плотности списка на планшете.
 *
 * Следствие: в смешанном списке строки с фотографией шире строк без неё —
 * осознанный компромисс в пользу компактности.
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

  if (!photoUrl) return null;

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
