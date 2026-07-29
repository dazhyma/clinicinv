import type { NextRequest } from 'next/server';
import type { BulkLabelRequest } from '@/actions/item-labels';
import { errors } from '@/domain/errors';

const MAX_REQUEST_BYTES = 512 * 1024;

export async function readBulkLabelRequest(request: NextRequest): Promise<BulkLabelRequest> {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_REQUEST_BYTES) {
    throw errors.validationFailed('The label selection is too large');
  }

  const reader = request.body?.getReader();
  if (!reader) throw errors.validationFailed('Unable to read the selected labels');
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw errors.validationFailed('The label selection is too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const body: unknown = (() => {
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return null;
    }
  })();
  if (!body || typeof body !== 'object') {
    throw errors.validationFailed('Unable to read the selected labels');
  }
  const input = body as { sizeId?: unknown; selection?: unknown };
  if (typeof input.sizeId !== 'string' || !Array.isArray(input.selection)) {
    throw errors.validationFailed('Unable to read the selected labels');
  }

  return {
    sizeId: input.sizeId,
    selection: input.selection.map((entry) => {
      const value =
        entry && typeof entry === 'object'
          ? (entry as { itemId?: unknown; copies?: unknown })
          : {};
      return {
        itemId: Number(value.itemId),
        copies: Number(value.copies),
      };
    }),
  };
}
