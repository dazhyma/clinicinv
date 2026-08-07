/**
 * Read-only barcode resolution used by both camera and HID scanners.
 *
 * Recognising a barcode must never mutate inventory or an operation. This
 * action only returns the information needed for the confirmation card; the
 * caller performs a separate mutation after the user presses Add/Confirm.
 */
import type { AppDatabase } from '@/db/client';
import type { Actor } from '@/domain/actor';
import { assertAuthenticated } from '@/domain/actor';
import { errors } from '@/domain/errors';
import { listItems } from '@/domain/items';
import { resolveScannedBarcode } from '@/domain/operations';
import { listPacks } from '@/domain/packs';
import { runAction, type ActionResult } from './result';

export interface BarcodeConfirmationComponentView {
  itemId: number;
  name: string;
  quantity: number;
  unitOfMeasurement: string;
  currentQuantity: number;
}

export interface BarcodeConfirmationView {
  barcode: string;
  kind: 'item' | 'pack';
  id: number;
  name: string;
  internalCode: string;
  photoUrl: string | null;
  referenceNumber: string | null;
  currentQuantity: number | null;
  unitOfMeasurement: string | null;
  components: BarcodeConfirmationComponentView[];
}

export interface SelectionSearchResultView {
  kind: 'item' | 'pack';
  id: number;
  name: string;
  internalCode: string;
  photoUrl: string | null;
  referenceNumber: string | null;
  currentQuantity: number | null;
  unitOfMeasurement: string | null;
}

function relevance(
  row: Pick<SelectionSearchResultView, 'name' | 'internalCode' | 'referenceNumber'>,
  rawQuery: string,
): number {
  const query = rawQuery.toLocaleLowerCase();
  const name = row.name.toLocaleLowerCase();
  const code = row.internalCode.toLocaleLowerCase();
  const reference = row.referenceNumber?.toLocaleLowerCase() ?? '';
  if (name === query || code === query || reference === query) return 0;
  if (code.startsWith(query) || reference.startsWith(query)) return 1;
  if (name.startsWith(query)) return 2;
  return 3;
}

/**
 * Общий read-only поиск для ручного ввода рядом со сканером. Пустой запрос
 * намеренно ничего не возвращает; стоимость не входит в ответ сервера (D-18).
 */
export function searchSelectionTargetsForConfirmation(
  db: AppDatabase,
  actor: Actor,
  input: { query: string; includePacks?: boolean },
): ActionResult<SelectionSearchResultView[]> {
  return runAction(() => {
    assertAuthenticated(actor);
    const query = input.query?.trim() ?? '';
    if (!query) return [];
    if (query.length > 120) {
      throw errors.validationFailed('Search must be 120 characters or fewer');
    }
    const results: SelectionSearchResultView[] = listItems(db, {
      query,
      includeInactive: false,
      limit: 50,
    }).map((item) => ({
      kind: 'item' as const,
      id: item.id,
      name: item.name,
      internalCode: item.internalCode,
      photoUrl: item.photoUrl,
      referenceNumber: item.referenceNumber,
      currentQuantity: item.currentQuantity,
      unitOfMeasurement: item.unitOfMeasurement,
    }));

    if (input.includePacks) {
      results.push(
        ...listPacks(db, { query, includeInactive: false }).map((pack) => ({
          kind: 'pack' as const,
          id: pack.id,
          name: pack.name,
          internalCode: pack.internalCode,
          photoUrl: pack.photoUrl,
          referenceNumber: null,
          currentQuantity: null,
          unitOfMeasurement: null,
        })),
      );
    }

    return results
      .sort(
        (left, right) =>
          relevance(left, query) - relevance(right, query) ||
          left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }),
      )
      .slice(0, 25);
  });
}

export function resolveBarcodeForConfirmation(
  db: AppDatabase,
  actor: Actor,
  rawBarcode: string,
): ActionResult<BarcodeConfirmationView> {
  return runAction(() => {
    assertAuthenticated(actor);
    const target = resolveScannedBarcode(db, rawBarcode);

    if (target.kind === 'item') {
      if (target.item.status !== 'active') throw errors.itemInactive(target.item.name);
      return {
        barcode: target.item.barcodeValue,
        kind: 'item' as const,
        id: target.item.id,
        name: target.item.name,
        internalCode: target.item.internalCode,
        photoUrl: target.item.photoUrl,
        referenceNumber: target.item.referenceNumber,
        currentQuantity: target.item.currentQuantity,
        unitOfMeasurement: target.item.unitOfMeasurement,
        components: [],
      };
    }

    if (target.pack.status !== 'active') throw errors.packInactive(target.pack.name);
    if (target.components.length === 0) throw errors.packEmpty(target.pack.name);
    for (const component of target.components) {
      if (component.item.status !== 'active') throw errors.itemInactive(component.item.name);
    }

    return {
      barcode: target.pack.barcodeValue,
      kind: 'pack' as const,
      id: target.pack.id,
      name: target.pack.name,
      internalCode: target.pack.internalCode,
      photoUrl: target.pack.photoUrl,
      referenceNumber: null,
      currentQuantity: null,
      unitOfMeasurement: null,
      components: target.components.map((component) => ({
        itemId: component.item.id,
        name: component.item.name,
        quantity: component.quantity,
        unitOfMeasurement: component.item.unitOfMeasurement,
        currentQuantity: component.item.currentQuantity,
      })),
    };
  });
}
