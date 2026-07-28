/**
 * Единственный способ получить фотографию предмета (§13, §15, NFR-17).
 *
 * Файлы лежат вне `public/`, поэтому «случайно публичного» URL к ним не
 * существует. Здесь на КАЖДОМ запросе проверяется сессия: без неё — 401 и
 * никакого содержимого. Middleware, которое ловит отсутствие cookie, вторым
 * рубежом не считается (D-11).
 */
import { readFile } from 'node:fs/promises';
import { NextResponse, type NextRequest } from 'next/server';
import { requireActor } from '@/auth/guards';
import { isDomainError } from '@/domain/errors';
import { isValidPhotoToken, photoFilePath, type PhotoVariant } from '@/photos/storage';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  try {
    await requireActor();
  } catch (error) {
    if (isDomainError(error)) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }

  const { token } = await context.params;
  if (!isValidPhotoToken(token)) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
  }

  const variant: PhotoVariant =
    request.nextUrl.searchParams.get('variant') === 'thumb' ? 'thumb' : 'full';
  const file = photoFilePath(token, variant);
  if (!file) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'image/webp',
      // private: файл не должен осесть в общем кеше прокси (§15).
      'Cache-Control': 'private, max-age=3600, must-revalidate',
      'Content-Length': String(bytes.byteLength),
    },
  });
}
