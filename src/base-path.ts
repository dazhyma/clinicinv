/**
 * Префикс развёртывания (§ инфраструктура, D-51).
 *
 * Приложение живёт по адресу `https://dazhyma.tech/clinic`: корень домена занят
 * другим проектом. `basePath` в `next.config.ts` читается ОТСЮДА — константа
 * одна на весь репозиторий, чтобы конфигурация сборки и код не разъезжались.
 *
 * Модуль намеренно без единой зависимости: он импортируется и в `next.config.ts`
 * (Node, до сборки), и в `src/middleware.ts` (Edge-рантайм, где нет node:*),
 * и в клиентские компоненты.
 *
 * `withBasePath()` нужен ТОЛЬКО там, где Next не подставляет префикс сам:
 * — атрибут `action` обычной HTML-формы (`<form method="get" action="...">`);
 * — `src` у `next/image` с `unoptimized` (лоадер возвращает путь как есть);
 * — обычный `<a href>` на route handler.
 * Для `next/link`, `useRouter().push()` и `redirect()` из `next/navigation`
 * префикс добавляет сам Next — там `withBasePath()` дал бы `/clinic/clinic/...`.
 */
export const BASE_PATH = '/clinic';

export function withBasePath(path: string): string {
  if (!BASE_PATH) return path;
  if (!path.startsWith('/')) return path;
  // Идемпотентность: двойной префикс — типичная ошибка при правке разметки.
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`)) return path;
  return `${BASE_PATH}${path}`;
}
