import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/auth/session-cookie';

/**
 * Первый рубеж: неавторизованный пользователь видит только страницу входа
 * (§3.1, §15, NFR-18).
 *
 * ВАЖНО: middleware выполняется в Edge-рантайме и не имеет доступа к SQLite,
 * поэтому здесь проверяется только НАЛИЧИЕ cookie. Настоящая проверка сессии
 * (не отозвана, не истекла, аккаунт активен) выполняется на каждом запросе
 * серверными guard'ами requirePage()/requireActor(). Middleware — удобство,
 * а не защита; защита — guard'ы и assertAdmin() в домене.
 */
export function middleware(request: NextRequest) {
  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (hasSessionCookie) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    /*
     * Всё, кроме страницы входа и статики самой страницы входа.
     * Загруженные фотографии предметов сюда ПОПАДАЮТ намеренно: §15 требует,
     * чтобы файлы тоже были за авторизацией (NFR-17), поэтому они будут
     * отдаваться маршрутом с проверкой сессии, а не из /public.
     */
    '/((?!login|_next/static|_next/image|favicon.ico).*)',
  ],
};
