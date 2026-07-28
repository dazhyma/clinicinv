import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/auth/session-cookie';
import { BASE_PATH } from '@/base-path';

/**
 * Первый рубеж: неавторизованный пользователь видит только страницу входа
 * (§3.1, §15, NFR-18). Плюс выдача Content-Security-Policy с одноразовым nonce.
 *
 * ВАЖНО: middleware выполняется в Edge-рантайме и не имеет доступа к SQLite,
 * поэтому здесь проверяется только НАЛИЧИЕ cookie. Настоящая проверка сессии
 * (не отозвана, не истекла, аккаунт активен) выполняется на каждом запросе
 * серверными guard'ами requirePage()/requireActor(). Middleware — удобство,
 * а не защита; защита — guard'ы и assertAdmin() в домене.
 */

const LOGIN_PATH = '/login';

/**
 * §15: политика содержимого. `script-src` без `unsafe-inline`: инлайновые
 * скрипты гидрации Next помечаются nonce'ом, который Next вычитывает из этого
 * же заголовка на входящем запросе, а подгружаемые ими чанки разрешает
 * `strict-dynamic`.
 *
 * `style-src 'unsafe-inline'` обязателен и не является послаблением по выбору:
 * этикетки и карточки задают геометрию атрибутом `style` (мм этикетки,
 * размер миниатюры), а на атрибуты стиля nonce не распространяется в принципе.
 *
 * `img-src data: blob:` — инлайновая графика штрихкода и предпросмотр фото до
 * загрузки; сами фотографии приходят с 'self' (`/api/photos/...`, §15/D-19).
 */
function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
  ].join('; ');
}

export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const csp = contentSecurityPolicy(nonce);

  const pathname = request.nextUrl.pathname;
  const isLoginPage = pathname === LOGIN_PATH;
  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  if (!isLoginPage && !hasSessionCookie) {
    const url = request.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    url.search = '';
    /**
     * Приложение развёрнуто под префиксом (D-51). Присваивание идемпотентно:
     * если NextURL уже знает basePath, значение то же самое; если не знает —
     * префикс появляется. Без этого редирект ушёл бы на `/login` в корне
     * домена, который занят другим проектом, и вход стал бы недостижим.
     */
    url.basePath = BASE_PATH;
    const response = NextResponse.redirect(url);
    response.headers.set('Content-Security-Policy', csp);
    return response;
  }

  // Заголовок на ЗАПРОСЕ читает рендерер Next и подставляет nonce в свои
  // инлайновые скрипты; заголовок на ОТВЕТЕ применяет браузер.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    /*
     * Пути в matcher указываются БЕЗ basePath: Next снимает префикс до
     * сопоставления, поэтому `/clinic/login` попадает сюда как `/login`.
     *
     * Страница входа теперь ВНУТРИ matcher (раньше исключалась): ей тоже нужен
     * заголовок CSP с nonce, иначе единственная страница, доступная без
     * сессии, осталась бы без политики. Редирект для неё отключён проверкой
     * isLoginPage, а не отсутствием в matcher.
     *
     * Загруженные фотографии предметов сюда ПОПАДАЮТ намеренно: §15 требует,
     * чтобы файлы тоже были за авторизацией (NFR-17); они отдаются маршрутом
     * с проверкой сессии, а не из /public.
     */
    /*
     * Корень указан отдельной строкой: в шаблоне выше группа с look-ahead —
     * это параметр пути, а параметр не сопоставляется с пустой строкой, и
     * `/clinic` (то есть pathname `/`) в matcher НЕ попадал. Проверено curl'ом:
     * без этой строки главная страница уходила бы без заголовка CSP.
     */
    '/',
    /*
     * `icon.svg` исключён вместе со статикой: это иконка приложения, а не
     * данные инвентаря, и она нужна на странице входа, где сессии ещё нет.
     * Без исключения браузер получил бы вместо картинки редирект на /login и
     * писал бы ошибку в консоль на каждой загрузке страницы входа.
     */
    '/((?!_next/static|_next/image|favicon.ico|icon.svg).*)',
  ],
};
